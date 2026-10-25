/**
 * Custom MintMe tokens (MintMe-chain ERC-20 contracts) imported via MetaMask.
 *
 * Same witness model as MINTME deposits: MetaMask transfers the token to the
 * depositor's native SWARM wallet address in a single confirmation, and the
 * SWARM chain records an external_deposit whose currency is
 * `MINTME:<contract>`. The confirmed transfer hash is the ownership proof —
 * no separate message-signing or link step. The native wallet only shows
 * tokens with a recorded (deposited) balance.
 */
import { Interface, id } from "ethers";
import { isDepositSynced, markDepositsSynced, connectedPeerCount } from "./depositSync";
import { METAMASK_RESPONSE_TIMEOUT_MS } from "../wallets/metaMaskRequestTimeout";
import { getSwarmChain } from "../chain";
import { generateTransactionId } from "../crypto";
import { deriveColdKey, getColdKeyReceivingAddress, getColdKeyAuthority, sendColdKeyTokenTransfer } from "../wallets/coldKey";
import type { SwarmTransaction } from "../types";
import { connectMetaMask, getMetaMaskAccount, requestMetaMask } from "../wallets/metaMaskBridge";
import { MINTME_CHAIN_ID_HEX, isMintMeChain, readMintMeChainId, switchToMintMeNetwork } from "../wallets/mintmeNetwork";
import { getLinkedWallet, _allTransactionsForExternalLedger as allTransactions } from "../wallets/walletLink";
import { assertCustomTokenDepositCapacity, customTokenDepositCapacity } from "./customTokenLimits";
import { waitForMetaMask } from "../wallets/metaMaskRequestTimeout";
export { CUSTOM_TOKEN_DEPOSIT_MAX } from "./customTokenLimits";

export function getCustomTokenDepositCapacity(address: string) {
  return customTokenDepositCapacity(allTransactions(), address);
}

export interface CustomToken { address: string; symbol: string; decimals: number; hidden?: boolean; addedAt: number }

