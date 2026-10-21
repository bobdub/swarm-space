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
import { Interface } from "ethers";
import { getSwarmChain } from "../chain";
import { generateTransactionId } from "../crypto";
import { swarmIdToEvmAddress } from "../gateway/addressMap";
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
  try { const v = JSON.parse(localStorage.getItem(KEY(uid)) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function save(uid: string, list: CustomToken[]) {
  localStorage.setItem(KEY(uid), JSON.stringify(list));
  try { window.dispatchEvent(new CustomEvent(CUSTOM_TOKENS_EVENT)); } catch { /* non-browser */ }
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

const depositing = new Set<string>();
export async function depositCustomToken(p: { swarmId: string; token: CustomToken; amount: number }): Promise<SwarmTransaction> {
  const currency = tokenCurrency(p.token.address);
  if (depositing.has(currency)) throw new Error("A deposit for this token is already awaiting confirmation");
  depositing.add(currency);
  try { return await recordCustomTokenDeposit(p); }
  finally { depositing.delete(currency); }
}

async function recordCustomTokenDeposit(p: { swarmId: string; token: CustomToken; amount: number }): Promise<SwarmTransaction> {
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
  // native SWARM wallet address, not their own MetaMask account. A
  // self-transfer would confirm without moving any balance.
  const destination = await swarmIdToEvmAddress(swarmId);
  const data = ERC20.encodeFunctionData("transfer", [destination, numberToUnits(amount, token.decimals)]);
  const txHash = String(await requestMetaMask<string>("eth_sendTransaction", [
    { from: account, to: token.address, data, value: "0x0", chainId: MINTME_CHAIN_ID_HEX },
  ]));
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
  return tx;
}
