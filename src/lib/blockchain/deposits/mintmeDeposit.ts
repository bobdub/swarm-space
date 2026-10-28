/** Native MINTME custody deposits and historical external-wallet records.
 * Native SWARM transfers move accepted custody claims; external MintMe
 * transfers remain separate and require custody signing authority.
 */

import { getSwarmChain } from "../chain";
import { generateTransactionId } from "../crypto";
import type { SwarmTransaction } from "../types";
import { getMetaMaskAccount, getMetaMaskChainId } from "../wallets/metaMaskBridge";
import { isMintMeChain, switchToMintMeNetwork } from "../wallets/mintmeNetwork";
import { readMintMeBalance, sendMintMe } from "../wallets/mintmeBridge";
import { getLinkedWallet, _allTransactionsForExternalLedger as allTransactions } from "../wallets/walletLink";
import { mintMeAmount, mintMeUnits, mintMeCustodyMessage, NATIVE_MINTME_CUSTODY } from "../wallets/nativeMintmeLedger";
import { deriveColdKey, getColdKeyReceivingAddress } from "../wallets/coldKey";

export const MINTME = "MINTME";

export interface ExternalEntry {
  id: string;
  kind: "deposit" | "withdraw" | "reconcile";
  amount: number;
  txHash?: string;
  at: string;
}

export interface MintMeLedger {
  /** Recorded on the SWARM chain for this identity. */
  recorded: number;
  entries: ExternalEntry[];
  lastEntryAt: string | null;
}

