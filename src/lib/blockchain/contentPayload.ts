/**
 * Content payload packing — the identifier-flip model.
 *
 * Posts and comments already live durably on-device and sync over the mesh.
 * A piece of content is "loaded" once it carries `_coinId`; anything without
 * it (including legacy content) is simply waiting for a container. When the
 * author holds a hollow or currently-payloading coin, unloaded content is
 * measured, appended to that coin, and flipped. At ≥ 89% of the 1 GiB
 * capacity the coin seals with a Creator Proof tag. No hollow coin → nothing
 * flips, posting is never blocked, and the next mined coin picks it up.
 */
import { getAll, put } from "../store";
import { applySeal } from "./coinFill";
import type { SwarmCoin } from "./types";

export const COIN_PAYLOAD_CAPACITY_BYTES = 1024 * 1024 * 1024;
export const COIN_PAYLOAD_SEAL_RATIO = 0.89;
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
    && (coin.wrappedTokens?.length ?? 0) === 0 && !coin.wrappedChat;
}

const running = new Map<string, Promise<number>>();

/** Load the author's unflipped content into open containers. Returns items flipped. */
export function packLocalContent(userId: string): Promise<number> {
  const active = running.get(userId);
  if (active) return active;
  const work = pack(userId).catch((err) => { console.warn("[contentPayload] pack failed", err); return 0; })
    .finally(() => running.delete(userId));
  running.set(userId, work);
  return work;
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
    const hash = await sha256Hex(JSON.stringify({ ...item, _coinId: undefined }));
    const entries = [...(coin.payloadEntries ?? []), { id: item.id, type: store === "posts" ? "post" : "comment", sizeBytes: bytes, hash }];
    let next: SwarmCoin = {
      ...coin, fillState: "filling", payloadEntries: entries,
      sealBytes: (coin.sealBytes ?? 0) + bytes,
    };
    next.fill = Math.min(1, next.sealBytes! / COIN_PAYLOAD_SEAL_BYTES);
    if (next.sealBytes! >= COIN_PAYLOAD_SEAL_BYTES) {
      const merkleRoot = await sha256Hex(entries.map((e) => e.hash).join(""));
      next = applySeal(next);
      next.creatorProof = { ...next.creatorProof!, payloadBytes: next.sealBytes, merkleRoot };
    }
    await put("swarmCoins", next);
    await put(store, { ...item, _coinId: next.coinId });
    flipped += 1;
    coin = next.fillState === "sealed" ? coins.shift() : next;
  }
  return flipped;
}
