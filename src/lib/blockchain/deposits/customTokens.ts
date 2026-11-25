/** Native custom-token inventory, historical ledger reads and cold-key withdrawals. */
import { isDepositSynced, markDepositsSynced, connectedPeerCount } from "./depositSync";
import { getSwarmChain } from "../chain";
import { generateTransactionId } from "../crypto";
import { deriveColdKey, getColdKeyReceivingAddress, getColdKeyAuthority, sendColdKeyTokenTransfer } from "../wallets/coldKey";
import type { SwarmTransaction } from "../types";
import { _allTransactionsForExternalLedger as allTransactions } from "../wallets/walletLink";
import { isCustomTokenTip } from "./customTokenTips";
import { assertCustomTokenDepositCapacity, customTokenDepositCapacity } from "./customTokenLimits";
import { CUSTOM_TOKEN_CUSTODY, customTokenCustodyFlows, customTokenSyncMessage, readCustomTokenCustody, readTokenDecimalsOnChain } from "./customTokenCustody";
import { TOKEN_NETWORKS, isTokenNetworkId, parseTokenRef, tokenCurrency, tokenRef, type TokenNetworkId } from "./tokenNetworks";
export { CUSTOM_TOKEN_DEPOSIT_MAX } from "./customTokenLimits";
export { tokenCurrency, tokenRef, parseTokenRef, TOKEN_NETWORKS, type TokenNetworkId } from "./tokenNetworks";

/** `ref` is a token ref (chain + contract): the bare contract for MintMe, `eth:0x…` for Ethereum. */
export function getCustomTokenDepositCapacity(ref: string) {
  return customTokenDepositCapacity(allTransactions(), ref);
}

/**
 * An imported ERC-20. `network` is absent on tokens saved before Ethereum support,
 * which are all MintMe tokens. Identity is chain + contract: see `customTokenRef`.
 */
export interface CustomToken { address: string; symbol: string; decimals: number; network?: TokenNetworkId; hidden?: boolean; addedAt: number }

export function customTokenNetwork(token: Pick<CustomToken, "network">): TokenNetworkId {
  return isTokenNetworkId(token.network) ? token.network : "mintme";
}
/** The token's identity on the ledger: chain + contract. */
export function customTokenRef(token: Pick<CustomToken, "address" | "network">): string {
  return tokenRef(token.address, customTokenNetwork(token));
}

const KEY = (uid: string) => `swarm-custom-tokens:${uid}`;
export const CUSTOM_TOKENS_EVENT = "swarm-custom-tokens";

export function isContractAddress(s: string): boolean { return /^0x[a-fA-F0-9]{40}$/.test(s.trim()); }
export function isValidSymbol(s: string): boolean { return /^[A-Za-z0-9]{1,11}$/.test(s.trim()); }

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
    const byRef = new Map<string, CustomToken>();
    for (const t of [...durable, ...local]) if (t && isContractAddress(t.address)) byRef.set(customTokenRef(t), t);
    const merged = [...byRef.values()];
    if (merged.length !== local.length || durable.length !== merged.length) save(uid, merged);
    return merged;
  } catch { return local; }
}
export function addCustomToken(uid: string, t: Omit<CustomToken, "addedAt">): CustomToken {
  if (!isContractAddress(t.address)) throw new Error("Enter a valid 0x contract address");
  if (!isValidSymbol(t.symbol)) throw new Error("Symbol must be 1–11 letters or numbers");
  if (!Number.isInteger(t.decimals) || t.decimals < 0 || t.decimals > 36) throw new Error("Decimals must be between 0 and 36");
  const address = t.address.trim().toLowerCase();
  const network = customTokenNetwork(t);
  const ref = tokenRef(address, network);
  const rest = listCustomTokens(uid).filter((x) => customTokenRef(x) !== ref);
  const token: CustomToken = { address, symbol: t.symbol.trim().toUpperCase(), decimals: t.decimals, addedAt: Date.now(),
    ...(network === "mintme" ? {} : { network }) };
  save(uid, [...rest, token]);
  return token;
}
/** Remove an imported token (by ref) from this wallet. Ledger records stay; re-importing restores the balance. */
export function removeCustomToken(uid: string, ref: string) {
  const r = ref.trim().toLowerCase();
  save(uid, listCustomTokens(uid).filter((t) => customTokenRef(t) !== r));
}
/** A token with any recorded holding cannot be hidden. */
export function canHideToken(recorded: number): boolean { return recorded === 0; }
export function setTokenHidden(uid: string, ref: string, hidden: boolean) {
  const r = ref.trim().toLowerCase();
  save(uid, listCustomTokens(uid).map((t) => (customTokenRef(t) === r ? { ...t, hidden } : t)));
}

