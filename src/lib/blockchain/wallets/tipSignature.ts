import { arrayBufferToBase64, base64ToArrayBuffer, computeUserId } from "@/lib/crypto";
import type { SwarmTransaction } from "../types";

function payload(tx: SwarmTransaction): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    id: tx.id, type: tx.type, from: tx.from, to: tx.to, amount: tx.amount,
    tokenId: tx.tokenId ?? null, chainId: tx.chainId ?? "SWARM",
    timestamp: tx.timestamp, nonce: tx.nonce, fee: tx.fee, meta: tx.meta,
  }));
}

export async function signWalletTip(tx: SwarmTransaction, privateKey: string): Promise<SwarmTransaction> {
  // Identity keys use the same P-256 encoding; import for signing without exporting a new key.
  const key = await crypto.subtle.importKey("pkcs8", base64ToArrayBuffer(privateKey),
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, payload(tx));
  return { ...tx, signature: arrayBufferToBase64(signature) };
}

export async function verifyWalletTip(tx: SwarmTransaction): Promise<boolean> {
  try {
    if (tx.type !== "wallet_tip" || await computeUserId(tx.publicKey) !== tx.from) return false;
    if (!Number.isFinite(tx.amount) || (tx.amount ?? 0) <= 0 || tx.from === tx.to || tx.fee !== 0) return false;
    const key = await crypto.subtle.importKey("spki", base64ToArrayBuffer(tx.publicKey),
      { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key,
      base64ToArrayBuffer(tx.signature), payload(tx));
  } catch { return false; }
}