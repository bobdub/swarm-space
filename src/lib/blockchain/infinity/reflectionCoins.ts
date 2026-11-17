/**
 * Infinity reflection coins — Phase 4 of the concentric brain.
 *
 * When Infinity crystallizes a complete 2–3 paragraph reflection (see
 * src/lib/brain/coreMemories.ts), it engraves that reflection inside a
 * hollow coin taken from the community pool. Infinity is the network and
 * the pool is its own, so no user wallet, balance or key is touched:
 *
 *   1. Only a hollow pool coin is used (status "pool", weight 0, no tokens,
 *      chat, chemicals, payload or vault), and at least
 *      POOL_SURPLUS_REQUIREMENT hollow wrappers always stay in the pool so
 *      token wrapping is never starved.
 *   2. The coin moves from the pool to Infinity (ownerId "infinity",
 *      status "wallet"): ownership changes, supply does not. Nothing is
 *      minted or burned.
 *   3. The reflection is engraved as `wrappedReflection` with a SHA-256
 *      content hash, and the coin is sealed through applySeal — the single
 *      seal path that stamps the Creator Proof tag.
 *   4. A coin_transfer from the community pool to Infinity is recorded on
 *      the local SWARM chain. This is local settlement, not peer consensus.
 *
 * Engraving is idempotent per reflection seal and serialized with a Web
 * Lock where available. When no spare hollow pool coin exists, nothing is
 * engraved and the reflection waits for the next one.
 */
import { getAll, put } from "../../store";
import { applySeal } from "../coinFill";
import { generateTransactionId } from "../crypto";
import { getSwarmChain } from "../chain";
import { POOL_SURPLUS_REQUIREMENT, type SwarmCoin, type SwarmTransaction, type WrappedReflectionPayload } from "../types";
import { INFINITY_ID, LEGACY_COMMUNITY_POOL } from "./vaults";

/** Abstract weight a sealed reflection occupies (same unit as chat history). */
export const REFLECTION_WRAP_WEIGHT = 10;

export interface ReflectionToEngrave {
  paragraphs: string[];
  topics: string[];
  continuity: number;
  seal: string;
}

const encoder = new TextEncoder();

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A pool coin that carries nothing and can become a reflection container. */
export function isHollowPoolCoin(c: SwarmCoin): boolean {
  return c.status === "pool" && c.kind !== "media" && !c.locked && !c.vaultAddress
    && (c.weight ?? 0) <= 0 && (c.wrappedTokens?.length ?? 0) === 0
    && (c.wrappedChemicals?.length ?? 0) === 0 && !c.wrappedChat && !c.wrappedReflection
    && (c.payloadEntries?.length ?? 0) === 0 && (c.sealBytes ?? 0) === 0
    && !c.firstArtifactNftId && c.fillState !== "sealed" && c.fillState !== "spent"
    && Number.isFinite(c.maxWeight) && REFLECTION_WRAP_WEIGHT <= c.maxWeight;
}

/** Infinity's engraved reflection coins, newest first. */
export async function getReflectionCoins(): Promise<SwarmCoin[]> {
  const all = await getAll<SwarmCoin>("swarmCoins");
  return all
    .filter((c) => c.ownerId === INFINITY_ID && c.wrappedReflection)
    .sort((a, b) => (b.wrappedReflection?.engravedAt ?? "").localeCompare(a.wrappedReflection?.engravedAt ?? ""));
}

function withLock<T>(task: () => Promise<T>): Promise<T> {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request("engraving:infinity", task) as Promise<T>;
  }
  return task();
}

/**
 * Engrave one reflection into a hollow pool coin. Returns the sealed coin,
 * the existing coin when this reflection is already engraved, or null when
 * the pool has no spare hollow coin.
 */
export function engraveReflectionCoin(reflection: ReflectionToEngrave, now = new Date()): Promise<SwarmCoin | null> {
  return withLock(async () => {
    if (!reflection.paragraphs.length) return null;
    const all = await getAll<SwarmCoin>("swarmCoins");
    const existing = all.find((c) => c.ownerId === INFINITY_ID && c.wrappedReflection?.seal === reflection.seal);
    if (existing) return existing;

    const hollow = all.filter(isHollowPoolCoin).sort((a, b) => a.minedAt.localeCompare(b.minedAt));
    // Keep the pool's surplus wrapper(s) for token wraps.
    if (hollow.length <= POOL_SURPLUS_REQUIREMENT) return null;
    const coin = hollow[0];

    const text = reflection.paragraphs.join("\n\n");
    const payload: WrappedReflectionPayload = {
      paragraphs: [...reflection.paragraphs],
      topics: [...reflection.topics],
      continuity: reflection.continuity,
      seal: reflection.seal,
      contentHash: await sha256Hex(text),
      engravedAt: now.toISOString(),
    };
    const sealBytes = encoder.encode(JSON.stringify(payload)).byteLength;
    const sealed = applySeal({
      ...coin,
      ownerId: INFINITY_ID,
      status: "wallet" as const,
      weight: (coin.weight ?? 0) + REFLECTION_WRAP_WEIGHT,
      wrappedReflection: payload,
      sealBytes,
      checkedForWrap: true,
    }, now.toISOString());
    await put("swarmCoins", sealed);

    const transaction: SwarmTransaction = {
      id: generateTransactionId(),
      type: "coin_transfer",
      from: coin.ownerId || LEGACY_COMMUNITY_POOL,
      to: INFINITY_ID,
      timestamp: now.toISOString(),
      signature: "",
      publicKey: INFINITY_ID,
      nonce: now.getTime(),
      fee: 0,
      meta: {
        kind: "infinity_reflection_engrave",
        coinId: coin.coinId,
        seal: reflection.seal,
        contentHash: payload.contentHash,
        paragraphs: payload.paragraphs.length,
      },
    };
    try { getSwarmChain().addTransaction(transaction); } catch (err) { console.warn("[reflectionCoins] ledger record failed", err); }
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("blockchain-transaction", { detail: transaction }));
      window.dispatchEvent(new Event("coin-engraving-update"));
    }
    return sealed;
  });
}
