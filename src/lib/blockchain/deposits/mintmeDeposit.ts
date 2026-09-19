/**
 * MintMe deposits onto the SWARM blockchain.
 *
 * There is no server and no node of our own, so MetaMask is the only witness
 * to a MintMe transfer. A deposit therefore records, on the SWARM chain:
 *   - the bound wallet address (proved in walletLink.ts),
 *   - the tx hash MetaMask returned for the transfer,
 *   - the balance MetaMask reported at that moment,
 *   - a MetaMask signature over that exact claim.
 *
 * Peers keep the signed record and can re-check it later against a MintMe
 * node. Custody never leaves the user's own wallet — the chain carries the
 * record, not the coins.
 */

import { verifyMessage } from "ethers";
import { getSwarmChain } from "../chain";
import { generateTransactionId } from "../crypto";
import type { SwarmTransaction } from "../types";
import { getMetaMaskAccount, getMetaMaskChainId, requestMetaMask } from "../wallets/metaMaskBridge";
import { isMintMeChain, switchToMintMeNetwork } from "../wallets/mintmeNetwork";
import { readMintMeBalance, sendMintMe } from "../wallets/mintmeBridge";
import { getLinkedWallet, _allTransactionsForExternalLedger as allTransactions } from "../wallets/walletLink";

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
  return getMintMeLedger(swarmId).recorded;
}

function commit(tx: SwarmTransaction): void {
  getSwarmChain().addTransaction(tx);
  try {
    window.dispatchEvent(new CustomEvent("blockchain-transaction", { detail: { id: tx.id } }));
  } catch { /* non-browser */ }
}

async function signClaim(address: string, claim: Record<string, unknown>): Promise<{ message: string; signature: string }> {
  const message = `Swarm-Space MINTME record\n${JSON.stringify(claim, Object.keys(claim).sort())}`;
  const signature = String(await requestMetaMask<string>("personal_sign", [message, address]));
  const recovered = verifyMessage(message, signature).toLowerCase();
  if (recovered !== address.toLowerCase()) throw new Error("Signature does not match the connected wallet");
  return { message, signature };
}

async function requireBoundWallet(swarmId: string): Promise<string> {
  const link = getLinkedWallet(swarmId);
  if (!link) throw new Error("Link your MetaMask wallet to this Swarm identity first");
  const account = (await getMetaMaskAccount())?.toLowerCase();
  if (!account) throw new Error("Connect MetaMask first");
  if (account !== link.address) {
    throw new Error("MetaMask is on a different account than the linked wallet");
  }
  const chain = await getMetaMaskChainId();
  if (!isMintMeChain(chain)) await switchToMintMeNetwork();
  return link.address;
}

/**
 * Move MintMe into the Swarm wallet. The transfer is signed in MetaMask and
 * sent to the user's own bound address, then recorded on the SWARM chain.
 */
export async function depositMintMe(params: {
  swarmId: string;
  amount: number;
}): Promise<SwarmTransaction> {
  const { swarmId, amount } = params;
  if (!(amount > 0) || !Number.isFinite(amount)) throw new Error("Enter an amount above zero");
  const address = await requireBoundWallet(swarmId);

  const before = await readMintMeBalance(address);
  if (before != null && before < amount) {
    throw new Error(`MetaMask holds ${before.toFixed(6)} MINTME — not enough for this deposit`);
  }

  // Self-transfer on the MintMe chain: custody stays with the user, MetaMask
  // produces the on-chain hash that anchors the record.
  const txHash = await sendMintMe({ to: address, amountEth: amount });
  const observed = await readMintMeBalance(address);

  const at = Date.now();
  const claim = {
    type: "deposit",
    currency: MINTME,
    swarmId,
    address,
    amount,
    txHash,
    reportedBalance: observed ?? before ?? 0,
    at,
  };
  const { message, signature } = await signClaim(address, claim);

  const tx: SwarmTransaction = {
    id: generateTransactionId(),
    type: "external_deposit",
    from: address,
    to: swarmId,
    amount: round8(amount),
    timestamp: new Date(at).toISOString(),
    signature,
    publicKey: address,
    nonce: at,
    fee: 0,
    meta: { kind: "external_deposit", currency: MINTME, address, txHash, claim, message, signature },
  };
  commit(tx);
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
  const recorded = getChainMintmeBalance(swarmId);
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
