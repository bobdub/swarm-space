/**
 * Creator-token tips: a signed, per-token ledger on the SWARM chain.
 *
 * Creator tokens are issued by each member's market (deployment seed, buys,
 * unlocks) on that member's own device, so a peer cannot see how a holding
 * came to be. A tip therefore settles in two parts, both inside the sender's
 * signed `wallet_tip`:
 *
 *  - `openingUnits`: the sender's market-issued holding of the token, i.e.
 *    what they hold apart from creator-token tips. It is attested by the
 *    holder's signature, never exceeds the token's maximum supply, and only
 *    ever rises (the highest opening a holder has signed is the one that counts).
 *  - the move itself, checked against `opening + received − sent` from every
 *    signed creator-token tip on the ledger, so tokens are conserved, a holder
 *    can never spend the same tokens twice on two peers, and tokens that came
 *    in by tip are fully proven by the tips that delivered them.
 *
 * Amounts are exact micro-token units (6 decimals, the precision holdings keep).
 * Tips never change a token's circulating supply and never move SWARM.
 */
import { formatUnits, parseUnits } from "ethers";
import type { SwarmTransaction } from "../types";
import { CREATOR_TOKEN_MAX_SUPPLY } from "../types";

export const CREATOR_TIP_ASSET_PREFIX = "creator:";
export const CREATOR_TOKEN_DECIMALS = 6;
export const CREATOR_TOKEN_MAX_UNITS = BigInt(CREATOR_TOKEN_MAX_SUPPLY) * 10n ** BigInt(CREATOR_TOKEN_DECIMALS);

const TOKEN_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const UNITS = /^(0|[1-9]\d{0,30})$/;

export const creatorTipAssetId = (tokenId: string) => `${CREATOR_TIP_ASSET_PREFIX}${tokenId}`;

/** Exact micro-token units of an amount, refusing more than 6 decimal places. */
export function creatorTokenUnits(amount: number): bigint {
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Enter a valid creator-token amount");
  const units = parseUnits(amount.toFixed(CREATOR_TOKEN_DECIMALS), CREATOR_TOKEN_DECIMALS);
  if (Number(formatUnits(units, CREATOR_TOKEN_DECIMALS)) !== amount) {
    throw new Error(`Creator tokens use at most ${CREATOR_TOKEN_DECIMALS} decimal places`);
  }
  return units;
}

export function creatorTokenAmount(units: bigint): number {
  return Number(formatUnits(units, CREATOR_TOKEN_DECIMALS));
}

/** Round a stored holding (kept to 1e-6) down onto exact units. */
export function holdingUnits(amount: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) return 0n;
  return parseUnits((Math.floor(amount * 1e6 + 1e-6) / 1e6).toFixed(CREATOR_TOKEN_DECIMALS), CREATOR_TOKEN_DECIMALS);
}

/** Token id of a well formed creator-token tip, or null. */
export function creatorTipTokenId(tx: SwarmTransaction): string | null {
  if (tx?.type !== "wallet_tip") return null;
  const assetId = String(tx.meta?.assetId ?? "");
  if (!assetId.startsWith(CREATOR_TIP_ASSET_PREFIX)) return null;
  const tokenId = assetId.slice(CREATOR_TIP_ASSET_PREFIX.length);
  if (!TOKEN_ID.test(tokenId) || tx.tokenId !== tokenId || (tx.chainId ?? "SWARM") !== "SWARM") return null;
  const amountUnits = String(tx.meta?.amountUnits ?? "");
  const openingUnits = String(tx.meta?.openingUnits ?? "");
  if (!UNITS.test(amountUnits) || !UNITS.test(openingUnits)) return null;
  const amount = BigInt(amountUnits);
  if (amount <= 0n || amount > CREATOR_TOKEN_MAX_UNITS || BigInt(openingUnits) > CREATOR_TOKEN_MAX_UNITS) return null;
  if (creatorTokenAmount(amount) !== tx.amount) return null;
  const ticker = tx.meta?.ticker;
  if (typeof ticker !== "string" || !ticker || ticker.length > 12) return null;
  const creator = tx.meta?.creatorUserId;
  if (typeof creator !== "string" || !creator || creator.length > 128) return null;
  return tokenId;
}

export function isCreatorTokenTip(tx: SwarmTransaction): boolean {
  return creatorTipTokenId(tx) !== null;
}

export interface CreatorTokenPosition {
  /** Highest opening the holder has signed (0 when none). */
  opening: bigint;
  /** Signed creator-token tips received minus sent. */
  net: bigint;
}

/** A holder's position in one creator token, from the signed tips on the ledger. */
export function creatorTokenPosition(ledger: readonly SwarmTransaction[], holder: string, tokenId: string): CreatorTokenPosition {
  const seen = new Set<string>();
  let opening = 0n;
  let net = 0n;
  for (const tx of ledger) {
    if (seen.has(tx.id) || creatorTipTokenId(tx) !== tokenId) continue;
    seen.add(tx.id);
    const units = BigInt(String(tx.meta?.amountUnits));
    if (tx.from === holder) {
      net -= units;
      const declared = BigInt(String(tx.meta?.openingUnits));
      if (declared > opening) opening = declared;
    }
    if (tx.to === holder) net += units;
  }
  return { opening, net };
}

export function creatorTokenBalanceUnits(ledger: readonly SwarmTransaction[], holder: string, tokenId: string): bigint {
  const { opening, net } = creatorTokenPosition(ledger, holder, tokenId);
  return opening + net;
}

/** Whether the sender's signed position on this ledger covers the tip. */
export function canSettleCreatorTokenTip(ledger: readonly SwarmTransaction[], tx: SwarmTransaction): boolean {
  const tokenId = creatorTipTokenId(tx);
  if (!tokenId) return false;
  const { opening, net } = creatorTokenPosition(ledger, tx.from, tokenId);
  const declared = BigInt(String(tx.meta?.openingUnits));
  const effective = declared > opening ? declared : opening;
  return effective + net >= BigInt(String(tx.meta?.amountUnits));
}

/**
 * The opening a holder signs with their next tip, and what they can tip with it.
 * `localUnits` is the holding on this device, which already reflects every
 * creator-token tip it has applied. The opening never falls, so a holding that
 * shrank through a market sale is capped by what is held here, not the ledger.
 */
export function planCreatorTokenTip(ledger: readonly SwarmTransaction[], holder: string, tokenId: string, localUnits: bigint): {
  openingUnits: bigint; spendableUnits: bigint;
} {
  const { opening, net } = creatorTokenPosition(ledger, holder, tokenId);
  let wanted = localUnits - net;
  if (wanted > CREATOR_TOKEN_MAX_UNITS) wanted = CREATOR_TOKEN_MAX_UNITS;
  const openingUnits = wanted > opening ? wanted : opening;
  const ledgerUnits = openingUnits + net;
  let spendableUnits = localUnits < ledgerUnits ? localUnits : ledgerUnits;
  if (spendableUnits < 0n) spendableUnits = 0n;
  return { openingUnits, spendableUnits };
}

/** The holdings move a creator-token tip makes, or null when it is not one. */
export function creatorTipMove(tx: SwarmTransaction): {
  id: string; from: string; to: string; tokenId: string; ticker: string; creatorUserId: string; amount: number;
} | null {
  const tokenId = creatorTipTokenId(tx);
  if (!tokenId) return null;
  return { id: tx.id, from: tx.from, to: tx.to, tokenId, ticker: String(tx.meta?.ticker),
    creatorUserId: String(tx.meta?.creatorUserId), amount: creatorTokenAmount(BigInt(String(tx.meta?.amountUnits))) };
}
