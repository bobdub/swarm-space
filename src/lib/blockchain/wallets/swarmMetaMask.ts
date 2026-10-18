/**
 * SWARM ↔ MetaMask on the native ledger (cold-wallet model).
 * Withdraw moves SWARM from a native identity to a ledger slot keyed by the
 * linked MetaMask address; only that MetaMask key can sign it back. No RPC
 * server is involved — MetaMask is used purely as a signer.
 */
import { verifyMessage } from "ethers";
import { getSwarmChain } from "../chain";
import { generateTransactionId } from "../crypto";
import type { SwarmTransaction } from "../types";
import { getMetaMaskAccount, requestMetaMask } from "./metaMaskBridge";
import { getLinkedWallet } from "./walletLink";

const round8 = (n: number) => Math.round(n * 1e8) / 1e8;

export function buildSwarmMoveMessage(claim: Record<string, unknown>): string {
  return `Swarm-Space SWARM move\n${JSON.stringify(claim, Object.keys(claim).sort())}`;
}

async function signedMove(kind: "withdraw" | "deposit", swarmId: string, amount: number) {
  if (!(amount > 0) || !Number.isFinite(amount)) throw new Error("Enter an amount above zero");
  const link = getLinkedWallet(swarmId);
  if (!link) throw new Error("Link your MetaMask wallet to this Swarm identity first");
  const account = (await getMetaMaskAccount())?.toLowerCase();
  if (account !== link.address) throw new Error("MetaMask is on a different account than the linked wallet");
  const chain = getSwarmChain();
  await chain.whenReady();
  const source = kind === "withdraw" ? swarmId : link.address;
  if (chain.getBalance(source) < amount) throw new Error("Not enough SWARM for this move");
  const at = Date.now();
  const claim = { type: kind, currency: "SWARM", swarmId, address: link.address, amount: round8(amount), at };
  const message = buildSwarmMoveMessage(claim);
  const signature = String(await requestMetaMask<string>("personal_sign", [message, link.address]));
  if (verifyMessage(message, signature).toLowerCase() !== link.address) throw new Error("Signature does not match the connected wallet");
  // Re-check after the signing prompt so two moves can't overspend.
  if (chain.getBalance(source) < amount) throw new Error("Not enough SWARM for this move");
  const tx: SwarmTransaction = {
    id: generateTransactionId(),
    type: kind === "withdraw" ? "external_withdraw" : "external_deposit",
    from: source, to: kind === "withdraw" ? link.address : swarmId,
    amount: round8(amount), timestamp: new Date(at).toISOString(), signature, publicKey: link.address,
    nonce: at, fee: 0, meta: { kind: `swarm_${kind}`, currency: "SWARM", address: link.address, claim, message, signature },
  };
  chain.addTransaction(tx);
  try { window.dispatchEvent(new CustomEvent("blockchain-transaction", { detail: { id: tx.id } })); } catch { /* non-browser */ }
  return tx;
}

/** Native SWARM → linked MetaMask key's slot. */
export const withdrawSwarmToMetaMask = (swarmId: string, amount: number) => signedMove("withdraw", swarmId, amount);
/** MetaMask key's slot → native SWARM (MetaMask must sign). */
export const depositSwarmFromMetaMask = (swarmId: string, amount: number) => signedMove("deposit", swarmId, amount);

export async function getMetaMaskSwarmBalance(address: string | null | undefined): Promise<number> {
  if (!address) return 0;
  const chain = getSwarmChain();
  await chain.whenReady();
  return chain.getBalance(address.toLowerCase());
}
