/**
 * mediaCoinRuntime — connects the Media Coin courier engine to the app.
 *
 *  - Starts the engine on the live mesh transport (called by SwarmMesh),
 *    with the IndexedDB content store and the device's refused list.
 *  - Publish: a post whose media is above the torrent size goes by Media
 *    Coin. Each file is minted once into the content store (keyed by its
 *    merkleRoot), engraved onto a hollow wallet coin when one is free,
 *    and launched. Its torrent copy is dropped, so it is never announced
 *    or seeded as a torrent.
 *  - Arrivals: content that arrives whole, or a coin for content already
 *    held (0 bytes), is noted on the content record: the coin, its hops
 *    and, for Support Coins, the supporter. Torrents are never re-filled
 *    from Media Coin content.
 *  - Support Coin: engraves held content into one of your own hollow
 *    coins (a new coinId) and relays it; peers holding it answer
 *    "already-held", so it is never re-sent to them.
 *  - Delete Sync: refuses the merkleRoot and drops the local copy.
 *
 * Content identity is the merkleRoot, never the coinId.
 */
import {
  getMediaCoinEngine,
  getActiveMediaCoinEngine,
  resetMediaCoinEngine,
  mintMediaCoinContent,
  MEDIA_COIN_PASS_MAX_BYTES,
  type MediaCoinSource,
  type MeshTransportAdapter,
  type MediaCoinManifest,
} from "./mediaCoin.standalone";
import {
  mediaCoinContentStore,
  mediaCoinContentKey,
  getMediaCoinContent,
  markMediaCoinContentSelf,
  recordMediaCoinSighting,
  deleteMediaCoinContent,
  refreshMediaCoinContents,
} from "./mediaCoinContentStore";
import { hydrateRefusedMediaCoins, isMediaCoinRefused, refuseMediaCoin } from "./refusedMediaCoinsStore";
import type { SwarmCoin } from "./types";

import type { MediaCoinPostRef } from "@/types";

export type { MediaCoinPostRef };

let unsubs: Array<() => void> = [];
let pendingTimer: ReturnType<typeof setInterval> | null = null;

/** Stable identity for a coin's content: its Merkle root never changes between coins or hops. */
export function unpackedContentHash(merkleRoot: string): string {
  return mediaCoinContentKey(merkleRoot);
}

// ── Launches waiting for the mesh ──────────────────────────────────────

interface PendingLaunch {
  coinId: string;
  merkleRoot: string;
  supporter?: { id: string; name?: string };
}

const PENDING_KEY = "media-coin-pending-launches-v2";
/** Pre-courier launch queue (whole-coin bursts with torrent back-fill); retired. */
const LEGACY_PENDING_KEY = "media-coin-pending-launches";
/** Coins launched this session, so a queued launch is sent once. */
const launched = new Set<string>();

function readPending(): PendingLaunch[] {
  try {
    const list = JSON.parse(globalThis.localStorage?.getItem(PENDING_KEY) || "[]");
    return Array.isArray(list) ? list.filter((p) => typeof p?.coinId === "string" && typeof p?.merkleRoot === "string") : [];
  } catch {
    return [];
  }
}

function writePending(list: PendingLaunch[]): void {
  try {
    if (list.length) globalThis.localStorage?.setItem(PENDING_KEY, JSON.stringify(list));
    else globalThis.localStorage?.removeItem(PENDING_KEY);
  } catch { /* storage unavailable */ }
}

function queueLaunch(item: PendingLaunch): void {
  writePending([...readPending().filter((p) => p.coinId !== item.coinId), item]);
}

/**
 * Send queued coins. Each stays queued until the engine has handed it
 * off at least once, so a reload before the first hand-off resends it.
 */
let draining: Promise<void> | null = null;
let drainAgain = false;

function drainPendingLaunches(): Promise<void> {
  if (draining) { drainAgain = true; return draining; }
  draining = drainOnce().finally(() => {
    draining = null;
    if (drainAgain) { drainAgain = false; void drainPendingLaunches(); }
  });
  return draining;
}

