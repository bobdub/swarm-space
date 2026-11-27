/**
 * mediaCoinRuntime — connects the Media Coin courier engine to the app.
 *
 *  - Starts the engine on the live mesh transport (called by SwarmMesh),
 *    with the IndexedDB content store and the device's refused list.
 *  - Attach: a file routed to Media Coin is encrypted straight from the
 *    user's File into the content store (keyed by its merkleRoot) as a
 *    draft, while it uploads. It never touches the torrent store, torrent
 *    announce or personal-server sync.
 *  - Publish: the encrypted drafts are checked (nothing unencrypted is
 *    posted), bound to the post and a hollow wallet coin when one is free,
 *    and launched.
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
  mediaCoinSourceOf,
  MEDIA_COIN_PASS_MAX_BYTES,
  type MeshTransportAdapter,
  type MediaCoinManifest,
} from "./mediaCoin.standalone";
import {
  mediaCoinContentStore,
  mediaCoinContentKey,
  getMediaCoinContent,
  markMediaCoinContentSelf,
  markMediaCoinContentDraft,
  publishMediaCoinDraft,
  sweepMediaCoinDrafts,
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
let recoveryTimer: ReturnType<typeof setInterval> | null = null;

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
  void recoverInterruptedReservations().catch(() => 0);
  recoveryTimer = setInterval(() => { void recoverInterruptedReservations().catch(() => 0); }, RESERVATION_RECOVERY_INTERVAL_MS);
  void sweepMediaCoinDrafts(MEDIA_COIN_DRAFT_STALE_MS).catch(() => 0);
  void drainPendingLaunches().catch(() => {});
  pendingTimer = setInterval(() => { void drainPendingLaunches().catch(() => {}); }, 5_000);
}

export function stopMediaCoinRuntime(): void {
  for (const u of unsubs) u();
  unsubs = [];
  if (pendingTimer) clearInterval(pendingTimer);
  pendingTimer = null;
  if (recoveryTimer) clearInterval(recoveryTimer);
  recoveryTimer = null;
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
    await put("swarmCoins", { ...coin, kind: "media", mediaRole: role, mediaReservation: { at: Date.now(), prev: snapshot } });
    activeReservations.add(coin.coinId);
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
      mediaReservation: undefined,
    });
    activeReservations.delete(coinId);
    return true;
  });
}

/** Give back a reserved coin that never got its content. */
async function releaseReservedCoin(userId: string, coinId: string, role: CoinRole, snapshot: CoinSnapshot): Promise<void> {
  const { withEngravingLock } = await import("./contentPayload");
  const { get, put } = await import("@/lib/store");
  await withEngravingLock(userId, async () => {
    activeReservations.delete(coinId);
    const coin = await get<SwarmCoin>("swarmCoins", coinId);
    if (!coin || coin.kind !== "media" || coin.mediaRole !== role || coin.mediaContentRoot) return;
    await put("swarmCoins", { ...coin, ...snapshot, mediaReservation: undefined });
  });
}

/** Reservations this tab holds right now (a pack in progress). */
const activeReservations = new Set<string>();
/**
 * A reservation older than this, held by no publish in this tab, was
 * interrupted. Files are encrypted at attach time, so a reservation only
 * spans Publish (reserve, save the post, engrave): seconds, not minutes.
 * The window only has to cover another tab that is mid-publish.
 */
export const MEDIA_COIN_RESERVATION_STALE_MS = 5 * 60 * 1000;
/** How often a running app re-checks for interrupted reservations. */
const RESERVATION_RECOVERY_INTERVAL_MS = 60 * 1000;

/**
 * Give back coins whose reservation was interrupted (the tab closed or
 * reloaded mid-publish). The reservation is persisted on the coin itself
 * (`mediaReservation`, with the fields it replaced), so this works after a
 * restart: reserved, never engraved, not held by a publish in this tab,
 * and older than the stale window so another tab's publish is left alone.
 * Runs at startup and then every minute, so a reservation that was still
 * fresh at startup is released once it goes stale.
 */
export async function recoverInterruptedReservations(now = Date.now()): Promise<number> {
  const userId = await currentUserId();
  if (!userId) return 0;
  const { withEngravingLock } = await import("./contentPayload");
  const { getAll, put } = await import("@/lib/store");
  return withEngravingLock(userId, async () => {
    let released = 0;
    for (const coin of await getAll<SwarmCoin>("swarmCoins")) {
      const r = coin.mediaReservation;
      if (!r || coin.ownerId !== userId || coin.mediaContentRoot || activeReservations.has(coin.coinId)) continue;
      if (now - (r.at || 0) < MEDIA_COIN_RESERVATION_STALE_MS) continue;
      await put("swarmCoins", { ...coin, ...(r.prev ?? {}), mediaReservation: undefined });
      released++;
    }
    return released;
  });
}

