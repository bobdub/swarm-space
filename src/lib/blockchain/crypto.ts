// Cryptographic utilities for blockchain
import { SwarmBlock, SwarmTransaction } from "./types";
import { hasLeadingHexZeros, searchNonce, toHex, type PowJob, type PowResult } from "./powSearch";

export async function calculateHash(block: SwarmBlock): Promise<string> {
  const { head, tail } = hashParts(block);
  return sha256Async(head + block.nonce.toString() + tail);
}

/**
 * The hashed text of a block is `head + nonce + tail`. Only the nonce changes
 * while mining, so the miner builds these once instead of re-serializing the
 * transactions for every attempt.
 */
function hashParts(block: SwarmBlock): { head: string; tail: string } {
  const head =
    block.index.toString() +
    block.timestamp +
    JSON.stringify(block.transactions) +
    block.previousHash;
  const tail =
    block.merkleRoot +
    // Header v2 fields are hashed too; legacy blocks hash exactly as before.
    (block.version === 2
      ? JSON.stringify({
        version: block.version, epoch: block.epoch, tick: block.tick,
        producer: block.producer, clockSession: block.clockSession, difficulty: block.difficulty,
        // Absent on blocks without witnesses, so their hash is unchanged.
        witnessRoot: block.witnessRoot,
      })
      : "");
  return { head, tail };
}

export { hasLeadingHexZeros };

/** Main-thread fallback: hash for this long, then rest this long, so frames keep coming. */
const FALLBACK_WORK_MS = 4;
const FALLBACK_REST_MS = 8;

let powWorker: Worker | null | undefined;
let powJobId = 0;
const powWaiters = new Map<number, (result: PowResult | null) => void>();

function getPowWorker(): Worker | null {
  if (powWorker !== undefined) return powWorker;
  powWorker = null;
  try {
    if (typeof Worker === "undefined") return null;
    const worker = new Worker(new URL("./pow.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; nonce?: number; hash?: string; error?: string }>) => {
      const done = powWaiters.get(e.data.id);
      powWaiters.delete(e.data.id);
      done?.(typeof e.data.nonce === "number" && typeof e.data.hash === "string" ? { nonce: e.data.nonce, hash: e.data.hash } : null);
    };
    worker.onerror = () => {
      // A worker that cannot run sends every waiting job back to the fallback.
      powWorker = null;
      for (const done of powWaiters.values()) done(null);
      powWaiters.clear();
      try { worker.terminate(); } catch { /* ignore */ }
    };
    powWorker = worker;
  } catch {
    powWorker = null;
  }
  return powWorker;
}

function searchInWorker(job: PowJob): Promise<PowResult | null> {
  const worker = getPowWorker();
  if (!worker) return Promise.resolve(null);
  const id = ++powJobId;
  return new Promise((resolve) => {
    powWaiters.set(id, resolve);
    try { worker.postMessage({ id, job }); } catch { powWaiters.delete(id); resolve(null); }
  });
}

/**
 * Proof of work: find the first nonce (counting up from `block.nonce`) whose
 * hash has `block.difficulty` leading zeros, and return it with that hash.
 * Same answer as calling `calculateHash` for each nonce in turn. The search
 * runs in a worker; mining used to stall the whole page for seconds per
 * block, starting the moment the first peer connected. Without workers it
 * runs here in short slices with rests between them.
 */
export async function findProofOfWork(block: SwarmBlock): Promise<PowResult> {
  const subtle = typeof window !== "undefined" ? window.crypto?.subtle : undefined;
  if (!subtle) {
    let nonce = block.nonce;
    const target = "0".repeat(block.difficulty);
    for (;;) {
      const hash = await calculateHash({ ...block, nonce });
      if (hash.substring(0, block.difficulty) === target) return { nonce, hash };
      nonce++;
    }
  }
  const { head, tail } = hashParts(block);
  const job: PowJob = { head, tail, start: block.nonce, difficulty: block.difficulty };
  const fromWorker = await searchInWorker(job);
  if (fromWorker && await calculateHash({ ...block, nonce: fromWorker.nonce }) === fromWorker.hash) return fromWorker;
  let sliceStart = performance.now();
  return searchNonce(subtle, job, async () => {
    if (performance.now() - sliceStart < FALLBACK_WORK_MS) return;
    await new Promise((resolve) => setTimeout(resolve, FALLBACK_REST_MS));
    sliceStart = performance.now();
  });
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
    return toHex(new Uint8Array(hashBuffer));
  }
  return sha256(message);
}

export function generateTransactionId(): string {
  return `tx-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

export function generateTokenId(): string {
  return `nft-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
