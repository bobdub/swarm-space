/**
 * Content payload packing — the identifier-flip model.
 *
 * Posts and comments already live durably on-device and sync over the mesh.
 * A piece of content is "loaded" once it carries `_coinId`; anything without
 * it (including legacy content) is simply waiting for a container. When the
 * author holds a hollow or currently-payloading coin, unloaded content is
 * measured, appended to that coin, and flipped. Settled cargo seals at its
 * natural tier; 1 GiB remains the hard ceiling. No hollow coin → nothing
 * flips, posting is never blocked, and the next mined coin picks it up.
 */
import { getAll, put } from "../store";
import { applySeal } from "./coinFill";
import type { SwarmCoin } from "./types";
import { canSealEngraving, ENGRAVING_CAPACITY_BYTES } from "./engravingTiers";

export const COIN_PAYLOAD_CAPACITY_BYTES = ENGRAVING_CAPACITY_BYTES;
export const COIN_PAYLOAD_SEAL_RATIO = 1;
export const COIN_PAYLOAD_SEAL_BYTES = Math.ceil(COIN_PAYLOAD_CAPACITY_BYTES * COIN_PAYLOAD_SEAL_RATIO);

type PayloadStore = "posts" | "comments";
interface LoadableContent { id: string; author: string; _coinId?: string; [k: string]: unknown }

const encoder = new TextEncoder();
export function measureContentBytes(item: LoadableContent): number {
  const { _coinId: _ignored, ...rest } = item;
  void _ignored;
  return encoder.encode(JSON.stringify(rest)).byteLength;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

function isOpenContainer(coin: SwarmCoin, userId: string): boolean {
  return coin.ownerId === userId && coin.status === "wallet" && coin.kind !== "media" && !coin.locked
    && (coin.fillState === undefined || coin.fillState === "filling")
    && !coin.vaultAddress && !coin.firstArtifactNftId && (coin.wrappedChemicals?.length ?? 0) === 0
    && (coin.wrappedTokens?.length ?? 0) === 0 && !coin.wrappedChat;
}

const running = new Map<string, Promise<number>>();

function serialize(userId: string, task: () => Promise<number>): Promise<number> {
  const previous = running.get(userId) ?? Promise.resolve(0);
  const work = previous.catch(() => 0).then(() => {
    if (typeof navigator !== "undefined" && navigator.locks) {
      return navigator.locks.request(`engraving:${userId}`, task);
    }
    return task();
  }).finally(() => { if (running.get(userId) === work) running.delete(userId); });
  running.set(userId, work);
  return work;
}

function notify(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("coin-engraving-update"));
}

async function sealPayload(coin: SwarmCoin): Promise<SwarmCoin> {
  const merkleRoot = await sha256Hex((coin.payloadEntries ?? []).map((e) => e.hash).join(""));
  const next = applySeal(coin);
  if (next.creatorProof) next.creatorProof = { ...next.creatorProof, merkleRoot };
  return next;
}

async function findOpen(userId: string): Promise<SwarmCoin | null> {
  const coins = (await getAll<SwarmCoin>("swarmCoins")).filter((c) => isOpenContainer(c, userId));
  return coins.sort((a, b) => (b.sealBytes ?? 0) - (a.sealBytes ?? 0))[0] ?? null;
}

/** Ensure a hollow wallet coin is ready for engraving; hydrates one from wallet SWARM when none is open. */
export async function ensureEngravingCoin(userId: string): Promise<SwarmCoin | null> {
  if (!userId) return null;
  const open = await findOpen(userId);
  if (open) return open;
  try {
    const { hydrateMinedWalletCoins } = await import("./minedWalletCoins");
    if (await hydrateMinedWalletCoins(userId, 1)) notify();
  } catch (err) { console.warn("[contentPayload] hydrate failed", err); }
  return findOpen(userId);
}

export async function getCurrentEngraving(userId: string): Promise<SwarmCoin | null> {
  return ensureEngravingCoin(userId);
}