async function drainOnce(): Promise<void> {
  const engine = getActiveMediaCoinEngine();
  if (!engine) return;
  const keep: PendingLaunch[] = [];
  const held = new Set(engine.getHeldCoinIds());
  const seen = new Set<string>();
  for (const item of readPending()) {
    seen.add(item.coinId);
    if (isMediaCoinRefused(item.merkleRoot)) continue;
    if (launched.has(item.coinId)) {
      if (held.has(item.coinId)) keep.push(item); // still waiting for its first hand-off
      continue;
    }
    try {
      const adopted = await engine.adoptCoin(item.coinId, item.merkleRoot, item.supporter);
      if (!adopted) continue; // content no longer held here
      if (await engine.launch(item.coinId)) launched.add(item.coinId);
      keep.push(item);
    } catch (err) {
      console.warn("[mediaCoinRuntime] queued launch failed; will retry", item.coinId, err);
      keep.push(item);
    }
  }
  // Merge with anything queued while we were draining.
  const keepIds = new Set(keep.map((k) => k.coinId));
  writePending(readPending().filter((p) => keepIds.has(p.coinId) || !seen.has(p.coinId)));
}

export function startMediaCoinRuntime(transport: MeshTransportAdapter): void {
  if (getActiveMediaCoinEngine()) return;
  try { globalThis.localStorage?.removeItem(LEGACY_PENDING_KEY); } catch { /* noop */ }
  void hydrateRefusedMediaCoins();
  const engine = getMediaCoinEngine(transport, { store: mediaCoinContentStore, isRefused: isMediaCoinRefused });
  engine.start();
  const note = (manifest: MediaCoinManifest, hops: number) =>
    recordMediaCoinSighting(manifest, { hops, supporter: manifest.supporter }).catch((err) => {
      console.warn("[mediaCoinRuntime] could not note coin", err);
    });
  unsubs.push(engine.onUnpack((u) => note(u.manifest, u.route.hops.length - 1)));
  unsubs.push(engine.onAlreadyHeld((h) => note(h.manifest, h.route.hops.length - 1)));
  void refreshMediaCoinContents();
  void drainPendingLaunches().catch(() => {});
  pendingTimer = setInterval(() => { void drainPendingLaunches().catch(() => {}); }, 5_000);
}

export function stopMediaCoinRuntime(): void {
  for (const u of unsubs) u();
  unsubs = [];
  if (pendingTimer) clearInterval(pendingTimer);
  pendingTimer = null;
  launched.clear();
  resetMediaCoinEngine();
}

// ── Hollow coins ──────────────────────────────────────────────────────

async function freeHollowCoins(): Promise<SwarmCoin[]> {
  const { freeMinedWalletCoins } = await import("./mediaCoinWrapSweep");
  return freeMinedWalletCoins();
}

/** True when the signed-in user has a hollow coin to engrave. */
export async function hasHollowCoin(): Promise<boolean> {
  return (await freeHollowCoins()).length > 0;
}

/** Engrave Media Coin content (by merkleRoot) onto a hollow wallet coin. */
async function engraveContentOntoCoin(
  coin: SwarmCoin,
  merkleRoot: string,
  size: number,
  role: "courier" | "support",
): Promise<void> {
  const { put } = await import("@/lib/store");
  const now = new Date().toISOString();
  const peerId = getActiveMediaCoinEngine()?.localPeerId ?? coin.ownerId;
  coin.kind = "media";
  coin.mediaRole = role;
  coin.mediaContentRoot = merkleRoot;
  coin.sealBytes = Math.max(coin.sealBytes ?? 0, size);
  coin.mediaTargets = [...(coin.mediaTargets ?? []), { peerId, contentHashes: [mediaCoinContentKey(merkleRoot)] }];
  coin.fillState = "sealed";
  coin.sealedAt = coin.sealedAt ?? now;
  await put("swarmCoins", coin);
}

// ── Publish (post time) ───────────────────────────────────────────────

interface TorrentManifestLike {
  fileId: string;
  chunks: string[];
  mime: string;
  size: number;
  originalName: string;
  mediaWidth?: number;
  mediaHeight?: number;
}

/** A post file's plaintext, read from the torrent store one chunk at a time. */
function torrentFileSource(m: TorrentManifestLike): MediaCoinSource {
  return {
    name: m.originalName,
    type: m.mime,
    size: m.size,
    async *pieces() {
      const { get } = await import("@/lib/store");
      const { importFileKey } = await import("@/lib/fileEncryption");
      const stored = await get<TorrentManifestLike & Record<string, unknown>>("manifests", m.fileId);
      if (!stored?.chunks?.length) throw new Error(`file ${m.fileId} is not on this device`);
      const key = await importFileKey(stored as Parameters<typeof importFileKey>[0]);
      for (const ref of stored.chunks) {
        const chunk = await get<{ iv: string; cipher: string }>("chunks", ref);
        if (!chunk) throw new Error(`chunk ${ref} of ${m.fileId} missing`);
        const iv = Uint8Array.from(atob(chunk.iv), (c) => c.charCodeAt(0));
        const cipher = Uint8Array.from(atob(chunk.cipher), (c) => c.charCodeAt(0));
        yield new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher));
      }
    },
  };
}