// ── Attach & publish ──────────────────────────────────────────────────

/** Drafts left by a composer closed without posting are dropped after this. */
export const MEDIA_COIN_DRAFT_STALE_MS = 24 * 60 * 60 * 1000;

/**
 * Encrypt a file the user just attached straight into the Media Coin
 * content store (AES-GCM, its own key), as a draft. This runs while the
 * file uploads, before Publish, and never touches the torrent store,
 * torrent announce or personal-server sync. Torrent and Media Coin are
 * separate distributions.
 */
export async function encryptCourierFile(
  file: File | Blob,
  opts: {
    creatorId: string;
    name?: string;
    mediaWidth?: number;
    mediaHeight?: number;
    onProgress?: (percent: number) => void;
  },
): Promise<MediaCoinPostRef> {
  const manifest = await mintMediaCoinContent(mediaCoinSourceOf(file, opts.name), opts.creatorId, mediaCoinContentStore, {
    encrypt: true,
    mediaWidth: opts.mediaWidth,
    mediaHeight: opts.mediaHeight,
    onProgress: (p) => opts.onProgress?.(p.phase === "hashing" ? Math.round(p.percent / 2) : 50 + Math.round(p.percent / 2)),
  });
  await markMediaCoinContentDraft(manifest.merkleRoot);
  return {
    merkleRoot: manifest.merkleRoot,
    name: manifest.name,
    mime: manifest.mimeType,
    size: manifest.totalSize,
    mediaWidth: opts.mediaWidth,
    mediaHeight: opts.mediaHeight,
  };
}

/** The attachment was removed before posting: drop its encrypted draft. */
export async function discardCourierFile(merkleRoot: string): Promise<void> {
  const rec = await getMediaCoinContent(merkleRoot);
  if (rec?.draft) await deleteMediaCoinContent(merkleRoot);
}

/** A post's Media Coin attachments, checked and ready to publish. */
export interface PreparedCourierPost {
  refs: MediaCoinPostRef[];
  /** After the post is saved: bind, engrave and launch the coins. */
  commit(): Promise<void>;
  /** The post was not saved: give the coins back. The encrypted drafts stay for a retry. */
  abort(): Promise<void>;
}

/**
 * Get a post's already-encrypted Media Coin attachments ready to publish.
 * Refuses any attachment that is not held whole and encrypted, so nothing
 * unencrypted is ever posted. Reserves a hollow coin per file when one is
 * free (else the coin gets a generated id). Nothing launches until
 * `commit()`.
 */
export async function prepareCourierFiles(
  refs: MediaCoinPostRef[],
  opts: { postId: string; creatorId: string },
): Promise<PreparedCourierPost> {
  const total = refs.reduce((s, r) => s + (r.size || 0), 0);
  if (total > MEDIA_COIN_PASS_MAX_BYTES) throw new Error("Post media is over the Media Coin limit");
  for (const ref of refs) {
    const rec = await getMediaCoinContent(ref.merkleRoot);
    if (!rec?.complete) throw new Error(`${ref.name} is not encrypted on this device yet`);
    if (!rec.manifest.encryptionKey) throw new Error(`${ref.name} is not encrypted; it cannot be posted`);
  }
  const userId = (await currentUserId()) ?? opts.creatorId;
  const claims: Array<{ ref: MediaCoinPostRef; claim: { coinId: string; snapshot: CoinSnapshot } | null }> = [];
  const claimed = new Set<string>();

  const abort = async () => {
    for (const c of claims) {
      if (c.claim) await releaseReservedCoin(userId, c.claim.coinId, "courier", c.claim.snapshot).catch(() => {});
    }
    claims.length = 0;
  };

  try {
    for (const ref of refs) {
      const claim = await claimHollowCoin(userId, "courier", claimed).catch(() => null);
      if (claim) claimed.add(claim.coinId);
      claims.push({ ref, claim });
    }
  } catch (err) {
    await abort();
    throw err;
  }

  const commit = async () => {
    for (const { ref, claim } of claims) {
      const coinId = claim?.coinId ?? `media-coin-${opts.postId}-${ref.merkleRoot.slice(0, 12)}`;
      await publishMediaCoinDraft(ref.merkleRoot, { coinId, postId: opts.postId });
      if (claim) await engraveReservedCoin(userId, claim.coinId, "courier", ref.merkleRoot, ref.size).catch(() => false);
      await markMediaCoinContentSelf(ref.merkleRoot);
      queueLaunch({ coinId, merkleRoot: ref.merkleRoot });
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
