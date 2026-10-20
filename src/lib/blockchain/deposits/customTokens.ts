/**
 * Custom MintMe tokens (MintMe-chain ERC-20 contracts) imported via MetaMask.
 *
 * Same witness model as MINTME deposits: MetaMask self-transfers the token,
 * signs a claim, and the SWARM chain records an external_deposit whose
 * currency is `MINTME:<contract>`. The native wallet only shows tokens with a
 * recorded (deposited) balance.
 */
import { Interface, verifyMessage } from "ethers";
import { getSwarmChain } from "../chain";
import { generateTransactionId } from "../crypto";
import type { SwarmTransaction } from "../types";
import { getMetaMaskAccount, getMetaMaskChainId, requestMetaMask } from "../wallets/metaMaskBridge";
import { MINTME_CHAIN_ID_HEX, isMintMeChain, readMintMeChainId, switchToMintMeNetwork } from "../wallets/mintmeNetwork";
import { getLinkedWallet, _allTransactionsForExternalLedger as allTransactions } from "../wallets/walletLink";

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

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
}
async function onMintMe() {
  if (!isMintMeChain(await readMintMeChainId())) throw new Error("Select MintMe in MetaMask before checking this token.");
}
/** Switch MetaMask to MintMe first, as its own visible step. */
export async function ensureMintMe(): Promise<void> {
  await switchToMintMeNetwork();
}
async function call(to: string, data: string): Promise<string> {
  return String(await withTimeout(requestMetaMask<string>("eth_call", [{ to, data }, "latest"]), 12_000, "MintMe network did not answer"));
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
  const symbol = await call(address, ERC20.encodeFunctionData("symbol"))
    .then((r) => String(ERC20.decodeFunctionResult("symbol", r)[0]) || null).catch(() => null);
  const decimals = await call(address, ERC20.encodeFunctionData("decimals"))
    .then((r) => Number(ERC20.decodeFunctionResult("decimals", r)[0])).catch(() => null);
  return { symbol, decimals: decimals != null && Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? decimals : null };
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
  return Boolean(await requestMetaMask("wallet_watchAsset", {
    type: "ERC20", options: { address: token.address, symbol: token.symbol, decimals: token.decimals },
  }));
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
  }
  return Math.max(0, Math.round(n * 1e8) / 1e8);
}

export async function depositCustomToken(p: { swarmId: string; token: CustomToken; amount: number }): Promise<SwarmTransaction> {
  const { swarmId, token, amount } = p;
  if (!(amount > 0) || !Number.isFinite(amount)) throw new Error("Enter an amount above zero");
  const link = getLinkedWallet(swarmId);
  if (!link) throw new Error("Link your MetaMask wallet to this Swarm identity first");
  const account = (await getMetaMaskAccount())?.toLowerCase();
  if (account !== link.address) throw new Error("MetaMask is on a different account than the linked wallet");
  const held = await readTokenBalance(token, link.address);
  if (held != null && held < amount) throw new Error(`MetaMask holds ${held} ${token.symbol} — not enough`);

  const data = ERC20.encodeFunctionData("transfer", [link.address, numberToUnits(amount, token.decimals)]);
  const txHash = String(await requestMetaMask<string>("eth_sendTransaction", [
    { from: link.address, to: token.address, data, value: "0x0", chainId: MINTME_CHAIN_ID_HEX },
  ]));
  const at = Date.now();
  const currency = tokenCurrency(token.address);
  const claim = { type: "deposit", currency, symbol: token.symbol, swarmId, address: link.address, amount, txHash, at };
  const message = `Swarm-Space token record\n${JSON.stringify(claim, Object.keys(claim).sort())}`;
  const signature = String(await requestMetaMask<string>("personal_sign", [message, link.address]));
  if (verifyMessage(message, signature).toLowerCase() !== link.address) throw new Error("Signature does not match the connected wallet");

  const tx: SwarmTransaction = {
    id: generateTransactionId(), type: "external_deposit", from: link.address, to: swarmId,
    amount: Math.round(amount * 1e8) / 1e8, timestamp: new Date(at).toISOString(), signature,
    publicKey: link.address, nonce: at, fee: 0,
    meta: { kind: "external_deposit", currency, symbol: token.symbol, contract: token.address, address: link.address, txHash, claim, message, signature },
  };
  getSwarmChain().addTransaction(tx);
  try { window.dispatchEvent(new CustomEvent("blockchain-transaction", { detail: { id: tx.id } })); } catch { /* */ }
  return tx;
}
