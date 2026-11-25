/**
 * Native tips of imported MintMe tokens (for example Dreams) between members.
 *
 * A tip moves the recorded balance on the SWARM ledger only; the tokens stay in
 * the sender's MintMe custody address. Amounts are checked in exact token units,
 * using the decimals already proven on-chain by the sender's custody sync records.
 */
import { formatUnits, parseUnits } from "ethers";
import type { SwarmTransaction } from "../types";
import { isCustomTokenSync, recordUnits } from "./customTokenCustody";

export const CUSTOM_TIP_ASSET_PREFIX = "custom:";
const CONTRACT = /^0x[0-9a-f]{40}$/;

export const customTipAssetId = (contract: string) => `${CUSTOM_TIP_ASSET_PREFIX}${contract.trim().toLowerCase()}`;

/** Contract of a custom-token tip, or null when the record is not a well formed one. */
export function customTipContract(tx: SwarmTransaction): string | null {
  if (tx.type !== "wallet_tip") return null;
  const assetId = String(tx.meta?.assetId ?? "");
  if (!assetId.startsWith(CUSTOM_TIP_ASSET_PREFIX)) return null;
  const contract = assetId.slice(CUSTOM_TIP_ASSET_PREFIX.length);
  if (!CONTRACT.test(contract) || tx.meta?.currency !== `MINTME:${contract}`) return null;
  const decimals = Number(tx.meta?.decimals);
  const raw = String(tx.meta?.amountUnits ?? "");
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36 || !/^[1-9]\d*$/.test(raw)) return null;
  if (Number(formatUnits(BigInt(raw), decimals)) !== tx.amount) return null;
  return contract;
}

export function isCustomTokenTip(tx: SwarmTransaction): boolean {
  return customTipContract(tx) !== null;
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
export function provenTokenDecimals(ledger: readonly SwarmTransaction[], contract: string): number | null {
  const c = contract.toLowerCase();
  for (const tx of ledger) {
    if (isCustomTokenSync(tx) && String(tx.meta?.contract ?? "").toLowerCase() === c) return Number(tx.meta?.decimals);
  }
  return null;
}

/** A member's recorded balance of one custom token, in exact units. */
export function customTokenBalanceUnits(ledger: readonly SwarmTransaction[], owner: string, contract: string, decimals: number): bigint {
  const currency = `mintme:${contract.toLowerCase()}`;
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
  const contract = customTipContract(tx);
  if (!contract) return false;
  const decimals = provenTokenDecimals(ledger, contract);
  if (decimals === null || decimals !== Number(tx.meta?.decimals)) return false;
  return customTokenBalanceUnits(ledger, tx.from, contract, decimals) >= BigInt(String(tx.meta?.amountUnits));
}
