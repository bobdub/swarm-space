/**
 * worldPlacementsStore — IDB persistence + cross-tab/P2P gossip for
 * Phase 5 user-placed prefabs. Mirrors the mintedPrefabsStore pattern:
 * local-first, BroadcastChannel fan-out, gossip-bridge plug-point,
 * non-destructive IDB upgrade, local-protect against peer overwrite.
 */
import { getBuilderBlockEngine } from '@/lib/brain/builderBlockEngine';
import { getCurrentUser } from '@/lib/auth';
import { ownsPlacement } from '@/lib/world/buildOwnership';
import {
  placePrefabAtHit,
  poseTimeFromCreatedAt,
  type PlacedHandle,
} from '@/lib/world/placementController';
import { isPlacementIdle, lastPlacementActivityAt } from '@/lib/world/placementActivity';
import { isPlacementUnsupported, isPostUnsupported, subscribeUnsupportedPosts } from '@/lib/content/unsupportedPostsStore';
import { isLightBuilderMode, subscribeBuilderRenderMode } from '@/lib/brain/builderRenderModeStore';

const DB_NAME = 'swarm-world-placements';
const STORE = 'placements';
const TOMB_STORE = 'tombstones';
const DB_VERSION = 2;
const CHANNEL_NAME = 'swarm:world:placements';
const SNAPSHOT_KEY = 'swarm:world:placements:snapshot';
const TOMB_SNAPSHOT_KEY = 'swarm:world:placements:tombstones';
/** Tombstones older than this are pruned to keep storage bounded. */
const TOMB_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface PlacementRecord extends PlacedHandle {
  _origin: 'local' | 'peer';
  /** Wall decoration: a Post pinned to this wall's front face. */
  decoration?: { postId: string; updatedAt: number };
  /** Universe scope this placement belongs to (e.g. 'global', 'project-<id>',
   *  'liveroom-<id>'). Legacy rows without this field are treated as 'global'. */
  universeKey?: string;
  /** Last author activity (place, move, edit, re-decorate, refresh). Drives
   *  the Main Brain 5-day gate together with wall interactions. */
  activityAt?: number;
  /** The builder's display name when placed, for labels such as a
   *  Trading Stand's awning. Display only: ownership is `actorId`. */
  ownerName?: string;
}

/** The signed-in user's display name, trimmed for a world label. */
function currentOwnerName(): string | undefined {
  try {
    const u = getCurrentUser();
    const name = (u?.displayName || u?.username || '').trim();
    return name ? name.slice(0, 32) : undefined;
  } catch {
    return undefined;
  }
}

/** Deletion record — outlives the placement so backfill can't resurrect it. */
export interface PlacementTombstone {
  placementId: string;
  universeKey: string;
  deletedAt: number;
}

type Listener = (records: PlacementRecord[]) => void;
const listeners = new Set<Listener>();
const records = new Map<string, PlacementRecord>();
const tombstones = new Map<string, PlacementTombstone>();
let storageHydrated = false;
let channel: BroadcastChannel | null = null;
let gossipBridge: ((rec: PlacementRecord) => void) | null = null;
let deleteGossipBridge: ((tomb: PlacementTombstone) => void) | null = null;

/** Currently-active universe scope. Set by the scene whenever the user
 *  enters a different Brain (lobby ↔ project hub ↔ live room). */
let activeUniverse = 'global';

function scopeOf(rec: { universeKey?: string }): string {
  return rec.universeKey && rec.universeKey.length > 0 ? rec.universeKey : 'global';
}

export function setActiveUniverse(key: string): void {
  const next = key && key.length > 0 ? key : 'global';
  if (next === activeUniverse) return;
  activeUniverse = next;
  // Rebind the BuilderBlockEngine to only this universe's placements.
  // Tear down EVERY block we know about (regardless of scope) so a stale
  // global block can't survive a universe switch, then replay the new
  // scope from scratch. This is the single source-of-truth for what
  // belongs in the current Brain.
  try {
    const engine = getBuilderBlockEngine();
    for (const rec of records.values()) {
      engine.removeBlock(rec.placementId, rec.prefabId);
    }
    for (const rec of records.values()) {
      if (scopeOf(rec) === activeUniverse) replayPlacement(rec, { force: true });
    }
  } catch (err) {
    console.warn('[worldPlacements] universe rebind failed', err);
  }
  // Synchronous notify — a 250 ms debounce briefly flashed the previous
  // universe's walls in the new Brain. Fire listeners immediately so
  // UserPlacementsLayer re-renders with the filtered list on the same
  // frame the universe switches.
  flushNotify();
}

