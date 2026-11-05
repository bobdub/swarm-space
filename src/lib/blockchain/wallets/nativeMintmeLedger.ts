import { formatUnits, parseUnits } from "ethers";
import type { SwarmTransaction } from "../types";
import { INFINITY_VAULTS, resolveInfinityVault } from "../infinity/vaults";

export const NATIVE_MINTME_ASSET_ID = "external:MINTME";
export const NATIVE_MINTME_CUSTODY = "mintme-native-custody-v1";

export function mintMeUnits(amount: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a positive MINTME amount");
  return parseUnits(String(amount), 18);
}

export function mintMeAmount(units: bigint): number {
  return Number(formatUnits(units, 18));
}

export function nativeMintMeUnits(tx: SwarmTransaction): bigint | null {
  try {
    const raw = tx.meta?.amountUnits;
    if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw)) return null;
    const units = BigInt(raw);
    return tx.amount === mintMeAmount(units) ? units : null;
  } catch { return null; }
}

export function isNativeMintMeTip(tx: SwarmTransaction): boolean {
  return tx.type === "wallet_tip" && tx.meta?.assetId === NATIVE_MINTME_ASSET_ID
    && tx.meta?.currency === "MINTME" && nativeMintMeUnits(tx) !== null;
}

export function isNativeMintMeDeposit(tx: SwarmTransaction): boolean {
  return tx.type === "external_deposit" && tx.meta?.currency === "MINTME"
    && tx.meta?.custody === NATIVE_MINTME_CUSTODY;
}

/** Direct cold-key withdrawal to MintMe; units include the MINTME gas paid. */
export function isNativeMintMeWithdraw(tx: SwarmTransaction): boolean {
  return tx.type === "external_withdraw" && tx.meta?.currency === "MINTME"
    && tx.meta?.custody === NATIVE_MINTME_CUSTODY;
}

/** Any custody record (deposit, balance sync or withdrawal) needs verified acceptance. */
export function isNativeMintMeCustody(tx: SwarmTransaction): boolean {
  return isNativeMintMeDeposit(tx) || isNativeMintMeWithdraw(tx);
}

/** Recorded inflow/outflow and balance-sync total for one cold-key address. */
export function custodyFlows(transactions: readonly SwarmTransaction[], address: string, skipId?: string) {
  const a = address.toLowerCase();
  let inflow = 0n, outflow = 0n, synced = 0n;
  const seen = new Set<string>();
  for (const tx of transactions) {
    if (tx.id === skipId || seen.has(tx.id)) continue;
    seen.add(tx.id);
    if (String(tx.meta?.custodyAddress ?? "").toLowerCase() !== a) continue;
    const units = nativeMintMeUnits(tx);
    if (units === null) continue;
    if (isNativeMintMeDeposit(tx)) { inflow += units; if (tx.meta?.mode === "sync") synced += units; }
    else if (isNativeMintMeWithdraw(tx)) outflow += units;
  }
  return { inflow, outflow, synced };
}

export function mintMeSyncMessage(userId: string, address: string, cumulative: bigint, units: bigint): string {
  return `SWARM native MINTME sync v1\n${userId}\n${address.toLowerCase()}\n${cumulative}\n${units}`;
}

export function mintMeWithdrawMessage(userId: string, address: string, txHash: string, units: bigint): string {
  return `SWARM native MINTME withdraw v1\n${userId}\n${address.toLowerCase()}\n${txHash.toLowerCase()}\n${units}`;
}

export const MINTME_COMMUNITY_PAYOUT_TYPE = "mintme_community_payout";
/** Infinity's MintMe vault; the legacy "community-pool" id resolves to it. */
export const MINTME_COMMUNITY_POOL = INFINITY_VAULTS.mintme;

export interface MintMeCommunityPayoutCredits {
  round: number;
  recipients: string[];
  perPeerUnits: bigint;
  communityUnits: bigint;
  /** Where the retained share goes (Infinity's market liquidity layer). */
  retainedTo: string;
}

/** Shape-only read of an Infinity payout action; acceptance re-derives it from the recorded answers. */
export function readCommunityPayout(tx: SwarmTransaction): MintMeCommunityPayoutCredits | null {
  try {
    if (tx.type !== MINTME_COMMUNITY_PAYOUT_TYPE || resolveInfinityVault(tx.from) !== INFINITY_VAULTS.mintme) return null;
    const m = tx.meta ?? {};
    const round = m.round, recipients = m.recipients;
    if (!Number.isSafeInteger(round) || (round as number) < 0 || tx.id !== `mintme-community-payout-${round}`) return null;
    if (!Array.isArray(recipients) || !recipients.length || recipients.some(r => typeof r !== "string")) return null;
    if (typeof m.perPeerUnits !== "string" || !/^[1-9]\d*$/.test(m.perPeerUnits)) return null;
    if (typeof m.communityUnits !== "string" || !/^\d+$/.test(m.communityUnits)) return null;
    const retainedTo = typeof m.retainedTo === "string" ? m.retainedTo : INFINITY_VAULTS.mintme;
    return { round: round as number, recipients: recipients as string[], perPeerUnits: BigInt(m.perPeerUnits), communityUnits: BigInt(m.communityUnits), retainedTo };
  } catch { return null; }
}

/** Custody deposits, signed native transfers and Infinity payout actions fund this asset.
 * Legacy self-transfers, migrations and MetaMask balance snapshots are not custody.
 */
export function nativeMintMeBalanceUnits(transactions: readonly SwarmTransaction[], userId: string): bigint {
  let balance = 0n;
  const seen = new Set<string>();
  for (const tx of transactions) {
    if (seen.has(tx.id)) continue;
    seen.add(tx.id);
    const payout = readCommunityPayout(tx);
    if (payout) {
      if (payout.recipients.includes(userId)) balance += payout.perPeerUnits;
      if (payout.retainedTo === userId) balance += payout.communityUnits;
      continue;
    }
    const units = nativeMintMeUnits(tx);
    if (units === null) continue;
    if (isNativeMintMeDeposit(tx) && tx.to === userId) balance += units;
    if (isNativeMintMeWithdraw(tx) && tx.from === userId) balance -= units;
    if (isNativeMintMeTip(tx)) {
      if (tx.from === userId) balance -= units;
      if (tx.to === userId) balance += units;
    }
  }
  return balance;
}

export type MintMeSource = "mined" | "deposit" | "tip" | "withdrawal";
/** History label: where a native MINTME amount came from (one balance, labelled sources). */
export function mintMeSource(tx: SwarmTransaction): MintMeSource | null {
  if (readCommunityPayout(tx)) return "mined";
  if (isNativeMintMeDeposit(tx)) return "deposit";
  if (isNativeMintMeWithdraw(tx)) return "withdrawal";
  if (isNativeMintMeTip(tx)) return "tip";
  return null;
}

export function mintMeCustodyMessage(userId: string, address: string, txHash: string, units: bigint): string {
  return `SWARM native MINTME custody v1\n${userId}\n${address.toLowerCase()}\n${txHash.toLowerCase()}\n${units}`;
}