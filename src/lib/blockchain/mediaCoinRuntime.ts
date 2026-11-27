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

type CoinRole = "courier" | "support";

/** Fields a reservation changes, to put a released coin back as it was. */
type CoinSnapshot = Pick<SwarmCoin, "kind" | "mediaRole" | "mediaContentRoot" | "sealBytes" | "mediaTargets" | "fillState" | "sealedAt">;

async function currentUserId(): Promise<string | null> {
  const { getCurrentUser } = await import("@/lib/auth");
  return getCurrentUser()?.id ?? null;
}

/**
 * Reserve one hollow coin for Media Coin content. Runs under the shared
 * engraving lock and re-reads the coin there, so the content packer can
 * neither take it meanwhile nor be overwritten by a stale snapshot. The
 * reservation (kind "media") keeps every other writer off the coin while
 * a large file is minted.
 */
async function claimHollowCoin(
  userId: string,
  role: CoinRole,
  exclude: ReadonlySet<string> = new Set(),
): Promise<{ coinId: string; snapshot: CoinSnapshot } | null> {
  const { withEngravingLock } = await import("./contentPayload");
  const { isHollowWalletCoin } = await import("./mediaCoinWrapSweep");
  const { getAll, put } = await import("@/lib/store");
  return withEngravingLock(userId, async () => {
    const coin = (await getAll<SwarmCoin>("swarmCoins")).find((c) => isHollowWalletCoin(c, userId) && !exclude.has(c.coinId));
    if (!coin) return null;
    const snapshot: CoinSnapshot = {
      kind: coin.kind, mediaRole: coin.mediaRole, mediaContentRoot: coin.mediaContentRoot, sealBytes: coin.sealBytes,
      mediaTargets: coin.mediaTargets, fillState: coin.fillState, sealedAt: coin.sealedAt,
    };
    await put("swarmCoins", { ...coin, kind: "media", mediaRole: role });
    return { coinId: coin.coinId, snapshot };
  });
}

/** Engrave content (by merkleRoot) onto a coin this device reserved, re-read under the lock. */
async function engraveReservedCoin(userId: string, coinId: string, role: CoinRole, merkleRoot: string, size: number): Promise<boolean> {
  const { withEngravingLock } = await import("./contentPayload");
  const { get, put } = await import("@/lib/store");
  return withEngravingLock(userId, async () => {
    const coin = await get<SwarmCoin>("swarmCoins", coinId);
    if (!coin || coin.ownerId !== userId || coin.kind !== "media" || coin.mediaRole !== role) return false;
    if (coin.mediaContentRoot && coin.mediaContentRoot !== merkleRoot) return false;
    const now = new Date().toISOString();
    const peerId = getActiveMediaCoinEngine()?.localPeerId ?? userId;
    await put("swarmCoins", {
      ...coin,
      mediaContentRoot: merkleRoot,
      sealBytes: Math.max(coin.sealBytes ?? 0, size),
      mediaTargets: [...(coin.mediaTargets ?? []), { peerId, contentHashes: [mediaCoinContentKey(merkleRoot)] }],
      fillState: "sealed",
      sealedAt: coin.sealedAt ?? now,
    });
    return true;
  });
}