export function getActiveUniverse(): string {
  return activeUniverse;
}

/**
 * Placements this device does not materialize at all — no block, no
 * physics collider, no render. Light builder mode bypasses every user
 * placement; a wall whose pinned post this node stopped supporting is
 * skipped on its own.
 */
export function isPlacementSuppressed(
  rec: Pick<PlacementRecord, 'decoration'> & { placementId?: string },
): boolean {
  if (isLightBuilderMode()) return true;
  if (isPlacementUnsupported(rec.placementId)) return true;
  return isPostUnsupported(rec.decoration?.postId);
}

/** Own placements never go idle on the author's device, so the author can
 *  always see and refresh them. */
function isIdleElsewhere(rec: PlacementRecord): boolean {
  if (ownsPlacement(rec, getCurrentUser()?.id)) return false;
  return isPlacementIdle(rec);
}

function replayPlacement(rec: PlacementRecord, opts: { force?: boolean } = {}): void {
  if (isPlacementSuppressed(rec)) {
    try { getBuilderBlockEngine().removeBlock(rec.placementId, rec.prefabId); } catch { /* noop */ }
    return;
  }
  try {
    if (opts.force) getBuilderBlockEngine().removeBlock(rec.placementId, rec.prefabId);
    placePrefabAtHit({
      hitPoint: rec.hitPoint,
      prefabId: rec.prefabId,
      actorId: rec.actorId,
      placedAtPoseTime: rec.placedAtPoseTime ?? poseTimeFromCreatedAt(rec.createdAt),
      localNormal: rec.localNormal,
      localForward: rec.localForward,
      localRight: rec.localRight,
      yaw: rec.yaw,
      upOffset: rec.upOffset ?? 0,
      placementId: rec.placementId,
    });
  } catch (err) {
    console.warn('[worldPlacements] replay failed', err);
  }
}

function readSnapshot(): PlacementRecord[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((rec): rec is PlacementRecord => Boolean(rec?.placementId));
  } catch {
    return [];
  }
}

function writeSnapshot(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const snap = [...records.values()].filter((rec) => rec._origin === 'local');
    if (snap.length === 0) {
      localStorage.removeItem(SNAPSHOT_KEY);
      return;
    }
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snap));
  } catch {
    /* noop */
  }
}

function pruneTombstones(): void {
  const cutoff = Date.now() - TOMB_TTL_MS;
  for (const [id, tomb] of tombstones) {
    if (tomb.deletedAt < cutoff) tombstones.delete(id);
  }
}

function readTombSnapshot(): PlacementTombstone[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(TOMB_SNAPSHOT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (t): t is PlacementTombstone => Boolean(t?.placementId) && typeof t?.deletedAt === 'number',
    );
  } catch {
    return [];
  }
}

function writeTombSnapshot(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    pruneTombstones();
    const snap = [...tombstones.values()];
    if (snap.length === 0) {
      localStorage.removeItem(TOMB_SNAPSHOT_KEY);
      return;
    }
    localStorage.setItem(TOMB_SNAPSHOT_KEY, JSON.stringify(snap));
  } catch {
    /* noop */
  }
}

/** True when a tombstone supersedes the given record. */
function isTombstoned(rec: { placementId: string; createdAt?: number }): boolean {
  const tomb = tombstones.get(rec.placementId);
  if (!tomb) return false;
  const born = typeof rec.createdAt === 'number' ? rec.createdAt : 0;
  return tomb.deletedAt >= born;
}