/**
 * Move a post's files into Media Coin courier mode: mint each into the
 * content store, engrave it onto a hollow coin when one is free (else the
 * coin gets a generated id), drop its torrent copy, and launch it.
 */
export async function publishCourierFiles(
  files: TorrentManifestLike[],
  opts: { postId: string; creatorId: string; onProgress?: (fileIndex: number, percent: number) => void },
): Promise<MediaCoinPostRef[]> {
  const total = files.reduce((s, f) => s + (f.size || 0), 0);
  if (total > MEDIA_COIN_PASS_MAX_BYTES) throw new Error("Post media is over the Media Coin limit");
  const refs: MediaCoinPostRef[] = [];
  const hollow = await freeHollowCoins().catch(() => [] as SwarmCoin[]);
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const coin = hollow.shift();
    const manifest = await mintMediaCoinContent(torrentFileSource(f), opts.creatorId, mediaCoinContentStore, {
      encrypt: true,
      coinId: coin?.coinId,
      postId: opts.postId,
      mediaWidth: f.mediaWidth,
      mediaHeight: f.mediaHeight,
      onProgress: (p) => opts.onProgress?.(i, p.phase === "hashing" ? p.percent / 2 : 50 + p.percent / 2),
    });
    if (coin) await engraveContentOntoCoin(coin, manifest.merkleRoot, manifest.totalSize, "courier").catch(() => {});
    await markMediaCoinContentSelf(manifest.merkleRoot);
    refs.push({
      merkleRoot: manifest.merkleRoot,
      name: manifest.name,
      mime: manifest.mimeType,
      size: manifest.totalSize,
      mediaWidth: f.mediaWidth,
      mediaHeight: f.mediaHeight,
    });
    queueLaunch({ coinId: manifest.coinId, merkleRoot: manifest.merkleRoot });
    // The courier copy is the only one: the torrent copy is never seeded.
    try {
      const { deleteManifest } = await import("@/lib/fileEncryption");
      await deleteManifest(f.fileId);
    } catch (err) {
      console.warn("[mediaCoinRuntime] could not drop torrent copy of", f.fileId, err);
    }
  }
  void drainPendingLaunches().catch(() => {});
  return refs;
}

// ── Support Coin & Delete Sync ────────────────────────────────────────

/**
 * Engrave held content into one of your own hollow coins (a new coinId,
 * never one already carrying it) and relay it to connected peers.
 */
export async function supportMediaCoin(merkleRoot: string): Promise<{ coinId: string }> {
  if (isMediaCoinRefused(merkleRoot)) throw new Error("This content is refused on this device");
  const rec = await getMediaCoinContent(merkleRoot);
  if (!rec?.complete) throw new Error("This content is not held whole on this device");
  const coin = (await freeHollowCoins()).find((c) => !rec.coinIds.includes(c.coinId));
  if (!coin) throw new Error("No hollow coin to engrave");
  const { getCurrentUser } = await import("@/lib/auth");
  const user = getCurrentUser();
  const supporter = { id: user?.id ?? coin.ownerId, name: user?.displayName || user?.username || undefined };
  await engraveContentOntoCoin(coin, merkleRoot, rec.size, "support");
  await recordMediaCoinSighting({ ...rec.manifest, coinId: coin.coinId, supporter }, { hops: 0, supporter });
  queueLaunch({ coinId: coin.coinId, merkleRoot, supporter });
  void drainPendingLaunches().catch(() => {});
  return { coinId: coin.coinId };
}

/** Remove the local copy and refuse any future coin carrying this content. */
export async function deleteMediaCoinSync(merkleRoot: string): Promise<void> {
  const rec = await getMediaCoinContent(merkleRoot);
  await refuseMediaCoin(merkleRoot, rec?.name);
  writePending(readPending().filter((p) => p.merkleRoot !== merkleRoot));
  const engine = getActiveMediaCoinEngine();
  if (engine) await engine.forget(merkleRoot);
  else await deleteMediaCoinContent(merkleRoot);
}