/** Give back a reserved coin that never got its content. */
async function releaseReservedCoin(userId: string, coinId: string, role: CoinRole, snapshot: CoinSnapshot): Promise<void> {
  const { withEngravingLock } = await import("./contentPayload");
  const { get, put } = await import("@/lib/store");
  await withEngravingLock(userId, async () => {
    const coin = await get<SwarmCoin>("swarmCoins", coinId);
    if (!coin || coin.kind !== "media" || coin.mediaRole !== role || coin.mediaContentRoot) return;
    await put("swarmCoins", { ...coin, ...snapshot });
  });
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

/** A post's files packed as Media Coins, not yet committed. */
export interface PreparedCourierPost {
  refs: MediaCoinPostRef[];
  /** After the post is saved: engrave the coins, launch them, drop the torrent copies. */
  commit(): Promise<void>;
  /** The post was not saved: give the coins back and drop the packed content. */
  abort(): Promise<void>;
}

/**
 * Pack a post's files for Media Coin courier mode: reserve a hollow coin
 * per file when one is free (else the coin gets a generated id) and mint
 * each file into the content store. Nothing destructive happens here: the
 * torrent copies stay until `commit()`, so a failure (here or before the
 * post is saved) can be retried with the same attachments.
 */
export async function prepareCourierFiles(
  files: TorrentManifestLike[],
  opts: { postId: string; creatorId: string; onProgress?: (fileIndex: number, percent: number) => void },
): Promise<PreparedCourierPost> {
  const total = files.reduce((s, f) => s + (f.size || 0), 0);
  if (total > MEDIA_COIN_PASS_MAX_BYTES) throw new Error("Post media is over the Media Coin limit");
  const userId = (await currentUserId()) ?? opts.creatorId;
  const packed: Array<{ file: TorrentManifestLike; manifest: MediaCoinManifest; claim: { coinId: string; snapshot: CoinSnapshot } | null }> = [];
  const claimed = new Set<string>();

  const abort = async () => {
    for (const p of packed) {
      if (p.claim) await releaseReservedCoin(userId, p.claim.coinId, "courier", p.claim.snapshot).catch(() => {});
      await deleteMediaCoinContent(p.manifest.merkleRoot).catch(() => {});
    }
    packed.length = 0;
  };

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const claim = await claimHollowCoin(userId, "courier", claimed).catch(() => null);
    if (claim) claimed.add(claim.coinId);
    try {
      const manifest = await mintMediaCoinContent(torrentFileSource(f), opts.creatorId, mediaCoinContentStore, {
        encrypt: true,
        coinId: claim?.coinId,
        postId: opts.postId,
        mediaWidth: f.mediaWidth,
        mediaHeight: f.mediaHeight,
        onProgress: (p) => opts.onProgress?.(i, p.phase === "hashing" ? p.percent / 2 : 50 + p.percent / 2),
      });
      packed.push({ file: f, manifest, claim });
    } catch (err) {
      if (claim) await releaseReservedCoin(userId, claim.coinId, "courier", claim.snapshot).catch(() => {});
      await abort();
      throw err;
    }
  }

  const refs: MediaCoinPostRef[] = packed.map(({ file, manifest }) => ({
    merkleRoot: manifest.merkleRoot,
    name: manifest.name,
    mime: manifest.mimeType,
    size: manifest.totalSize,
    mediaWidth: file.mediaWidth,
    mediaHeight: file.mediaHeight,
  }));

  const commit = async () => {
    for (const { file, manifest, claim } of packed) {
      if (claim) await engraveReservedCoin(userId, claim.coinId, "courier", manifest.merkleRoot, manifest.totalSize).catch(() => false);
      await markMediaCoinContentSelf(manifest.merkleRoot);
      queueLaunch({ coinId: manifest.coinId, merkleRoot: manifest.merkleRoot });
      // The courier copy is the only one: the torrent copy is never seeded.
      try {
        const { deleteManifest } = await import("@/lib/fileEncryption");
        await deleteManifest(file.fileId);
      } catch (err) {
        console.warn("[mediaCoinRuntime] could not drop torrent copy of", file.fileId, err);
      }
    }
    void drainPendingLaunches().catch(() => {});
  };

  return { refs, commit, abort };
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
  const { getCurrentUser } = await import("@/lib/auth");
  const user = getCurrentUser();
  if (!user) throw new Error("Sign in to support content");
  const claim = await claimHollowCoin(user.id, "support", new Set(rec.coinIds));
  if (!claim) throw new Error("No hollow coin to engrave");
  const coin = { coinId: claim.coinId };
  const supporter = { id: user.id, name: user.displayName || user.username || undefined };
  if (!(await engraveReservedCoin(user.id, coin.coinId, "support", merkleRoot, rec.size))) {
    await releaseReservedCoin(user.id, coin.coinId, "support", claim.snapshot).catch(() => {});
    throw new Error("Couldn't engrave the hollow coin");
  }
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