function chan(): BroadcastChannel | null {
  if (channel) return channel;
  if (typeof BroadcastChannel === 'undefined') return null;
  try { channel = new BroadcastChannel(CHANNEL_NAME); } catch { channel = null; }
  if (channel) {
    channel.onmessage = (ev) => {
      const data = ev?.data as
        | (PlacementRecord & { __delete?: never })
        | { __delete: PlacementTombstone }
        | undefined;
      if (!data) return;
      if ('__delete' in data && data.__delete?.placementId) {
        applyTombstone(data.__delete, { persist: true });
        return;
      }
      const rec = data as PlacementRecord;
      if (!rec.placementId) return;
      ingest({ ...rec, _origin: 'peer' });
    };
  }
  return channel;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    let req: IDBOpenDBRequest;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch { return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'placementId' });
      if (!db.objectStoreNames.contains(TOMB_STORE)) db.createObjectStore(TOMB_STORE, { keyPath: 'placementId' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { try { db.close(); } catch { /* noop */ } };
      resolve(db);
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

async function dbPut(rec: PlacementRecord): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(rec);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
  try { db.close(); } catch { /* noop */ }
}

async function dbDelete(placementId: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(placementId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
    tx.onabort = () => resolve();
  });
  try { db.close(); } catch { /* noop */ }
}

async function dbAll(): Promise<PlacementRecord[]> {
  const db = await openDb();
  if (!db) return [];
  const out = await new Promise<PlacementRecord[]>((resolve) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as PlacementRecord[]) ?? []);
    req.onerror = () => resolve([]);
  });
  try { db.close(); } catch { /* noop */ }
  return out;
}

async function dbPutTomb(tomb: PlacementTombstone): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(TOMB_STORE, 'readwrite');
      tx.objectStore(TOMB_STORE).put(tomb);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch { resolve(); }
  });
  try { db.close(); } catch { /* noop */ }
}

async function dbAllTombs(): Promise<PlacementTombstone[]> {
  const db = await openDb();
  if (!db) return [];
  const out = await new Promise<PlacementTombstone[]>((resolve) => {
    try {
      const tx = db.transaction(TOMB_STORE, 'readonly');
      const req = tx.objectStore(TOMB_STORE).getAll();
      req.onsuccess = () => resolve((req.result as PlacementTombstone[]) ?? []);
      req.onerror = () => resolve([]);
    } catch { resolve([]); }
  });
  try { db.close(); } catch { /* noop */ }
  return out;
}

/**
 * Record a deletion and drop any live record it supersedes.
 * Idempotent: an older tombstone never overwrites a newer one.
 */
function applyTombstone(
  tomb: PlacementTombstone,
  opts: { persist?: boolean } = {},
): boolean {
  if (!tomb?.placementId) return false;
  const normalized: PlacementTombstone = {
    placementId: tomb.placementId,
    universeKey: tomb.universeKey || 'global',
    deletedAt: typeof tomb.deletedAt === 'number' ? tomb.deletedAt : Date.now(),
  };
  const prev = tombstones.get(normalized.placementId);
  if (prev && prev.deletedAt >= normalized.deletedAt) return false;
  tombstones.set(normalized.placementId, normalized);
  const existing = records.get(normalized.placementId);
  if (existing && isTombstoned(existing)) {
    records.delete(normalized.placementId);
    try { getBuilderBlockEngine().removeBlock(existing.placementId, existing.prefabId); } catch { /* noop */ }
    void dbDelete(existing.placementId).catch(() => { /* noop */ });
    writeSnapshot();
  }
  writeTombSnapshot();
  if (opts.persist) void dbPutTomb(normalized).catch(() => { /* noop */ });
  scheduleNotify();
  return true;
}

let notifyHandle: number | null = null;
function scheduleNotify(): void {
  if (notifyHandle !== null) return;
  notifyHandle = (typeof window !== 'undefined' ? window.setTimeout : setTimeout)(() => {
    notifyHandle = null;
    flushNotify();
  }, 250) as unknown as number;
}

function flushNotify(): void {
  if (notifyHandle !== null) {
    try { clearTimeout(notifyHandle); } catch { /* noop */ }
    notifyHandle = null;
  }
  const snap = listPlacements();
  for (const fn of listeners) {
    try { fn(snap); } catch (err) { console.warn('[worldPlacements] listener error', err); }
  }
}

