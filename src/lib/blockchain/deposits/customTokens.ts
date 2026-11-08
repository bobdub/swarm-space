/** Native custom-token inventory, historical ledger reads and cold-key withdrawals. */
import { isDepositSynced, markDepositsSynced, connectedPeerCount } from "./depositSync";
import { getSwarmChain } from "../chain";
import { generateTransactionId } from "../crypto";
import { deriveColdKey, getColdKeyAuthority, sendColdKeyTokenTransfer } from "../wallets/coldKey";
import type { SwarmTransaction } from "../types";
import { _allTransactionsForExternalLedger as allTransactions } from "../wallets/walletLink";
import { customTokenDepositCapacity } from "./customTokenLimits";
export { CUSTOM_TOKEN_DEPOSIT_MAX } from "./customTokenLimits";

export function getCustomTokenDepositCapacity(address: string) {
  return customTokenDepositCapacity(allTransactions(), address);
}

export interface CustomToken { address: string; symbol: string; decimals: number; hidden?: boolean; addedAt: number }

const KEY = (uid: string) => `swarm-custom-tokens:${uid}`;
export const CUSTOM_TOKENS_EVENT = "swarm-custom-tokens";

export function isContractAddress(s: string): boolean { return /^0x[a-fA-F0-9]{40}$/.test(s.trim()); }
export function isValidSymbol(s: string): boolean { return /^[A-Za-z0-9]{1,11}$/.test(s.trim()); }
export const tokenCurrency = (address: string) => `MINTME:${address.toLowerCase()}`;

