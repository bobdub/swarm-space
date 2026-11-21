/**
 * natureEventsStore — the shared record of what players did to nature that
 * every peer must agree on: which trees were felled and when the honey
 * hive was chopped.
 *
 * Each event is a small immutable fact. Peers gossip new ones over the
 * mesh and hand a newcomer the full list (see p2pPlacementBridge), so the
 * set converges; everything built on it (which trees stand, where the hive
 * hangs) is a pure function of the set and the clock. Kept in
 * localStorage so a reload alone does not bring a felled tree back.
 *
 * Events are never expired by age: a regrown tree's id comes from the
 * felling before it, and the hive is replayed from its first host, so
 * history must stay whole for peers to agree. Only a size cap applies,
 * far above what a village sees.
 *
 * The one exception is `hen-caught`: a caught hen is back with her flock
 * after a few minutes, so once a catch is older than `HEN_EVENT_TTL_MS` it
 * no longer changes anything and every peer drops it (and refuses it from
 * a backfill), keeping the list small however many hens are hunted.
 *
 * Every newly learned event is passed on to the other connected peers, so
 * it reaches peers that are not directly connected to whoever made it.
 * Peers drop events they already hold, so the relay stops by itself.
 */

export type NatureEventKind = 'fell' | 'hive-down' | 'hen-caught';

/** Hen catches older than this are forgotten (well past any respawn). */
export const HEN_EVENT_TTL_MS = 60 * 60_000;

export interface NatureEvent {
  /** Unique: `${kind}:${blockId}:${at}`. */
  id: string;
  kind: NatureEventKind;
  /** Block body id the event is about, e.g. `tree:tree-3` or `hive:hive-0`. */
  blockId: string;
  /** Biome anchor the block belongs to. */
  anchorPeerId: string;
  /** When it happened (ms, shared clock). */
  at: number;
  /** Where the block stood (right / forward offset from the anchor). */
  x: number;
  z: number;
}

const MAX_EVENTS = 5000;
const STORAGE_KEY = 'brain.natureEvents.v1';

type Listener = () => void;
type Gossip = (evt: NatureEvent) => void;

const events = new Map<string, NatureEvent>();
const listeners = new Set<Listener>();
let gossip: Gossip | null = null;
let hydrated = false;

function isEvent(v: unknown): v is NatureEvent {
  const e = v as NatureEvent | null;
  return !!e
    && typeof e.id === 'string'
    && (e.kind === 'fell' || e.kind === 'hive-down' || e.kind === 'hen-caught')
    && typeof e.blockId === 'string' && e.blockId.length > 0 && e.blockId.length < 200
    && typeof e.anchorPeerId === 'string' && e.anchorPeerId.length < 200
    && Number.isFinite(e.at)
    && Number.isFinite(e.x) && Number.isFinite(e.z)
    && e.id === eventId(e.kind, e.blockId, e.at);
}

export function eventId(kind: NatureEventKind, blockId: string, at: number): string {
  return `${kind}:${blockId}:${at}`;
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return;
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return;
    for (const e of list) if (isEvent(e)) events.set(e.id, e);
    prune();
  } catch { /* storage blocked or corrupt */ }
}

function persist(): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify([...events.values()]));
  } catch { /* storage blocked */ }
}

function prune(now = Date.now()): void {
  for (const e of events.values()) {
    if (e.kind === 'hen-caught' && now - e.at > HEN_EVENT_TTL_MS) events.delete(e.id);
  }
  if (events.size > MAX_EVENTS) {
    const oldest = [...events.values()].sort((a, b) => a.at - b.at).slice(0, events.size - MAX_EVENTS);
    for (const e of oldest) events.delete(e.id);
  }
}

function notify(): void {
  for (const fn of listeners) {
    try { fn(); } catch { /* noop */ }
  }
}

function add(e: NatureEvent, now: number): boolean {
  if (events.has(e.id)) return false;
  // Ignore anything claiming to come from the future.
  if (e.at - now > 5 * 60_000) return false;
  // A long-past hen catch changes nothing: the hen is back.
  if (e.kind === 'hen-caught' && now - e.at > HEN_EVENT_TTL_MS) return false;
  events.set(e.id, e);
  prune(now);
  persist();
  return true;
}

/** Record something this player did, and tell the other peers. */
export function recordNatureEvent(
  kind: NatureEventKind,
  blockId: string,
  anchorPeerId: string,
  x: number,
  z: number,
  at = Date.now(),
): NatureEvent {
  hydrate();
  const e: NatureEvent = { id: eventId(kind, blockId, at), kind, blockId, anchorPeerId, at, x, z };
  if (add(e, at)) {
    notify();
    try { gossip?.(e); } catch { /* noop */ }
  }
  return e;
}

/** An event from another peer. Returns true if it was new. */
export function acceptPeerNatureEvent(payload: unknown, now = Date.now()): boolean {
  hydrate();
  if (!isEvent(payload)) return false;
  const e = { ...payload };
  const ok = add(e, now);
  if (ok) {
    notify();
    relay(e);
  }
  return ok;
}

/** Merge a peer's full list (newcomer backfill). Returns how many were new. */
export function mergeNatureEvents(payload: unknown, now = Date.now()): number {
  hydrate();
  if (!Array.isArray(payload)) return 0;
  const fresh: NatureEvent[] = [];
  for (const e of payload.slice(0, MAX_EVENTS)) {
    if (!isEvent(e)) continue;
    const copy = { ...e };
    if (add(copy, now)) fresh.push(copy);
  }
  if (fresh.length > 0) {
    notify();
    for (const e of fresh) relay(e);
  }
  return fresh.length;
}

export function listNatureEvents(anchorPeerId?: string): NatureEvent[] {
  hydrate();
  const all = [...events.values()];
  return (anchorPeerId ? all.filter((e) => e.anchorPeerId === anchorPeerId) : all)
    .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Earliest time `blockId` was felled, if it was. */
export function felledAt(blockId: string): number | undefined {
  hydrate();
  let best: number | undefined;
  for (const e of events.values()) {
    if (e.kind === 'fell' && e.blockId === blockId && (best === undefined || e.at < best)) best = e.at;
  }
  return best;
}

/** Pass a newly learned event on to the peers we are connected to. */
function relay(e: NatureEvent): void {
  try { gossip?.(e); } catch { /* noop */ }
}

export function attachNatureEventGossip(fn: Gossip): void {
  gossip = fn;
}

export function subscribeNatureEvents(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function _resetNatureEventsForTest(): void {
  events.clear();
  listeners.clear();
  gossip = null;
  hydrated = true;
}