const ERC20 = new Interface([
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address,uint256) returns (bool)",
]);
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
/** MetaMask needs a moment after importing before a transfer is reliable. */
export const DEPOSIT_PREP_MS = 15_000;
export function depositPrepRemainingMs(token: Pick<CustomToken, "addedAt">, now = Date.now()): number {
  return Math.max(0, (token.addedAt || 0) + DEPOSIT_PREP_MS - now);
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
/** Hiding is only allowed when nothing is held in MetaMask or recorded natively. */
export function canHideToken(metaMaskBalance: number | null, recorded: number): boolean {
  return metaMaskBalance === 0 && recorded <= 0;
}
export function setTokenHidden(uid: string, address: string, hidden: boolean) {
  save(uid, listCustomTokens(uid).map((t) => (t.address === address.toLowerCase() ? { ...t, hidden } : t)));
}

async function onMintMe() {
  if (!isMintMeChain(await readMintMeChainId())) throw new Error("Select MintMe in MetaMask before checking this token.");
}
/** Switch MetaMask to MintMe first, as its own visible step. */
export async function ensureMintMe(): Promise<void> {
  await switchToMintMeNetwork();
}
async function call(to: string, data: string): Promise<string> {
  return String(await waitForMetaMask(requestMetaMask<string>("eth_call", [{ to, data }, "latest"]), "MetaMask could not read this token yet. Open MetaMask and try again."));
}

export function unitsToNumber(raw: bigint, decimals: number): number {
  const base = 10n ** BigInt(decimals);
  return Number(raw / base) + Number(raw % base) / Number(base);
}
export function numberToUnits(amount: number, decimals: number): bigint {
  const [w, f = ""] = amount.toFixed(Math.min(decimals, 18)).split(".");
  return BigInt(w) * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}

/** Best-effort read of symbol/decimals; null fields mean the user fills them in. Assumes MintMe is already selected. */
export async function readTokenMetadata(address: string): Promise<{ symbol: string | null; decimals: number | null }> {
  await onMintMe();
  return readMetadata(address);
}
async function readMetadata(address: string): Promise<{ symbol: string | null; decimals: number | null }> {
  const [symbol, decimals] = await Promise.all([
    call(address, ERC20.encodeFunctionData("symbol"))
      .then((r) => String(ERC20.decodeFunctionResult("symbol", r)[0]) || null).catch(() => null),
    call(address, ERC20.encodeFunctionData("decimals"))
      .then((r) => Number(ERC20.decodeFunctionResult("decimals", r)[0])).catch(() => null),
  ]);
  return { symbol, decimals: decimals != null && Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? decimals : null };
}

/** One chain read, then parallel data reads. Balance is not evidence of wallet tracking. */
export async function readTokenDetails(address: string, owner: string) {
  await onMintMe();
  const [metadata, rawBalance] = await Promise.all([
    readMetadata(address),
    call(address, ERC20.encodeFunctionData("balanceOf", [owner]))
      .then((r) => ERC20.decodeFunctionResult("balanceOf", r)[0] as bigint).catch(() => null),
  ]);
  return { ...metadata, rawBalance };
}

export async function readTokenBalance(token: CustomToken, owner: string): Promise<number | null> {
  try {
    await onMintMe();
    const raw = ERC20.decodeFunctionResult("balanceOf", await call(token.address, ERC20.encodeFunctionData("balanceOf", [owner])))[0] as bigint;
    return unitsToNumber(raw, token.decimals);
  } catch { return null; }
}

/** Ask MetaMask to track the token (EIP-747). */
export async function watchInMetaMask(token: CustomToken): Promise<boolean> {
  await onMintMe();
  return (await waitForMetaMask(requestMetaMask("wallet_watchAsset", {
    type: "ERC20", options: { address: token.address, symbol: token.symbol, decimals: token.decimals },
  }), "MetaMask did not confirm adding this token. Open MetaMask and try again.")) === true;
}

/** EIP-1193 does not expose tracked-token inventory. Only wallet approval permits saving. */
export async function importCustomTokenFromMetaMask(uid: string, details: Omit<CustomToken, "addedAt">): Promise<CustomToken> {
  if (!isContractAddress(details.address) || !isValidSymbol(details.symbol) || !Number.isInteger(details.decimals) || details.decimals < 0 || details.decimals > 36) {
    throw new Error("Check the token address, symbol and decimals before adding it.");
  }
  const token = { ...details, address: details.address.trim().toLowerCase(), symbol: details.symbol.trim().toUpperCase(), addedAt: 0 };
  if (!await watchInMetaMask(token)) throw new Error("Token was not added in MetaMask. Nothing was saved here.");
  return addCustomToken(uid, token);
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

const TRANSFER_TOPIC = id("Transfer(address,address,uint256)");
const pad = (a: string) => `0x${a.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
export const RECEIPT_POLL_MS = 3_000;

/**
 * Wait for MintMe to mine the transfer and prove the tokens reached the
 * cold-key address. Nothing is credited before this returns.
 */
export async function waitForDepositReceipt(p: { txHash: string; token: string; destination: string; units: bigint; timeoutMs?: number; pollMs?: number }): Promise<void> {
  const deadline = Date.now() + (p.timeoutMs ?? METAMASK_RESPONSE_TIMEOUT_MS);
  for (;;) {
    let r: { status?: string; logs?: { address: string; topics: string[]; data: string }[] } | null = null;
    try { r = await requestMetaMask("eth_getTransactionReceipt", [p.txHash]); } catch { r = null; }
    if (r) {
      if (r.status !== "0x1") throw new Error("MintMe rejected the transfer — nothing was credited to your native wallet.");
      const ok = (r.logs ?? []).some((l) => l.address.toLowerCase() === p.token.toLowerCase()
        && l.topics?.[0] === TRANSFER_TOPIC && l.topics?.[2]?.toLowerCase() === pad(p.destination)
        && BigInt(l.data) >= p.units);
      if (!ok) throw new Error("MintMe confirmed the transaction but it did not deliver the tokens to your native wallet address — nothing was credited.");
      return;
    }
    if (Date.now() > deadline) throw new Error(`MintMe has not confirmed transfer ${p.txHash} yet. Nothing was credited; it is safe to retry the record later once it confirms.`);
    await new Promise((res) => setTimeout(res, p.pollMs ?? RECEIPT_POLL_MS));
  }
}

const depositing = new Set<string>();
export async function depositCustomToken(p: { swarmId: string; token: CustomToken; amount: number; pollMs?: number }): Promise<SwarmTransaction> {
  const currency = tokenCurrency(p.token.address);
  if (depositing.has(currency)) throw new Error("A deposit for this token is already awaiting confirmation");
  depositing.add(currency);
  try { return await recordCustomTokenDeposit(p); }
  finally { depositing.delete(currency); }
}

async function recordCustomTokenDeposit(p: { swarmId: string; token: CustomToken; amount: number; pollMs?: number }): Promise<SwarmTransaction> {
  const { swarmId, token, amount } = p;
  if (!(amount > 0) || !Number.isFinite(amount)) throw new Error("Enter an amount above zero");
  await getSwarmChain().whenReady();
  assertCustomTokenDepositCapacity(allTransactions(), token.address, amount);
  // Resolve the connected account, prompting MetaMask to connect if the
  // session was lost. No separate link step: the confirmed transfer below is
  // itself the ownership proof recorded on the SWARM ledger.
  let account = (await getMetaMaskAccount())?.toLowerCase();
  if (!account) account = (await connectMetaMask())?.address.toLowerCase();
  if (!account) throw new Error("Connect MetaMask first");
  const link = getLinkedWallet(swarmId);
  if (link && account !== link.address) throw new Error("MetaMask is on a different account than the linked wallet");
  const held = await readTokenBalance(token, account);
  if (held == null) throw new Error("Could not verify your MintMe token balance. Select MintMe and retry before depositing.");
  if (held < amount) throw new Error(`MetaMask holds ${held} ${token.symbol} — not enough`);
  assertCustomTokenDepositCapacity(allTransactions(), token.address, amount);

  // The tokens actually leave MetaMask: the destination is the depositor's
  // cold-wallet key address — the native wallet's EVM face, which the owner
  // alone can later sign from to withdraw. A self-transfer would confirm
  // without moving any balance.
  const destination = await getColdKeyReceivingAddress(swarmId);
  const units = numberToUnits(amount, token.decimals);
  const data = ERC20.encodeFunctionData("transfer", [destination, units]);
  const txHash = String(await requestMetaMask<string>("eth_sendTransaction", [
    { from: account, to: token.address, data, value: "0x0", chainId: MINTME_CHAIN_ID_HEX },
  ]));
  await waitForDepositReceipt({ txHash, token: token.address, destination, units, pollMs: p.pollMs });
  const at = Date.now();
  const currency = tokenCurrency(token.address);
  const claim = { type: "deposit", currency, symbol: token.symbol, swarmId, address: account, destination, amount, txHash, at };

  const tx: SwarmTransaction = {
    id: generateTransactionId(), type: "external_deposit", from: account, to: swarmId,
    amount: Math.round(amount * 1e8) / 1e8, timestamp: new Date(at).toISOString(), signature: txHash,
    publicKey: account, nonce: at, fee: 0,
    meta: { kind: "external_deposit", currency, symbol: token.symbol, contract: token.address, address: account, destination, txHash, claim },
  };
  getSwarmChain().addTransaction(tx);
  try { window.dispatchEvent(new CustomEvent("blockchain-transaction", { detail: { id: tx.id } })); } catch { /* */ }
  void connectedPeerCount().then((n) => markDepositsSynced([tx.id], n));
  return tx;
}

/**
 * Withdraw bridged tokens back to MetaMask.
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
  // MetaMask must be connected: it is the witness and prepares the
  // destination address. The confirmed MintMe transfer below is the proof.
  let account = (await getMetaMaskAccount())?.toLowerCase();
  if (!account) account = (await connectMetaMask())?.address.toLowerCase();
  if (!account) throw new Error("Connect MetaMask first");
  const link = getLinkedWallet(swarmId);
  if (link && account !== link.address) throw new Error("MetaMask is on a different account than the linked wallet");
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
    meta: { kind: "external_withdraw", currency, symbol: token.symbol, contract: token.address, address: account, destination: to, coldKeyAddress: coldAddress, keyAuthority: authority.kind, txHash },
  };
  getSwarmChain().addTransaction(tx);
  try { window.dispatchEvent(new CustomEvent("blockchain-transaction", { detail: { id: tx.id } })); } catch { /* */ }
  return tx;
}