export function unitsToNumber(raw: bigint, decimals: number): number {
  const base = 10n ** BigInt(decimals);
  return Number(raw / base) + Number(raw % base) / Number(base);
}
export function numberToUnits(amount: number, decimals: number): bigint {
  const [w, f = ""] = amount.toFixed(Math.min(decimals, 18)).split(".");
  return BigInt(w) * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}

/** Recorded native balance of a token, by ref (chain + contract). */
export function getRecordedTokenBalance(swarmId: string, ref: string): number {
  if (!swarmId) return 0;
  const cur = tokenCurrency(ref);
  let n = 0;
  for (const tx of allTransactions()) {
    const m = (tx.meta ?? {}) as Record<string, unknown>;
    if (m.currency !== cur) continue;
    if (tx.type === "external_deposit" && tx.to === swarmId) n += Number(tx.amount ?? 0);
    else if (tx.type === "external_withdraw" && tx.from === swarmId) n -= Number(tx.amount ?? 0);
    else if (tx.type === "custom_token_transfer" || (tx.type === "wallet_tip" && isCustomTokenTip(tx))) {
      if (tx.from === swarmId) n -= Number(tx.amount ?? 0);
      if (tx.to === swarmId) n += Number(tx.amount ?? 0);
    }
  }
  return Math.max(0, Math.round(n * 1e8) / 1e8);
}

function depositsFor(swarmId: string, ref: string): SwarmTransaction[] {
  const cur = tokenCurrency(ref);
  return allTransactions().filter((tx) => tx.type === "external_deposit" && tx.to === swarmId && ((tx.meta ?? {}) as Record<string, unknown>).currency === cur);
}

/** Deposited amount not yet shared with any peer — withdrawable, but not usable in the mesh. */
export function getPendingSyncTokenBalance(swarmId: string, ref: string): number {
  if (!swarmId) return 0;
  const n = depositsFor(swarmId, ref).filter((tx) => !isDepositSynced(tx.id)).reduce((s, tx) => s + Number(tx.amount ?? 0), 0);
  return Math.min(getRecordedTokenBalance(swarmId, ref), Math.round(n * 1e8) / 1e8);
}

/** Balance usable for mesh transfers and vault top-ups. */
export function getAvailableTokenBalance(swarmId: string, ref: string): number {
  return Math.max(0, Math.round((getRecordedTokenBalance(swarmId, ref) - getPendingSyncTokenBalance(swarmId, ref)) * 1e8) / 1e8);
}

/** Unlock this user's deposits once a peer connection exists. */
export async function syncPendingDeposits(swarmId: string): Promise<boolean> {
  const ids = allTransactions().filter((tx) => tx.type === "external_deposit" && tx.to === swarmId && !isDepositSynced(tx.id)).map((tx) => tx.id);
  if (!ids.length) return false;
  return markDepositsSynced(ids, await connectedPeerCount());
}

/**
 * A token imported while its chain could not be read keeps the form's default decimals (18), but MintMe
 * tokens use 12, so every deposit check would fail. Fix the saved value from the contract while no
 * ledger record depends on it; once records exist, changing decimals would rescale them, so refuse.
 */
async function correctImportedDecimals(userId: string, token: CustomToken): Promise<CustomToken> {
  const ref = customTokenRef(token);
  const actual = await readTokenDecimalsOnChain(ref);
  if (actual === token.decimals) return token;
  const currency = tokenCurrency(ref).toLowerCase();
  const recorded = allTransactions().some(tx => String(tx.meta?.currency ?? "").toLowerCase() === currency);
  if (recorded || !Number.isInteger(actual) || actual < 0 || actual > 36) {
    const label = TOKEN_NETWORKS[customTokenNetwork(token)].label;
    throw new Error(`${token.symbol} was saved with ${token.decimals} decimals, but ${label} reports ${actual}. Re-import this token and try again.`);
  }
  const fixed = addCustomToken(userId, { address: token.address, symbol: token.symbol, decimals: actual, network: token.network });
  if (token.hidden) setTokenHidden(userId, ref, true);
  return { ...fixed, hidden: token.hidden };
}

const depositChecks = new Map<string, Promise<number>>();

/**
 * Record only confirmed, previously uncredited ERC-20 custody; no external wallet connection.
 * `tokenRef` names the token by chain + contract (the bare contract for MintMe, `eth:0x…` for Ethereum).
 */
