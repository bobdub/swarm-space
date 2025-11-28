// Cryptographic utilities for blockchain
import { SwarmBlock, SwarmTransaction } from "./types";

export async function calculateHash(block: SwarmBlock): Promise<string> {
  const data = 
    block.index.toString() +
    block.timestamp +
    JSON.stringify(block.transactions) +
    block.previousHash +
    block.nonce.toString() +
    block.merkleRoot;
  
  return sha256Async(data);
}

export async function calculateMerkleRoot(transactions: SwarmTransaction[]): Promise<string> {
  if (transactions.length === 0) {
    return sha256Async("empty");
  }

  let hashes = await Promise.all(
    transactions.map(tx => sha256Async(JSON.stringify(tx)))
  );

  while (hashes.length > 1) {
    const newHashes: string[] = [];
    for (let i = 0; i < hashes.length; i += 2) {
      if (i + 1 < hashes.length) {
        newHashes.push(await sha256Async(hashes[i] + hashes[i + 1]));
      } else {
        newHashes.push(hashes[i]);
      }
    }
    hashes = newHashes;
  }

  return hashes[0];
}

/**
 * @deprecated Use sha256Async instead. This synchronous version uses a weak 32-bit hash.
 * Only kept for fallback compatibility in non-browser environments.
 */
export function sha256(message: string): string {
  // SECURITY WARNING: This is a weak 32-bit hash for fallback only
  // Use sha256Async() which implements proper SHA-256 via Web Crypto API
  let hash = 0;
  for (let i = 0; i < message.length; i++) {
    const char = message.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(64, '0');
}

export async function sha256Async(message: string): Promise<string> {
  if (typeof window !== "undefined" && window.crypto && window.crypto.subtle) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return sha256(message);
}

export function generateTransactionId(): string {
  return `tx-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function generateTokenId(): string {
  return `nft-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
