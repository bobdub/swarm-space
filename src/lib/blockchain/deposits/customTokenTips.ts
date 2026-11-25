/**
 * Native tips of imported tokens (MintMe tokens such as Dreams, Ethereum ERC-20s
 * such as MTCG) between members.
 *
 * A tip moves the recorded balance on the SWARM ledger only; the tokens stay in
 * the sender's custody address on their own chain. The asset id names the token
 * by its ref (chain + contract), so the same contract on two chains never mixes.
 * Amounts are checked in exact token units,
 * using the decimals already proven on-chain by the sender's custody sync records.
 */
import { formatUnits, parseUnits } from "ethers";
import type { SwarmTransaction } from "../types";
import { isCustomTokenSync, recordUnits, syncRecordRef } from "./customTokenCustody";
import { parseTokenRef, tokenCurrency, tokenRef } from "./tokenNetworks";

export const CUSTOM_TIP_ASSET_PREFIX = "custom:";

/** Tip asset id of a token ref: `custom:0x…` (MintMe) or `custom:eth:0x…` (Ethereum). */
export const customTipAssetId = (ref: string) => `${CUSTOM_TIP_ASSET_PREFIX}${ref.trim().toLowerCase()}`;

/** Token ref of a custom-token tip, or null when the record is not a well formed one. */
export function customTipRef(tx: SwarmTransaction): string | null {
  if (tx.type !== "wallet_tip") return null;
  const assetId = String(tx.meta?.assetId ?? "");
  if (!assetId.startsWith(CUSTOM_TIP_ASSET_PREFIX)) return null;
  const ref = assetId.slice(CUSTOM_TIP_ASSET_PREFIX.length);
  const parsed = parseTokenRef(ref);
  if (!parsed || tokenRef(parsed.contract, parsed.network) !== ref || tx.meta?.currency !== tokenCurrency(ref)) return null;
  const decimals = Number(tx.meta?.decimals);
  const raw = String(tx.meta?.amountUnits ?? "");
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36 || !/^[1-9]\d*$/.test(raw)) return null;
  if (Number(formatUnits(BigInt(raw), decimals)) !== tx.amount) return null;
  return ref;
}
/** @deprecated Older name: returns the token ref, which is the bare contract for MintMe tokens. */
export const customTipContract = customTipRef;

export function isCustomTokenTip(tx: SwarmTransaction): boolean {
  return customTipRef(tx) !== null;
}

/** Exact units for a tip amount, refusing amounts finer than the token allows. */
export function customTipUnits(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter an amount above zero");
  const text = amount.toFixed(Math.min(decimals, 20)).replace(/\.?0+$/, "");
  const units = parseUnits(text, decimals);
  if (units <= 0n || Number(formatUnits(units, decimals)) !== amount) throw new Error(`Use at most ${decimals} decimal places`);
  return units;
}

/** Decimals proven on-chain for this token by custody sync records, or null when none exist. */
export function provenTokenDecimals(ledger: readonly SwarmTransaction[], ref: string): number | null {
  const r = ref.trim().toLowerCase();
  for (const tx of ledger) {
    if (isCustomTokenSync(tx) && syncRecordRef(tx) === r) return Number(tx.meta?.decimals);
  }
  return null;
}

/** A member's recorded balance of one custom token (by ref), in exact units. */
export function customTokenBalanceUnits(ledger: readonly SwarmTransaction[], owner: string, ref: string, decimals: number): bigint {
  const currency = tokenCurrency(ref).toLowerCase();
  const seen = new Set<string>();
  let balance = 0n;
  for (const tx of ledger) {
    if (seen.has(tx.id) || String(tx.meta?.currency ?? "").toLowerCase() !== currency) continue;
    seen.add(tx.id);
    if (!(Number(tx.amount) > 0)) continue;
    if (tx.type === "wallet_tip") {
      if (!isCustomTokenTip(tx) || Number(tx.meta?.decimals) !== decimals) continue;
      const units = BigInt(String(tx.meta?.amountUnits));
      if (tx.from === owner) balance -= units;
      if (tx.to === owner) balance += units;
      continue;
    }
    const units = recordUnits(tx, decimals);
    if (tx.type === "external_deposit" && tx.to === owner) balance += units;
    else if (tx.type === "external_withdraw" && tx.from === owner) balance -= units;
    else if (tx.type === "custom_token_transfer") {
      if (tx.from === owner) balance -= units;
      if (tx.to === owner) balance += units;
    }
  }
  return balance;
}

/** True when the sender's recorded balance covers this tip in the token's proven decimals. */
export function canSettleCustomTokenTip(ledger: readonly SwarmTransaction[], tx: SwarmTransaction): boolean {
  const ref = customTipRef(tx);
  if (!ref) return false;
  const decimals = provenTokenDecimals(ledger, ref);
  if (decimals === null || decimals !== Number(tx.meta?.decimals)) return false;
  return customTokenBalanceUnits(ledger, tx.from, ref, decimals) >= BigInt(String(tx.meta?.amountUnits));
}