export function syncCustomTokenDeposits(userId: string, tokenRefOrAddress: string): Promise<number> {
  const ref = tokenRefOrAddress.trim().toLowerCase();
  const parsed = parseTokenRef(ref);
  const key = `${userId}:${ref}`;
  const running = depositChecks.get(key);
  if (running) return running;
  const check = async () => {
    const info = TOKEN_NETWORKS[parsed?.network ?? "mintme"];
    let token = (await hydrateCustomTokens(userId)).find(t => customTokenRef(t) === ref);
    if (!token || !parsed) throw new Error(`Import this ${info.label} token before checking its deposit.`);
    const contract = parsed.contract;
    const chain = getSwarmChain();
    await chain.whenReady();
    token = await correctImportedDecimals(userId, token);
    const address = (await getColdKeyReceivingAddress(userId)).toLowerCase();
    const backed = await readCustomTokenCustody(address, ref, token.decimals, allTransactions(), userId);
    const flows = customTokenCustodyFlows(allTransactions(), userId, address, ref, token.decimals);
    const units = backed - flows.inflow;
    if (units <= 0n) return 0;
    const amount = unitsToNumber(units, token.decimals);
    assertCustomTokenDepositCapacity(allTransactions(), ref, amount);
    const { wallet, address: signer } = await deriveColdKey(userId);
    if (signer.toLowerCase() !== address) throw new Error("This receiving address does not match your unlocked wallet.");
    const cumulative = flows.inflow + units;
    const at = Date.now();
    const tx: SwarmTransaction = {
      id: `token-sync:${ref}:${address}:${cumulative}`, type: "external_deposit", from: address, to: userId,
      amount, chainId: "SWARM", timestamp: new Date(at).toISOString(), publicKey: address, nonce: at, fee: 0,
      signature: await wallet.signMessage(customTokenSyncMessage(userId, address, ref, token.decimals, cumulative, units)),
      meta: { currency: tokenCurrency(ref), custody: CUSTOM_TOKEN_CUSTODY, custodyAddress: address,
        address, contract, symbol: token.symbol, decimals: token.decimals,
        ...(parsed.network === "mintme" ? {} : { network: parsed.network }),
        amountUnits: units.toString(), cumulativeUnits: cumulative.toString() },
    };
    if (!await chain.acceptCustomTokenDeposit(tx)) throw new Error(`${info.label} could not confirm this deposit yet. Nothing was credited.`);
    window.dispatchEvent(new Event("blockchain-transaction"));
    // Once recorded, failed mesh delivery must never make an arrival look uncredited.
    try {
      const { getSwarmMeshStandalone } = await import("@/lib/p2p/swarmMesh.standalone");
      getSwarmMeshStandalone().broadcast("wallet-tips", tx);
      await syncPendingDeposits(userId);
    } catch { /* app-wide wallet replay retries delivery */ }
    return amount;
  };
  const result = check().finally(() => depositChecks.delete(key));
  depositChecks.set(key, result);
  return result;
}

/**
 * Withdraw native-held tokens to any address on the token's own chain (MintMe or Ethereum).
 *
 * Order matters: the on-chain move from the cold-wallet key happens FIRST.
 * Only when the chain accepts the transfer is the SWARM ledger debited — a
 * failed broadcast leaves the native balance untouched. The confirmed
 * transaction hash is engraved on the withdrawal record as proof.
 */
export async function withdrawCustomToken(p: { swarmId: string; token: CustomToken; amount: number; to: string }): Promise<SwarmTransaction> {
  const { swarmId, token, amount } = p;
  const to = p.to.trim();
  if (!isContractAddress(to)) throw new Error("Enter a valid 0x destination address");
  if (!(amount > 0) || !Number.isFinite(amount)) throw new Error("Enter an amount above zero");
  await getSwarmChain().whenReady();
  const ref = customTokenRef(token);
  const network = customTokenNetwork(token);
  const recorded = getRecordedTokenBalance(swarmId, ref);
  if (recorded < amount) throw new Error(`Your native wallet holds ${recorded} ${token.symbol} — not enough to withdraw ${amount}`);
  const authority = await getColdKeyAuthority(swarmId);
  if (!authority) throw new Error("Engrave your cold-wallet key first — a Creator Coin Vault or 1 mined SWARM is required");
  const { wallet, address: coldAddress } = await deriveColdKey(swarmId);
  const units = numberToUnits(amount, token.decimals);
  const txHash = await sendColdKeyTokenTransfer({
    wallet, tokenAddress: token.address, symbol: token.symbol, to, units, network,
  });
  const at = Date.now();
  const currency = tokenCurrency(ref);
  const tx: SwarmTransaction = {
    id: generateTransactionId(), type: "external_withdraw", from: swarmId, to,
    amount: Math.round(amount * 1e8) / 1e8, timestamp: new Date(at).toISOString(), signature: txHash,
    publicKey: coldAddress, nonce: at, fee: 0,
    meta: { kind: "external_withdraw", currency, symbol: token.symbol, contract: token.address,
      ...(network === "mintme" ? {} : { network }), address: coldAddress, destination: to, coldKeyAddress: coldAddress, keyAuthority: authority.kind, txHash,
      // Exact units sent, so deposit checks can match this withdrawal on-chain without rounding.
      amountUnits: units.toString() },
  };
  getSwarmChain().addTransaction(tx);
  try { window.dispatchEvent(new CustomEvent("blockchain-transaction", { detail: { id: tx.id } })); } catch { /* */ }
  return tx;
}