function round8(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

function metaOf(tx: SwarmTransaction): Record<string, unknown> {
  return (tx.meta ?? {}) as Record<string, unknown>;
}

/** Walk the chain and rebuild this identity's MINTME position. */
export function getMintMeLedger(swarmId: string): MintMeLedger {
  const entries: ExternalEntry[] = [];
  let recorded = 0;
  if (!swarmId) return { recorded: 0, entries, lastEntryAt: null };

  for (const tx of allTransactions()) {
    const meta = metaOf(tx);
    if (meta.currency !== MINTME) continue;
    const mine = tx.to === swarmId || tx.from === swarmId;
    if (!mine) continue;
    const amount = Number(tx.amount ?? 0);

    if (tx.type === "external_deposit" && tx.to === swarmId) {
      recorded += amount;
      entries.push({ id: tx.id, kind: "deposit", amount, txHash: String(meta.txHash ?? ""), at: tx.timestamp });
    } else if (tx.type === "external_withdraw" && tx.from === swarmId) {
      recorded -= amount;
      entries.push({ id: tx.id, kind: "withdraw", amount, txHash: String(meta.txHash ?? ""), at: tx.timestamp });
    } else if (tx.type === "external_reconcile" && tx.to === swarmId) {
      const delta = Number(meta.delta ?? 0);
      recorded += delta;
      entries.push({ id: tx.id, kind: "reconcile", amount: delta, at: tx.timestamp });
    }
  }

  recorded = Math.max(0, round8(recorded));
  return {
    recorded,
    entries: entries.reverse(),
    lastEntryAt: entries[0]?.at ?? null,
  };
}

export function getChainMintmeBalance(swarmId: string): number {
  return mintMeAmount(getSwarmChain().getNativeMintMeBalanceUnits(swarmId));
}

function commit(tx: SwarmTransaction): void {
  getSwarmChain().addTransaction(tx);
  try {
    window.dispatchEvent(new CustomEvent("blockchain-transaction", { detail: { id: tx.id } }));
  } catch { /* non-browser */ }
}

/**
 * External import only: MetaMask sends to native cold-key custody. The
 * receipt and custody authorization must verify before native funds appear.
 */
export async function depositMintMe(params: {
  swarmId: string;
  amount: number;
}): Promise<SwarmTransaction> {
  const { swarmId, amount } = params;
  if (!(amount > 0) || !Number.isFinite(amount)) throw new Error("Enter an amount above zero");
  const address = await getMetaMaskAccount();
  if (!address) throw new Error("Connect MetaMask to deposit from your external wallet.");
  if (!isMintMeChain(await getMetaMaskChainId())) await switchToMintMeNetwork();
  const destination = await getColdKeyReceivingAddress(swarmId);
  if (destination.toLowerCase() === address.toLowerCase()) throw new Error("A self-transfer cannot fund the native wallet.");
  const units = mintMeUnits(amount);

  const before = await readMintMeBalance(address);
  if (before != null && before < amount) {
    throw new Error(`MetaMask holds ${before.toFixed(6)} MINTME — not enough for this deposit`);
  }

  const txHash = await sendMintMe({ to: destination, amountEth: amount });
  return recordNativeMintMeCustody({ swarmId, from: address, txHash, amountUnits: units });
}

/** Also accepts a real pool receipt into the configured community identity.
 * The same hash is the deposit id on every device, preventing duplicate credit.
 */
export async function recordNativeMintMeCustody(params: {
  swarmId: string; from: string; txHash: string; amountUnits: bigint;
}): Promise<SwarmTransaction> {
  const { swarmId, from, amountUnits } = params;
  const txHash = params.txHash.toLowerCase();
  const { wallet, address } = await deriveColdKey(swarmId);
  const at = Date.now();
  const tx: SwarmTransaction = {
    id: `mintme-custody:${txHash}`, type: "external_deposit", from, to: swarmId,
    amount: mintMeAmount(amountUnits), chainId: "SWARM", timestamp: new Date(at).toISOString(),
    publicKey: address, signature: await wallet.signMessage(mintMeCustodyMessage(swarmId, address, txHash, amountUnits)),
    nonce: at, fee: 0,
    meta: { currency: MINTME, custody: NATIVE_MINTME_CUSTODY, custodyAddress: address,
      txHash, amountUnits: amountUnits.toString() },
  };
  const deadline = Date.now() + 300_000;
  while (!await getSwarmChain().acceptNativeMintMeDeposit(tx)) {
    if (Date.now() >= deadline) throw new Error(`MintMe has not confirmed custody yet. No native funds were credited. Retry recording ${txHash} after confirmation.`);
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  window.dispatchEvent(new Event("blockchain-transaction"));
  const { getSwarmMeshStandalone } = await import("@/lib/p2p/swarmMesh.standalone");
  getSwarmMeshStandalone().broadcast("wallet-tips", tx);
  return tx;
}

/** Record MintMe leaving the wallet, so the chain position stays truthful. */
export async function recordMintMeWithdrawal(params: {
  swarmId: string;
  amount: number;
  to: string;
  txHash: string;
}): Promise<SwarmTransaction | null> {
  const { swarmId, amount, to, txHash } = params;
  const link = getLinkedWallet(swarmId);
  if (!link) return null;
  const at = Date.now();
  const tx: SwarmTransaction = {
    id: generateTransactionId(),
    type: "external_withdraw",
    from: swarmId,
    to: to.toLowerCase(),
    amount: round8(amount),
    timestamp: new Date(at).toISOString(),
    signature: "",
    publicKey: link.address,
    nonce: at,
    fee: 0,
    meta: { kind: "external_withdraw", currency: MINTME, address: link.address, txHash },
  };
  commit(tx);
  return tx;
}

export interface ReconcileResult {
  recorded: number;
  observed: number | null;
  drift: number;
  adjusted: boolean;
}

/**
 * Compare the chain record with what MetaMask reports. When the wallet holds
 * less than the chain says, write a reconcile entry instead of silently
 * changing the number.
 */
export async function reconcileMintMe(swarmId: string, opts?: { write?: boolean }): Promise<ReconcileResult> {
  const recorded = getMintMeLedger(swarmId).recorded;
  const link = getLinkedWallet(swarmId);
  if (!link) return { recorded, observed: null, drift: 0, adjusted: false };
  const observed = await readMintMeBalance(link.address);
  if (observed == null) return { recorded, observed: null, drift: 0, adjusted: false };

  const drift = round8(observed - recorded);
  if (!opts?.write || drift >= 0 || Math.abs(drift) < 1e-8) {
    return { recorded, observed, drift, adjusted: false };
  }

  const at = Date.now();
  const tx: SwarmTransaction = {
    id: generateTransactionId(),
    type: "external_reconcile",
    from: link.address,
    to: swarmId,
    amount: 0,
    timestamp: new Date(at).toISOString(),
    signature: "",
    publicKey: link.address,
    nonce: at,
    fee: 0,
    meta: {
      kind: "external_reconcile",
      currency: MINTME,
      address: link.address,
      delta: drift,
      observedBalance: observed,
      previousRecorded: recorded,
    },
  };
  commit(tx);
  return { recorded: round8(recorded + drift), observed, drift, adjusted: true };
}

