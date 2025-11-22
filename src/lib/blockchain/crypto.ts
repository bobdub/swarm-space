// Cryptographic utilities for blockchain
import { SwarmBlock, SwarmTransaction } from "./types";

export function calculateHash(block: SwarmBlock): string {
  const data = 
    block.index.toString() +
    block.timestamp +
    JSON.stringify(block.transactions) +
    block.previousHash +
    block.nonce.toString() +
    block.merkleRoot;
  
  return sha256(data);
}

export function calculateMerkleRoot(transactions: SwarmTransaction[]): string {
  if (transactions.length === 0) {
    return sha256("empty");
  }

  let hashes = transactions.map(tx => sha256(JSON.stringify(tx)));

  while (hashes.length > 1) {
    const newHashes: string[] = [];
    for (let i = 0; i < hashes.length; i += 2) {
      if (i + 1 < hashes.length) {
        newHashes.push(sha256(hashes[i] + hashes[i + 1]));
      } else {
        newHashes.push(hashes[i]);
      }
    }
    hashes = newHashes;
  }

  return hashes[0];
}

export function sha256(message: string): string {
  // Simple hash function for demonstration
  // In production, use crypto.subtle.digest or a proper library
  let hash = 0;
  for (let i = 0; i < message.length; i++) {
    const char = message.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
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