/** Same serialized writer for manual sealing, idle sealing and appends. */
export function sealLocalContent(userId: string, mode: "manual" | "idle", coinId?: string, now = Date.now()): Promise<number> {
  return serialize(userId, async () => {
    if (!userId) return 0;
    const coins = await getAll<SwarmCoin>("swarmCoins");
    let sealed = 0;
    for (const coin of coins) {
      if (!isOpenContainer(coin, userId) || (coinId && coin.coinId !== coinId)) continue;
      // Historical partial loads get a fresh settling window, without replay.
      if (mode === "idle" && coin.payloadEntries?.length && !coin.lastPayloadLoadAt) {
        await put("swarmCoins", { ...coin, lastPayloadLoadAt: new Date(now).toISOString() });
        continue;
      }
      if (!canSealEngraving(coin, mode, now)) continue;
      await put("swarmCoins", await sealPayload(coin));
      sealed++;
    }
    if (sealed) notify();
    return sealed;
  }).then(async (sealed) => {
    // Once sealed, the next hollow mined coin takes over engraving.
    if (sealed) await ensureEngravingCoin(userId);
    return sealed;
  });
}

/** Load the author's unflipped content into open containers. Returns items flipped. */
export function packLocalContent(userId: string): Promise<number> {
  return serialize(userId, () => pack(userId)).catch((err) => { console.warn("[contentPayload] pack failed", err); return 0; });
}

async function pack(userId: string): Promise<number> {
  if (!userId) return 0;
  const coins = (await getAll<SwarmCoin>("swarmCoins")).filter((c) => isOpenContainer(c, userId));
  // Prefer the coin already payloading so only one coin is write-locked at a time.
  coins.sort((a, b) => (b.fillState === "filling" ? 1 : 0) - (a.fillState === "filling" ? 1 : 0));
  let coin = coins.shift();
  if (!coin) return 0;

  const pending: { store: PayloadStore; item: LoadableContent }[] = [];
  for (const store of ["posts", "comments"] as const) {
    const items = await getAll<LoadableContent>(store);
    for (const item of items) if (item.author === userId && !item._coinId) pending.push({ store, item });
  }
  pending.sort((a, b) => String(a.item.createdAt ?? "").localeCompare(String(b.item.createdAt ?? "")));

  let flipped = 0;
  for (const { store, item } of pending) {
    if (!coin) break;
    const bytes = measureContentBytes(item);
    if (!Number.isFinite(bytes) || bytes > COIN_PAYLOAD_CAPACITY_BYTES) continue;
    // Never truncate an entry or exceed capacity: find a container that fits.
    if ((coin.sealBytes ?? 0) + bytes > COIN_PAYLOAD_CAPACITY_BYTES) {
      const index = coins.findIndex((c) => (c.sealBytes ?? 0) + bytes <= COIN_PAYLOAD_CAPACITY_BYTES);
      if (index < 0) continue;
      const [fitting] = coins.splice(index, 1);
      coins.push(coin);
      coin = fitting;
      if (!coin) continue;
    }
    const hash = await sha256Hex(JSON.stringify({ ...item, _coinId: undefined }));
    const entryType: "post" | "comment" = store === "posts" ? "post" : "comment";
    const entries = [...(coin.payloadEntries ?? []), { id: item.id, type: entryType, sizeBytes: bytes, hash }];
    let next: SwarmCoin = {
      ...coin, fillState: "filling", payloadEntries: entries,
      sealBytes: (coin.sealBytes ?? 0) + bytes,
      lastPayloadLoadAt: new Date().toISOString(),
    };
    next.fill = Math.min(1, (next.sealBytes ?? 0) / COIN_PAYLOAD_CAPACITY_BYTES);
    if ((next.sealBytes ?? 0) >= COIN_PAYLOAD_CAPACITY_BYTES) next = await sealPayload(next);
    await put("swarmCoins", next);
    await put(store, { ...item, _coinId: next.coinId });
    flipped += 1;
    coin = next.fillState === "sealed" ? coins.shift() : next;
  }
  if (flipped) notify();
  return flipped;
}
