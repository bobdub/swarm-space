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
 *
 * The player's harvests are engraved too: each pass appends one "harvest"
 * entry holding everything harvested since the last one (see
 * harvestJournal), so gathered goods are recorded on the coin alongside
 * posts and comments.
 *
 * Entries are engraved NFT-style: token metadata (name, description, type,
 * tags) plus a pointer to each attached file (file id, MIME, size, chunk refs
 * and a content hash). The meter counts each file's full size. Files are
 * relocated by reference: the file record is anchored to the coin while its
 * encrypted bytes stay in chunk storage, so nothing is copied and posts keep
 * loading. File keys never enter a coin.
 */
import { get, getAll, put } from "../store";
import { applySeal } from "./coinFill";
import type { CoinPayloadEntry, CoinPayloadMedia, SwarmCoin } from "./types";
import { canSealEngraving, ENGRAVING_CAPACITY_BYTES } from "./engravingTiers";
import {
  readEngravedHarvest, readHarvestTally, unengraved, writeEngravedHarvest,
} from "../remix/harvestJournal";

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

interface StoredManifest { fileId: string; chunks?: string[]; mime?: string; size?: number; originalName?: string; _coinId?: string }

/** Read the item's attached files as NFT media pointers. Keys and raw bytes stay in chunk storage. */
async function readMedia(item: LoadableContent): Promise<{ media: CoinPayloadMedia[]; missing: string[] }> {
  const ids = Array.isArray(item.manifestIds) ? [...new Set(item.manifestIds.filter((id): id is string => typeof id === "string"))] : [];
  const media: CoinPayloadMedia[] = [];
  const missing: string[] = [];
  for (const fileId of ids) {
    let manifest: StoredManifest | undefined;
    try { manifest = await get<StoredManifest>("manifests", fileId); } catch { manifest = undefined; }
    const size = Number(manifest?.size);
    if (!manifest || !Number.isFinite(size) || size <= 0) { missing.push(fileId); continue; }
    const chunks = Array.isArray(manifest.chunks) ? manifest.chunks.filter((c) => typeof c === "string") : [];
    media.push({
      fileId, mime: manifest.mime || "application/octet-stream",
      ...(manifest.originalName ? { name: manifest.originalName } : {}),
      sizeBytes: size, chunks, contentHash: await sha256Hex(`${fileId}:${size}:${chunks.join(",")}`),
    });
  }
  return { media, missing };
}

function itemText(item: LoadableContent): string {
  return typeof item.content === "string" ? item.content : typeof item.text === "string" ? item.text : "";
}

/** Build the NFT-style entry: metadata + media pointers, sized by text plus full media bytes. */
export async function buildPayloadEntry(store: PayloadStore, item: LoadableContent): Promise<CoinPayloadEntry> {
  const { media, missing } = await readMedia(item);
  const description = itemText(item);
  const type: "post" | "comment" = store === "posts" ? "post" : "comment";
  const metadata: NonNullable<CoinPayloadEntry["metadata"]> = {
    name: description.trim().split("\n")[0].slice(0, 80) || media[0]?.name || `${type} ${item.id}`,
    description,
    ...(typeof item.createdAt === "string" ? { createdAt: item.createdAt } : {}),
    ...(typeof item.type === "string" ? { postType: item.type } : {}),
    ...(Array.isArray(item.tags) ? { tags: item.tags.filter((t): t is string => typeof t === "string") } : {}),
  };
  const sizeBytes = measureContentBytes(item) + media.reduce((sum, m) => sum + m.sizeBytes, 0);
  const hash = await sha256Hex(JSON.stringify({ item: { ...item, _coinId: undefined }, media: media.map((m) => m.contentHash) }));
  return {
    id: item.id, type, sizeBytes, hash, v: 2, metadata,
    ...(media.length ? { media } : {}),
    ...(missing.length ? { pendingMediaIds: missing } : {}),
  };
}

const HARVEST_LABEL: Record<string, string> = {
  wood: "Wood", stone: "Stone", water: "Water", fibre: "Fibre", food: "Food", animal: "Food",
};

/** One engraving entry for a batch of harvested goods. */
export async function buildHarvestEntry(
  userId: string, batch: Record<string, number>, events: number, at: string,
): Promise<CoinPayloadEntry> {
  const merged: Record<string, number> = {};
  for (const [kind, qty] of Object.entries(batch)) {
    const label = HARVEST_LABEL[kind] ?? kind;
    merged[label] = (merged[label] ?? 0) + qty;
  }
  const parts = Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)).map(([label, qty]) => `+${qty} ${label}`);
  const description = `Harvested ${parts.join(", ")}`;
  const id = `harvest-${userId}-${events}`;
  const body = { id, userId, harvest: batch, events, at };
  return {
    id, type: "harvest", v: 2,
    sizeBytes: encoder.encode(JSON.stringify(body)).byteLength,
    hash: await sha256Hex(JSON.stringify(body)),
    metadata: { name: description, description, createdAt: at, tags: ["harvest", ...Object.keys(batch).sort()] },
    harvest: { ...batch },
  };
}

/**
 * Relocate engraved files into the coin without copying: the file record
 * gains `_coinId`, so it now belongs to that coin. Bytes stay in chunk
 * storage where posts and the mesh already read them, and anchored files
 * are protected from space cleanup and deletion.
 */
async function anchorMedia(entry: CoinPayloadEntry, coinId: string): Promise<void> {
  for (const m of entry.media ?? []) {
    try {
      const manifest = await get<StoredManifest>("manifests", m.fileId);
      if (manifest && manifest._coinId !== coinId) await put("manifests", { ...manifest, _coinId: coinId });
    } catch (err) { console.warn("[contentPayload] anchor failed", m.fileId, err); }
  }
}