export function listCustomTokens(uid: string): CustomToken[] {
  if (!uid) return [];
  try { const v = JSON.parse(localStorage.getItem(KEY(uid)) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function save(uid: string, list: CustomToken[]) {
  if (!uid) return;
  try { localStorage.setItem(KEY(uid), JSON.stringify(list)); } catch { /* quota */ }
  // Durable mirror so imported tokens survive localStorage wipes and refreshes.
  void import("../../store").then(({ put }) => put("meta", { k: KEY(uid), v: list })).catch(() => { /* best effort */ });
  try { window.dispatchEvent(new CustomEvent(CUSTOM_TOKENS_EVENT)); } catch { /* non-browser */ }
}
/** Restore imported tokens from the durable mirror, merging with anything in localStorage. */
export async function hydrateCustomTokens(uid: string): Promise<CustomToken[]> {
  if (!uid) return [];
  const local = listCustomTokens(uid);
  try {
    const { get } = await import("../../store");
    const entry = await get<{ k: string; v: CustomToken[] }>("meta", KEY(uid));
    const durable = entry && Array.isArray(entry.v) ? entry.v : [];
    const byAddr = new Map<string, CustomToken>();
    for (const t of [...durable, ...local]) if (t && isContractAddress(t.address)) byAddr.set(t.address.toLowerCase(), t);
    const merged = [...byAddr.values()];
    if (merged.length !== local.length || durable.length !== merged.length) save(uid, merged);
    return merged;
  } catch { return local; }
}
export function addCustomToken(uid: string, t: Omit<CustomToken, "addedAt">): CustomToken {
  if (!isContractAddress(t.address)) throw new Error("Enter a valid 0x contract address");
  if (!isValidSymbol(t.symbol)) throw new Error("Symbol must be 1–11 letters or numbers");
  if (!Number.isInteger(t.decimals) || t.decimals < 0 || t.decimals > 36) throw new Error("Decimals must be between 0 and 36");
  const address = t.address.trim().toLowerCase();
  const rest = listCustomTokens(uid).filter((x) => x.address !== address);
  const token = { address, symbol: t.symbol.trim().toUpperCase(), decimals: t.decimals, addedAt: Date.now() };
  save(uid, [...rest, token]);
  return token;
}
/** Remove an imported token from this wallet. Ledger records stay; re-importing restores the balance. */
export function removeCustomToken(uid: string, address: string) {
  save(uid, listCustomTokens(uid).filter((t) => t.address !== address.toLowerCase()));
}
/** A token with any recorded holding cannot be hidden. */
export function canHideToken(recorded: number): boolean { return recorded === 0; }
export function setTokenHidden(uid: string, address: string, hidden: boolean) {
  save(uid, listCustomTokens(uid).map((t) => (t.address === address.toLowerCase() ? { ...t, hidden } : t)));
}

export function unitsToNumber(raw: bigint, decimals: number): number {
  const base = 10n ** BigInt(decimals);
  return Number(raw / base) + Number(raw % base) / Number(base);
}
export function numberToUnits(amount: number, decimals: number): bigint {
  const [w, f = ""] = amount.toFixed(Math.min(decimals, 18)).split(".");
  return BigInt(w) * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}

export function getRecordedTokenBalance(swarmId: string, address: string): number {
  if (!swarmId) return 0;
  const cur = tokenCurrency(address);
  let n = 0;
  for (const tx of allTransactions()) {
    const m = (tx.meta ?? {}) as Record<string, unknown>;
    if (m.currency !== cur) continue;
    if (tx.type === "external_deposit" && tx.to === swarmId) n += Number(tx.amount ?? 0);
    else if (tx.type === "external_withdraw" && tx.from === swarmId) n -= Number(tx.amount ?? 0);
    else if (tx.type === "custom_token_transfer") {
      if (tx.from === swarmId) n -= Number(tx.amount ?? 0);
      if (tx.to === swarmId) n += Number(tx.amount ?? 0);
    }
  }
  return Math.max(0, Math.round(n * 1e8) / 1e8);
}

function depositsFor(swarmId: string, address: string): SwarmTransaction[] {
  const cur = tokenCurrency(address);
  return allTransactions().filter((tx) => tx.type === "external_deposit" && tx.to === swarmId && ((tx.meta ?? {}) as Record<string, unknown>).currency === cur);
}

/** Deposited amount not yet shared with any peer — withdrawable, but not usable in the mesh. */
export function getPendingSyncTokenBalance(swarmId: string, address: string): number {
  if (!swarmId) return 0;
  const n = depositsFor(swarmId, address).filter((tx) => !isDepositSynced(tx.id)).reduce((s, tx) => s + Number(tx.amount ?? 0), 0);
  return Math.min(getRecordedTokenBalance(swarmId, address), Math.round(n * 1e8) / 1e8);
}

/** Balance usable for mesh transfers and vault top-ups. */
export function getAvailableTokenBalance(swarmId: string, address: string): number {
  return Math.max(0, Math.round((getRecordedTokenBalance(swarmId, address) - getPendingSyncTokenBalance(swarmId, address)) * 1e8) / 1e8);
}

/** Unlock this user's deposits once a peer connection exists. */
export async function syncPendingDeposits(swarmId: string): Promise<boolean> {
  const ids = allTransactions().filter((tx) => tx.type === "external_deposit" && tx.to === swarmId && !isDepositSynced(tx.id)).map((tx) => tx.id);
  if (!ids.length) return false;
  return markDepositsSynced(ids, await connectedPeerCount());
}

/**
 * Withdraw native-held tokens to any MintMe address.
 *
 * Order matters: the on-chain move from the cold-wallet key happens FIRST.
 * Only when MintMe accepts the transfer is the SWARM ledger debited — a
 * failed broadcast leaves the native balance untouched. The confirmed
 * MintMe transaction hash is engraved on the withdrawal record as proof.
 */
export async function withdrawCustomToken(p: { swarmId: string; token: CustomToken; amount: number; to: string }): Promise<SwarmTransaction> {
  const { swarmId, token, amount } = p;
  const to = p.to.trim();
  if (!isContractAddress(to)) throw new Error("Enter a valid 0x destination address");
  if (!(amount > 0) || !Number.isFinite(amount)) throw new Error("Enter an amount above zero");
  await getSwarmChain().whenReady();
  const recorded = getRecordedTokenBalance(swarmId, token.address);
  if (recorded < amount) throw new Error(`Your native wallet holds ${recorded} ${token.symbol} — not enough to withdraw ${amount}`);
  const authority = await getColdKeyAuthority(swarmId);
  if (!authority) throw new Error("Engrave your cold-wallet key first — a Creator Coin Vault or 1 mined SWARM is required");
  const { wallet, address: coldAddress } = await deriveColdKey(swarmId);
  const txHash = await sendColdKeyTokenTransfer({
    wallet, tokenAddress: token.address, symbol: token.symbol, to,
    units: numberToUnits(amount, token.decimals),
  });
  const at = Date.now();
  const currency = tokenCurrency(token.address);
  const tx: SwarmTransaction = {
    id: generateTransactionId(), type: "external_withdraw", from: swarmId, to,
    amount: Math.round(amount * 1e8) / 1e8, timestamp: new Date(at).toISOString(), signature: txHash,
    publicKey: coldAddress, nonce: at, fee: 0,
    meta: { kind: "external_withdraw", currency, symbol: token.symbol, contract: token.address, address: coldAddress, destination: to, coldKeyAddress: coldAddress, keyAuthority: authority.kind, txHash },
  };
  getSwarmChain().addTransaction(tx);
  try { window.dispatchEvent(new CustomEvent("blockchain-transaction", { detail: { id: tx.id } })); } catch { /* */ }
  return tx;
}
