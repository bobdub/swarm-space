/**
 * Wallet link — bind a MetaMask address to a SWARM identity.
 *
 * The user's MetaMask signs a short ownership message. The signature is
 * written onto the SWARM chain as a `wallet_link` transaction, so any peer
 * can independently verify (with ethers.verifyMessage) that the address
 * really belongs to that Swarm identity. No server, no custodian.
 */

import { verifyMessage } from "ethers";
import { getSwarmChain } from "../chain";
import { generateTransactionId } from "../crypto";
import { getMetaMaskAccount, requestMetaMask } from "./metaMaskBridge";
import type { SwarmTransaction } from "../types";

export interface WalletLink {
  swarmId: string;
  address: string;
  linkedAt: string;
  txId: string;
}

export function buildLinkMessage(swarmId: string, address: string, at: number): string {
  return [
    "Swarm-Space wallet link",
    `Swarm identity: ${swarmId}`,
    `Wallet: ${address.toLowerCase()}`,
    `Issued: ${new Date(at).toISOString()}`,
    "Signing this proves you control this wallet. It moves no funds.",
  ].join("\n");
}

function allTransactions(): SwarmTransaction[] {
  const chain = getSwarmChain();
  const out: SwarmTransaction[] = [];
  for (const block of chain.getChain()) {
    for (const tx of block.transactions ?? []) out.push(tx);
  }
  for (const tx of chain.getPendingTransactions()) out.push(tx);
  return out.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
}

function verifiedLinkFrom(tx: SwarmTransaction): WalletLink | null {
  const meta = (tx.meta ?? {}) as Record<string, unknown>;
  const address = typeof meta.address === "string" ? meta.address.toLowerCase() : "";
  const message = typeof meta.message === "string" ? meta.message : "";
  const signature = typeof meta.signature === "string" ? meta.signature : "";
  if (!address || !message || !signature) return null;
  try {
    const recovered = verifyMessage(message, signature).toLowerCase();
    if (recovered !== address) return null;
  } catch {
    return null;
  }
  return { swarmId: tx.from, address, linkedAt: tx.timestamp, txId: tx.id };
}

/**
 * The address currently bound to this Swarm identity, or null. Only counts
 * links whose signature verifies and that were not later revoked.
 */
export function getLinkedWallet(swarmId: string): WalletLink | null {
  if (!swarmId) return null;
  let current: WalletLink | null = null;
  for (const tx of allTransactions()) {
    if (tx.from !== swarmId) continue;
    if (tx.type === "wallet_link") {
      const link = verifiedLinkFrom(tx);
      if (link) current = link;
    } else if (tx.type === "wallet_unlink") {
      const meta = (tx.meta ?? {}) as Record<string, unknown>;
      const addr = typeof meta.address === "string" ? meta.address.toLowerCase() : "";
      if (!current || !addr || current.address === addr) current = null;
    }
  }
  return current;
}

export function isWalletLinked(swarmId: string, address: string | null | undefined): boolean {
  if (!address) return false;
  const link = getLinkedWallet(swarmId);
  return !!link && link.address === address.toLowerCase();
}

/** Ask MetaMask to sign the ownership proof and write it onto the chain. */
export async function linkMetaMaskWallet(swarmId: string): Promise<WalletLink> {
  if (!swarmId) throw new Error("Sign in first");
  const address = await getMetaMaskAccount();
  if (!address) throw new Error("Connect MetaMask first");
  const at = Date.now();
  const message = buildLinkMessage(swarmId, address, at);
  const signature = await requestMetaMask<string>("personal_sign", [message, address]);

  let recovered: string;
  try {
    recovered = verifyMessage(message, String(signature)).toLowerCase();
  } catch {
    throw new Error("Could not read the MetaMask signature");
  }
  if (recovered !== address.toLowerCase()) {
    throw new Error("Signature does not match the connected wallet");
  }

  const tx: SwarmTransaction = {
    id: generateTransactionId(),
    type: "wallet_link",
    from: swarmId,
    to: address.toLowerCase(),
    amount: 0,
    timestamp: new Date(at).toISOString(),
    signature: String(signature),
    publicKey: address.toLowerCase(),
    nonce: at,
    fee: 0,
    meta: {
      kind: "wallet_link",
      address: address.toLowerCase(),
      message,
      signature: String(signature),
    },
  };
  getSwarmChain().addTransaction(tx);
  try {
    window.dispatchEvent(new CustomEvent("blockchain-transaction", { detail: { id: tx.id } }));
  } catch { /* non-browser */ }

  return { swarmId, address: address.toLowerCase(), linkedAt: tx.timestamp, txId: tx.id };
}

/** Revoke the current binding. Writes a matching entry onto the chain. */
export function unlinkMetaMaskWallet(swarmId: string): void {
  const link = getLinkedWallet(swarmId);
  if (!link) return;
  const tx: SwarmTransaction = {
    id: generateTransactionId(),
    type: "wallet_unlink",
    from: swarmId,
    to: link.address,
    amount: 0,
    timestamp: new Date().toISOString(),
    signature: "",
    publicKey: swarmId,
    nonce: Date.now(),
    fee: 0,
    meta: { kind: "wallet_unlink", address: link.address, revokes: link.txId },
  };
  getSwarmChain().addTransaction(tx);
  try {
    window.dispatchEvent(new CustomEvent("blockchain-transaction", { detail: { id: tx.id } }));
  } catch { /* non-browser */ }
}

export { allTransactions as _allTransactionsForExternalLedger };
