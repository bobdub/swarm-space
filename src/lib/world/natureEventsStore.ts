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
 */

export type NatureEventKind = 'fell' | 'hive-down';

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

/** Events older than this are dropped; everything they caused has long played out. */
export const NATURE_EVENT_TTL_MS = 7 * 24 * 60 * 60_000;
const MAX_EVENTS = 2000;
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
    && (e.kind === 'fell' || e.kind === 'hive-down')
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
    prune(Date.now());
  } catch { /* storage blocked or corrupt */ }
}

function persist(): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify([...events.values()]));
  } catch { /* storage blocked */ }
}

function prune(now: number): void {
  for (const [id, e] of events) if (now - e.at > NATURE_EVENT_TTL_MS) events.delete(id);
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
  // Ignore stale facts and anything claiming to come from the future.
  if (now - e.at > NATURE_EVENT_TTL_MS || e.at - now > 5 * 60_000) return false;
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
  const ok = add({ ...payload }, now);
  if (ok) notify();
  return ok;
}

/** Merge a peer's full list (newcomer backfill). Returns how many were new. */
export function mergeNatureEvents(payload: unknown, now = Date.now()): number {
  hydrate();
  if (!Array.isArray(payload)) return 0;
  let n = 0;
  for (const e of payload.slice(0, MAX_EVENTS)) if (isEvent(e) && add({ ...e }, now)) n++;
  if (n > 0) notify();
  return n;
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
