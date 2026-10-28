import { formatUnits, parseUnits } from "ethers";
import type { SwarmTransaction } from "../types";

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

/** Only accepted custody deposits and signed native transfers fund this asset.
 * Legacy self-transfers, migrations and MetaMask balance snapshots are not custody.
 */
export function nativeMintMeBalanceUnits(transactions: readonly SwarmTransaction[], userId: string): bigint {
  let balance = 0n;
  const seen = new Set<string>();
  for (const tx of transactions) {
    if (seen.has(tx.id)) continue;
    seen.add(tx.id);
    const units = nativeMintMeUnits(tx);
    if (units === null) continue;
    if (isNativeMintMeDeposit(tx) && tx.to === userId) balance += units;
    if (isNativeMintMeTip(tx)) {
      if (tx.from === userId) balance -= units;
      if (tx.to === userId) balance += units;
    }
  }
  return balance;
}

export function mintMeCustodyMessage(userId: string, address: string, txHash: string, units: bigint): string {
  return `SWARM native MINTME custody v1\n${userId}\n${address.toLowerCase()}\n${txHash.toLowerCase()}\n${units}`;
}