function ingest(rec: PlacementRecord, opts: { replay?: boolean } = {}): void {
  if (isTombstoned(rec)) return;
  const existing = records.get(rec.placementId);
  if (existing && existing._origin === 'local' && rec._origin === 'peer') return;
  // Main Brain 5-day gate: an idle placement isn't carried by this peer.
  if (scopeOf(rec) === 'global' && isIdleElsewhere(rec)) {
    if (existing && isIdleElsewhere(existing)) dropIdlePlacement(existing);
    else if (!existing && opts.replay) void dbDelete(rec.placementId).catch(() => { /* noop */ });
    return;
  }
  records.set(rec.placementId, rec);
  // Persist peer-origin GLOBAL (main-Brain lobby) placements so a reload
  // doesn't blank the shared lobby before the next backfill sync lands.
  // Project / live-room scopes are never persisted from peers.
  if (rec._origin === 'peer' && scopeOf(rec) === 'global' && !opts.replay) {
    void dbPut(rec).catch(() => { /* noop */ });
  }
  // Replay onto the BuilderBlockEngine on hydration / peer arrival —
  // but only if this record belongs to the active universe. Otherwise
  // we'd materialize main-Brain walls inside a project hub.
  const inScope = scopeOf(rec) === activeUniverse;
  if (inScope && (opts.replay || rec._origin === 'peer')) {
    const changed = !existing
      || existing.prefabId !== rec.prefabId
      || existing.yaw !== rec.yaw
      || (existing.upOffset ?? 0) !== (rec.upOffset ?? 0)
      || existing.hitPoint.some((value, index) => Math.abs(value - rec.hitPoint[index]) > 0.001);
    replayPlacement(rec, { force: opts.replay || changed });
  }
  scheduleNotify();
}

export async function hydrateWorldPlacements(): Promise<void> {
  chan();
  watchSuppression();
  startIdleSweep();
  if (!storageHydrated) {
    storageHydrated = true;
    for (const tomb of [...(await dbAllTombs()), ...readTombSnapshot()]) {
      const prev = tombstones.get(tomb.placementId);
      if (!prev || prev.deletedAt < tomb.deletedAt) tombstones.set(tomb.placementId, tomb);
    }
    pruneTombstones();
    const merged = new Map<string, PlacementRecord>();
    for (const rec of await dbAll()) merged.set(rec.placementId, rec);
    for (const rec of readSnapshot()) merged.set(rec.placementId, rec);
    for (const rec of merged.values()) {
      if (isTombstoned(rec)) { void dbDelete(rec.placementId).catch(() => { /* noop */ }); continue; }
      ingest({ ...rec, _origin: rec._origin === 'peer' ? 'peer' : 'local' }, { replay: true });
    }
  } else {
    for (const rec of records.values()) {
      if (scopeOf(rec) === activeUniverse) replayPlacement(rec, { force: true });
    }
    scheduleNotify();
  }
  sweepIdlePlacements();
  writeSnapshot();
  writeTombSnapshot();
}

export async function recordLocalPlacement(handle: PlacedHandle): Promise<PlacementRecord> {
  const rec: PlacementRecord = {
    ...handle,
    placedAtPoseTime: handle.placedAtPoseTime ?? poseTimeFromCreatedAt(handle.createdAt),
    _origin: 'local',
    universeKey: activeUniverse,
    activityAt: Date.now(),
    ownerName: currentOwnerName(),
  };
  records.set(rec.placementId, rec);
  if (isPlacementSuppressed(rec)) {
    try { getBuilderBlockEngine().removeBlock(rec.placementId, rec.prefabId); } catch { /* noop */ }
  }
  writeSnapshot();
  await dbPut(rec);
  try { chan()?.postMessage(rec); } catch { /* noop */ }
  try { gossipBridge?.(rec); } catch (err) { console.warn('[worldPlacements] gossip error', err); }
  scheduleNotify();
  return rec;
}

