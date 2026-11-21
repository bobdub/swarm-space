/**
 * Block header v2: binds a block to its place in the mesh cadence and to the
 * identity that produced it.
 *
 * Hashed with the block (so proof of work covers them): version, epoch, tick,
 * producer, clockSession and difficulty. The producer then signs the finished
 * hash with the identity key from their vault; the signature is checked by
 * every peer but kept outside the hash.
 *
 * From the new-rules cutoff every block must carry a valid v2 header.
 */
import { arrayBufferToBase64, base64ToArrayBuffer, computeUserId } from "@/lib/crypto";
import { CADENCE_SPACING_MS, EPOCH_GAP_MS } from "./chainCatchup";
import { blockForbidsSelfMints, COMMUNITY_POOL } from "./issuance";
import type { SwarmBlock } from "./types";

export const BLOCK_VERSION = 2;

export interface BlockSigner {
  userId: string;
  publicKey: string;
  sign(hash: string): Promise<string>;
}

/** A fresh clock session per app start: ticks are only comparable within one. */
export const CLOCK_SESSION = `cs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** The cadence beat a mesh-time instant falls in. */
export function tickAt(ms: number): number {
  return Math.floor(ms / CADENCE_SPACING_MS);
}

/** Epoch for a block stamped at `ms` on top of `parent`: a long gap starts the next epoch. */
export function epochAfter(parent: Pick<SwarmBlock, "timestamp" | "version" | "epoch">, ms: number): number {
  const base = parent.version === BLOCK_VERSION && Number.isSafeInteger(parent.epoch) ? parent.epoch! : 0;
  const gap = ms - Date.parse(parent.timestamp);
  return base + (Number.isFinite(gap) && gap > EPOCH_GAP_MS ? 1 : 0);
}

/** True when a block on top of `parent` may be produced at `ms`: one block per beat. */
export function beatIsFree(parent: Pick<SwarmBlock, "timestamp">, ms: number): boolean {
  const parentAt = Date.parse(parent.timestamp);
  return !Number.isFinite(parentAt) || tickAt(ms) > tickAt(parentAt);
}

/** The v2 header fields for a block stamped at `ms` on top of `parent`. */
export function headerFor(parent: SwarmBlock, ms: number, signer: Pick<BlockSigner, "userId" | "publicKey">) {
  return {
    version: BLOCK_VERSION,
    epoch: epochAfter(parent, ms),
    tick: tickAt(ms),
    producer: { userId: signer.userId, publicKey: signer.publicKey },
    clockSession: CLOCK_SESSION,
  };
}

/** Signer backed by an identity private key (PKCS#8, base64), as kept in the vault. */
export function signerFromKeys(userId: string, publicKey: string, privateKey: string): BlockSigner {
  return {
    userId,
    publicKey,
    async sign(hash: string) {
      const key = await crypto.subtle.importKey("pkcs8", base64ToArrayBuffer(privateKey),
        { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
      const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(hash));
      return arrayBufferToBase64(sig);
    },
  };
}

/** The signed-in user's block signer, with the key unlocked from their vault. Null when locked or signed out. */
export async function getLocalBlockSigner(): Promise<BlockSigner | null> {
  try {
    const { getCurrentUser, getCachedPrivateKey } = await import("@/lib/auth");
    const user = getCurrentUser();
    if (!user?.id || !user.publicKey) return null;
    const privateKey = await getCachedPrivateKey();
    return privateKey ? signerFromKeys(user.id, user.publicKey, privateKey) : null;
  } catch {
    return null;
  }
}

async function verifySignature(publicKey: string, signature: string, hash: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("spki", base64ToArrayBuffer(publicKey),
      { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key,
      base64ToArrayBuffer(signature), new TextEncoder().encode(hash));
  } catch {
    return false;
  }
}

/**
 * Check a block's header against its parent. Legacy (unversioned) blocks pass
 * only before the new-rules cutoff. The hash and proof of work are checked by
 * the caller; this covers what the header adds.
 */
export async function verifyBlockHeader(block: SwarmBlock, parent: SwarmBlock, minDifficulty: number): Promise<boolean> {
  if (block.version === undefined) return !blockForbidsSelfMints(block);
  if (block.version !== BLOCK_VERSION) return false;
  const stamped = Date.parse(block.timestamp);
  if (!Number.isFinite(stamped)) return false;
  if (!Number.isInteger(block.difficulty) || block.difficulty < minDifficulty) return false;
  // Cadence: the tick is the block's own beat, later than its parent's, in the right epoch.
  if (block.tick !== tickAt(stamped) || !beatIsFree(parent, stamped)) return false;
  if (block.epoch !== epochAfter(parent, stamped)) return false;
  if (typeof block.clockSession !== "string" || !block.clockSession || block.clockSession.length > 64) return false;
  // Producer: the key names the user, the user is the miner and is paid the reward.
  const producer = block.producer;
  if (!producer || typeof producer.publicKey !== "string" || typeof producer.userId !== "string") return false;
  if (await computeUserId(producer.publicKey).catch(() => null) !== producer.userId) return false;
  if (block.miner !== producer.userId) return false;
  const minerRewards = block.transactions.filter((tx) => tx.type === "mining_reward" && tx.to !== COMMUNITY_POOL);
  if (minerRewards.some((tx) => tx.to !== producer.userId)) return false;
  return typeof block.producerSignature === "string"
    && await verifySignature(producer.publicKey, block.producerSignature, block.hash);
}