function needsUpgrade(entry: CoinPayloadEntry): boolean {
  if (entry.type === "harvest") return false;
  return entry.v !== 2 || (entry.pendingMediaIds?.length ?? 0) > 0;
}

/**
 * Open coins may hold text-only legacy entries, or entries whose files were
 * not on this device yet. Re-engrave them in place (never sealed coins). An
 * entry that no longer fits is released back to the queue so the normal
 * writer places it in another coin, never recorded as half-migrated.
 */
async function upgradeLegacyEntries(coin: SwarmCoin): Promise<SwarmCoin> {
  const entries = coin.payloadEntries ?? [];
  if (!entries.some(needsUpgrade)) return coin;
  let total = coin.sealBytes ?? 0;
  const next: CoinPayloadEntry[] = [];
  let changed = false;
  for (const entry of entries) {
    if (!needsUpgrade(entry)) { next.push(entry); continue; }
    const store: PayloadStore = entry.type === "post" ? "posts" : "comments";
    let item: LoadableContent | undefined;
    try { item = await get<LoadableContent>(store, entry.id); } catch { item = undefined; }
    if (!item) { next.push(entry); continue; }
    const upgraded = await buildPayloadEntry(store, item);
    if (upgraded.sizeBytes === entry.sizeBytes && upgraded.v === entry.v
      && (upgraded.pendingMediaIds?.length ?? 0) === (entry.pendingMediaIds?.length ?? 0)) { next.push(entry); continue; }
    changed = true;
    const grown = total - entry.sizeBytes + upgraded.sizeBytes;
    if (grown > COIN_PAYLOAD_CAPACITY_BYTES) {
      total -= entry.sizeBytes;
      const { _coinId: _released, ...rest } = item;
      void _released;
      await put(store, rest);
      continue;
    }
    total = grown;
    next.push(upgraded);
    await anchorMedia(upgraded, coin.coinId);
  }
  if (!changed) return coin;
  const upgraded: SwarmCoin = { ...coin, payloadEntries: next, sealBytes: total };
  upgraded.fill = Math.min(1, total / COIN_PAYLOAD_CAPACITY_BYTES);
  await put("swarmCoins", upgraded);
  return upgraded;
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
  let upgradedAny = false;
  for (let i = 0; i < coins.length; i++) {
    const upgraded = await upgradeLegacyEntries(coins[i]);
    if (upgraded !== coins[i]) { coins[i] = upgraded; upgradedAny = true; }
  }
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
    const entry = await buildPayloadEntry(store, item);
    const bytes = entry.sizeBytes;
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
    const entries = [...(coin.payloadEntries ?? []), entry];
    let next: SwarmCoin = {
      ...coin, fillState: "filling", payloadEntries: entries,
      sealBytes: (coin.sealBytes ?? 0) + bytes,
      lastPayloadLoadAt: new Date().toISOString(),
    };
    next.fill = Math.min(1, (next.sealBytes ?? 0) / COIN_PAYLOAD_CAPACITY_BYTES);
    if ((next.sealBytes ?? 0) >= COIN_PAYLOAD_CAPACITY_BYTES) next = await sealPayload(next);
    await put("swarmCoins", next);
    await put(store, { ...item, _coinId: next.coinId });
    await anchorMedia(entry, next.coinId);
    flipped += 1;
    coin = next.fillState === "sealed" ? coins.shift() : next;
  }
  if (coin) {
    try {
      if (await engraveHarvest(userId, coin, coins)) flipped += 1;
    } catch (err) { console.warn("[contentPayload] harvest engraving failed", err); }
  }
  if (flipped || upgradedAny) notify();
  return flipped;
}

/**
 * Append everything harvested since the last engraving as one entry.
 * The engraved tally is only advanced after the coin is written, and an
 * entry already present on an open coin (an interrupted earlier pass) is
 * never appended twice.
 */
async function engraveHarvest(userId: string, coin: SwarmCoin, spare: SwarmCoin[]): Promise<boolean> {
  const tally = await readHarvestTally(userId);
  const engraved = await readEngravedHarvest(userId);
  if (tally.events <= engraved.events) return false;
  const batch = unengraved(tally, engraved);
  if (Object.keys(batch).length === 0) {
    await writeEngravedHarvest(userId, tally.totals, tally.events);
    return false;
  }
  const entry = await buildHarvestEntry(userId, batch, tally.events, tally.lastAt ?? new Date().toISOString());
  const already = [coin, ...spare].some((c) => (c.payloadEntries ?? []).some((e) => e.id === entry.id));
  if (!already) {
    let target: SwarmCoin | undefined = coin;
    if ((target.sealBytes ?? 0) + entry.sizeBytes > COIN_PAYLOAD_CAPACITY_BYTES) {
      target = spare.find((c) => (c.sealBytes ?? 0) + entry.sizeBytes <= COIN_PAYLOAD_CAPACITY_BYTES);
    }
    if (!target) return false;
    let next: SwarmCoin = {
      ...target, fillState: "filling", payloadEntries: [...(target.payloadEntries ?? []), entry],
      sealBytes: (target.sealBytes ?? 0) + entry.sizeBytes,
      lastPayloadLoadAt: new Date().toISOString(),
    };
    next.fill = Math.min(1, (next.sealBytes ?? 0) / COIN_PAYLOAD_CAPACITY_BYTES);
    if ((next.sealBytes ?? 0) >= COIN_PAYLOAD_CAPACITY_BYTES) next = await sealPayload(next);
    await put("swarmCoins", next);
  }
  await writeEngravedHarvest(userId, tally.totals, tally.events);
  return !already;
}