export async function updateLocalPlacement(handle: PlacedHandle): Promise<PlacementRecord | null> {
  const prev = records.get(handle.placementId);
  if (!prev || !ownsPlacement(prev, getCurrentUser()?.id) || handle.actorId !== prev.actorId) return null;
  if (prev) getBuilderBlockEngine().removeBlock(handle.placementId, prev.prefabId);
  // On move/edit the hitPoint changed but the cached local frame is
  // still the original one — using it would re-anchor the prefab at
  // the OLD spot and the "move" would visibly snap back. Drop the
  // cached frame so placePrefabAtHit recomputes a fresh Earth-local
  // frame from the new hit and we persist that.
  const refreshed = placePrefabAtHit({
    hitPoint: handle.hitPoint,
    prefabId: handle.prefabId,
    actorId: handle.actorId,
    placedAtPoseTime: handle.placedAtPoseTime,
    yaw: handle.yaw,
    upOffset: handle.upOffset ?? 0,
    placementId: handle.placementId,
  });
  const rec: PlacementRecord = {
    ...handle,
    localNormal: refreshed?.localNormal ?? handle.localNormal,
    localForward: refreshed?.localForward ?? handle.localForward,
    localRight: refreshed?.localRight ?? handle.localRight,
    placedAtPoseTime:
      refreshed?.placedAtPoseTime ?? handle.placedAtPoseTime ?? poseTimeFromCreatedAt(handle.createdAt),
    _origin: 'local',
    universeKey: prev?.universeKey ?? activeUniverse,
    activityAt: Date.now(),
    ownerName: prev?.ownerName ?? currentOwnerName(),
  };
  records.set(rec.placementId, rec);
  if (isPlacementSuppressed(rec)) {
    try { getBuilderBlockEngine().removeBlock(rec.placementId, rec.prefabId); } catch { /* noop */ }
  }
  writeSnapshot();
  await dbPut(rec);
  try { chan()?.postMessage(rec); } catch { /* noop */ }
  try { gossipBridge?.(rec); } catch (err) { console.warn('[worldPlacements] gossip error', err); }
  scheduleNotify();
  return rec;
}

/**
 * Patch metadata on an existing placement (e.g. wall decoration) without
 * touching the underlying BuilderBlock. Re-placing the block for a pure
 * metadata change tears down the physics body for a frame and makes the
 * wall visibly vanish — this path keeps the block intact.
 */
export async function patchLocalPlacementMeta(
  placementId: string,
  patch: Partial<Pick<PlacementRecord, 'decoration'>>,
): Promise<PlacementRecord | null> {
  const prev = records.get(placementId);
  if (!prev || !ownsPlacement(prev, getCurrentUser()?.id)) return null;
  const next: PlacementRecord = { ...prev, ...patch, _origin: 'local', activityAt: Date.now() };
  records.set(placementId, next);
  // A new pinned post may change whether this wall is suppressed here.
  if (isPlacementSuppressed(next)) {
    try { getBuilderBlockEngine().removeBlock(next.placementId, next.prefabId); } catch { /* noop */ }
  } else if (scopeOf(next) === activeUniverse) {
    replayPlacement(next);
  }
  writeSnapshot();
  await dbPut(next);
  try { chan()?.postMessage(next); } catch { /* noop */ }
  try { gossipBridge?.(next); } catch (err) { console.warn('[worldPlacements] gossip error', err); }
  scheduleNotify();
  return next;
}

export async function removeLocalPlacement(placementId: string): Promise<void> {
  const rec = records.get(placementId);
  if (!rec || !ownsPlacement(rec, getCurrentUser()?.id)) return;
  const tomb: PlacementTombstone = {
    placementId,
    universeKey: scopeOf(rec),
    deletedAt: Date.now(),
  };
  tombstones.set(placementId, tomb);
  records.delete(placementId);
  writeSnapshot();
  writeTombSnapshot();
  getBuilderBlockEngine().removeBlock(placementId, rec.prefabId);
  await dbDelete(placementId);
  await dbPutTomb(tomb);
  try { chan()?.postMessage({ __delete: tomb }); } catch { /* noop */ }
  try { deleteGossipBridge?.(tomb); } catch (err) { console.warn('[worldPlacements] delete gossip error', err); }
  scheduleNotify();
}

/**
 * Retire a placement because a shared world fact ended it (an NPC picked
 * up a dropped tool, or an unwanted tool vanished; see droppedToolsStore).
 * Every peer holding the fact calls this, so it is not gated on
 * ownership. It writes an ordinary tombstone, so the placement leaves the
 * view, physics and storage, is never seeded to newcomers again, and a
 * stale copy is refused. The tombstone is stamped no earlier than the
 * record's own createdAt, so a dropper whose clock runs ahead still loses
 * the tool. Only the owner's device relays the tombstone itself (as on a
 * normal delete), which also clears it for peers without the fact store.
 */
export function retirePlacement(placementId: string, universeKey: string, at: number): boolean {
  const existing = records.get(placementId);
  const deletedAt = Math.max(at, existing?.createdAt ?? 0);
  const tomb: PlacementTombstone = {
    placementId,
    universeKey: existing ? scopeOf(existing) : (universeKey || 'global'),
    deletedAt,
  };
  if (!applyTombstone(tomb, { persist: true })) return false;
  try { chan()?.postMessage({ __delete: tomb }); } catch { /* noop */ }
  if (existing && ownsPlacement(existing, getCurrentUser()?.id)) {
    try { deleteGossipBridge?.(tomb); } catch (err) { console.warn('[worldPlacements] delete gossip error', err); }
  }
  return true;
}

/** Every placement held on this device, in every universe scope. */
export function listAllPlacementRecords(): PlacementRecord[] {
  return [...records.values()];
}

/**
 * Author refresh: mark an owned placement active now and gossip it, so
 * peers that let it go idle in the Main Brain pick it back up.
 */
export async function touchLocalPlacement(placementId: string): Promise<PlacementRecord | null> {
  return patchLocalPlacementMeta(placementId, {});
}

/** Drop an idle peer placement from this node: render, physics, storage. */
function dropIdlePlacement(rec: PlacementRecord): void {
  records.delete(rec.placementId);
  try { getBuilderBlockEngine().removeBlock(rec.placementId, rec.prefabId); } catch { /* noop */ }
  void dbDelete(rec.placementId).catch(() => { /* noop */ });
  scheduleNotify();
}

/**
 * Main Brain 5-day gate sweep. Idle placements by other authors leave this
 * node (not tombstoned — an author refresh brings them back through the
 * normal gossip / lobby backfill). Returns how many were dropped.
 */
export function sweepIdlePlacements(now = Date.now()): number {
  let dropped = 0;
  for (const rec of [...records.values()]) {
    if (scopeOf(rec) !== 'global') continue;
    if (ownsPlacement(rec, getCurrentUser()?.id)) continue;
    if (!isPlacementIdle(rec, now)) continue;
    dropIdlePlacement(rec);
    dropped++;
  }
  if (dropped > 0) writeSnapshot();
  return dropped;
}

const IDLE_SWEEP_MS = 60 * 60 * 1000;
let idleSweepTimer: ReturnType<typeof setInterval> | null = null;
function startIdleSweep(): void {
  if (idleSweepTimer || typeof setInterval === 'undefined') return;
  idleSweepTimer = setInterval(() => { sweepIdlePlacements(); }, IDLE_SWEEP_MS);
  (idleSweepTimer as { unref?: () => void }).unref?.();
}

/**
 * Re-apply suppression to the active universe: remove blocks for walls
 * that are now suppressed (Light mode, Stop Support) and re-place the rest.
 */
export function resyncPlacementSuppression(): void {
  try {
    const engine = getBuilderBlockEngine();
    for (const rec of records.values()) {
      if (scopeOf(rec) !== activeUniverse) continue;
      if (isPlacementSuppressed(rec)) engine.removeBlock(rec.placementId, rec.prefabId);
      else replayPlacement(rec);
    }
  } catch (err) {
    console.warn('[worldPlacements] suppression resync failed', err);
  }
  flushNotify();
}

let suppressionWatched = false;
function watchSuppression(): void {
  if (suppressionWatched) return;
  suppressionWatched = true;
  subscribeBuilderRenderMode(resyncPlacementSuppression);
  subscribeUnsupportedPosts(resyncPlacementSuppression);
}

export function listPlacements(): PlacementRecord[] {
  return [...records.values()]
    .filter((rec) => scopeOf(rec) === activeUniverse)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function subscribePlacements(fn: Listener): () => void {
  listeners.add(fn);
  try { fn(listPlacements()); } catch { /* noop */ }
  return () => { listeners.delete(fn); };
}

export function attachPlacementGossip(bridge: (rec: PlacementRecord) => void): () => void {
  gossipBridge = bridge;
  return () => { if (gossipBridge === bridge) gossipBridge = null; };
}

export function attachPlacementDeleteGossip(
  bridge: (tomb: PlacementTombstone) => void,
): () => void {
  deleteGossipBridge = bridge;
  return () => { if (deleteGossipBridge === bridge) deleteGossipBridge = null; };
}

/** Inbound peer deletion (mesh). */
export function acceptPeerPlacementDelete(tomb: PlacementTombstone): void {
  applyTombstone(tomb, { persist: true });
}

/** Transport list of deletions for the main-Brain lobby. */
export function buildGlobalTombstoneSnapshot(): PlacementTombstone[] {
  pruneTombstones();
  return [...tombstones.values()].filter((t) => (t.universeKey || 'global') === 'global');
}

export function acceptPeerPlacement(rec: Omit<PlacementRecord, '_origin'>): void {
  ingest({ ...rec, _origin: 'peer' });
}

/**
 * Transport snapshot of everything standing in the MAIN BRAIN LOBBY.
 * Only `global`-scoped records are ever included — project and live-room
 * placements must never leave this node through the backfill path.
 */
export function buildGlobalPlacementSnapshot(): Omit<PlacementRecord, '_origin'>[] {
  return [...records.values()]
    // Idle Main Brain placements are not seeded to peers (5-day gate).
    // Placements (or pinned posts) this node stopped supporting aren't relayed.
    .filter((rec) => scopeOf(rec) === 'global' && !isTombstoned(rec) && !isPlacementIdle(rec)
      && !isPlacementUnsupported(rec.placementId) && !isPostUnsupported(rec.decoration?.postId))
    // Carry the newest activity (incl. wall views/tips/graffiti this node
    // has seen) in `activityAt`, so a newcomer with no interaction history
    // doesn't judge an actively used wall idle.
    .map(({ _origin: _ignored, ...rest }) => ({
      ...rest,
      universeKey: 'global',
      activityAt: Math.max(rest.activityAt ?? 0, lastPlacementActivityAt(rest)),
    }));
}

/** Merge a peer's lobby snapshot. Non-global entries are discarded. */
export function mergePlacementSnapshot(
  incoming: Omit<PlacementRecord, '_origin'>[] | undefined | null,
  incomingTombstones?: PlacementTombstone[] | null,
): number {
  if (Array.isArray(incomingTombstones)) {
    for (const tomb of incomingTombstones.slice(0, 2000)) {
      if (!tomb?.placementId) continue;
      if ((tomb.universeKey || 'global') !== 'global') continue;
      applyTombstone(tomb, { persist: true });
    }
  }
  if (!Array.isArray(incoming)) return 0;
  let merged = 0;
  for (const rec of incoming.slice(0, 2000)) {
    if (!rec?.placementId || !rec?.prefabId || !Array.isArray(rec.hitPoint)) continue;
    if (scopeOf(rec) !== 'global') continue;
    if (isTombstoned(rec)) continue;
    acceptPeerPlacement({ ...rec, universeKey: 'global' });
    merged++;
  }
  return merged;
}

export function _resetWorldPlacementsForTest(): void {
  records.clear();
  tombstones.clear();
  listeners.clear();
  storageHydrated = false;
  if (channel) { try { channel.close(); } catch { /* noop */ } channel = null; }
  gossipBridge = null;
  deleteGossipBridge = null;
  if (idleSweepTimer) { clearInterval(idleSweepTimer); idleSweepTimer = null; }
}