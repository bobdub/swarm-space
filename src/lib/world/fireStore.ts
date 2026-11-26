/**
 * fireStore — campfires in placed fire pits, the same for every peer.
 *
 * A fire is not a toggle anyone owns. It is a small log of "someone put
 * Wood on this pit at time t" facts. Whether a pit burns, and until when,
 * is a pure function of that log and the shared clock (`burnUntil`), so
 * every peer holding the same facts shows the same flames, and the fire
 * goes out on its own everywhere at once without anyone sending "out".
 *
 * Facts are gossiped like nature events (see p2pPlacementBridge): each
 * new one is relayed to connected peers and a newcomer is handed the full
 * list. Peers drop facts they already hold, so the relay stops by itself.
 * Kept in localStorage so a reload alone does not put a fire out.
 *
 * Wood is spent on the device of whoever adds it (`spendMaterials`), and
 * only after the spend succeeds is the fact recorded.
 */

/** How long one Wood keeps a fire burning. */
export const BURN_MS_PER_WOOD = 5 * 60_000;
/** A pit holds at most this much burn time ahead of now. */
export const MAX_BURN_MS = 30 * 60_000;
/** Wood it takes to light a cold pit (and to add each time after). */
export const WOOD_PER_FUEL = 1;
/** Facts older than this can no longer change anything a player sees. */
const KEEP_MS = 24 * 60 * 60_000;
const MAX_EVENTS = 4000;
const STORAGE_KEY = 'brain.fireEvents.v1';

export interface FireEvent {
  /** Unique: `fuel:${pitId}:${at}:${actorId}`. */
  id: string;
  kind: 'fuel';
  /** The fire pit's placementId. */
  pitId: string;
  /** Who added the wood (display only). */
  actorId: string;
  /** Units of Wood added. */
  wood: number;
  /** When (ms, shared clock). */
  at: number;
}

type Listener = () => void;
type Gossip = (evt: FireEvent) => void;

const events = new Map<string, FireEvent>();
const listeners = new Set<Listener>();
let gossip: Gossip | null = null;
let hydrated = false;

export function fireEventId(pitId: string, at: number, actorId: string): string {
  return `fuel:${pitId}:${at}:${actorId}`;
}

function isEvent(v: unknown): v is FireEvent {
  const e = v as FireEvent | null;
  return !!e
    && e.kind === 'fuel'
    && typeof e.pitId === 'string' && e.pitId.length > 0 && e.pitId.length < 200
    && typeof e.actorId === 'string' && e.actorId.length < 200
    && Number.isInteger(e.wood) && e.wood >= 1 && e.wood <= 10
    && Number.isFinite(e.at)
    && e.id === fireEventId(e.pitId, e.at, e.actorId);
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
  for (const [id, e] of events) if (now - e.at > KEEP_MS) events.delete(id);
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

function add(e: FireEvent, now: number): boolean {
  if (events.has(e.id)) return false;
  // Ignore facts from the future, and ones too old to matter.
  if (e.at - now > 5 * 60_000) return false;
  if (now - e.at > KEEP_MS) return false;
  events.set(e.id, e);
  prune(now);
  persist();
  return true;
}

function sortedFor(pitId: string): FireEvent[] {
  return [...events.values()]
    .filter((e) => e.pitId === pitId)
    .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * When the fire in `pitId` goes out (ms), or 0 if it was never lit.
 * Folded in time order: wood on a cold pit starts a new fire, wood on a
 * burning one extends it, never past `MAX_BURN_MS` ahead of that moment.
 */
export function burnUntil(pitId: string): number {
  hydrate();
  let end = 0;
  for (const e of sortedFor(pitId)) {
    const from = Math.max(end, e.at);
    end = Math.min(from + e.wood * BURN_MS_PER_WOOD, e.at + MAX_BURN_MS);
  }
  return end;
}

/**
 * True when the fire in `pitId` burned without a break from `from` to
 * `to` (ms). A fire that went out and was lit again in between does not
 * count: whatever was on the grill went cold.
 */
export function litThrough(pitId: string, from: number, to: number): boolean {
  hydrate();
  let start = 0;
  let end = 0;
  for (const e of sortedFor(pitId)) {
    if (e.at > end) {
      // The fire was out; this wood starts a new one.
      if (start <= from && end >= to && end > 0) return true;
      start = e.at;
    }
    const f = Math.max(end, e.at);
    end = Math.min(f + e.wood * BURN_MS_PER_WOOD, e.at + MAX_BURN_MS);
  }
  return end > 0 && start <= from && end >= to;
}

export function isFireLit(pitId: string, now = Date.now()): boolean {
  return burnUntil(pitId) > now;
}

/** Remaining burn time in ms (0 when out). */
export function fireRemainingMs(pitId: string, now = Date.now()): number {
  return Math.max(0, burnUntil(pitId) - now);
}

/** True when adding wood now would add no burn time (the pit is full). */
export function isFireFull(pitId: string, now = Date.now()): boolean {
  return fireRemainingMs(pitId, now) > MAX_BURN_MS - BURN_MS_PER_WOOD / 2;
}

/** Record wood this player put on a pit, and tell the other peers. */
export function recordFuel(pitId: string, actorId: string, wood = WOOD_PER_FUEL, at = Date.now()): FireEvent {
  hydrate();
  // Two logs in the same millisecond are still two logs.
  while (events.has(fireEventId(pitId, at, actorId))) at += 1;
  const e: FireEvent = { id: fireEventId(pitId, at, actorId), kind: 'fuel', pitId, actorId, wood, at };
  if (add(e, at)) {
    notify();
    try { gossip?.(e); } catch { /* noop */ }
  }
  return e;
}

/** A fact from another peer. Returns true if it was new. */
export function acceptPeerFireEvent(payload: unknown, now = Date.now()): boolean {
  hydrate();
  if (!isEvent(payload)) return false;
  const e = { ...payload };
  if (!add(e, now)) return false;
  notify();
  try { gossip?.(e); } catch { /* noop */ }
  return true;
}

/** Merge a peer's full list (newcomer backfill). Returns how many were new. */
export function mergeFireEvents(payload: unknown, now = Date.now()): number {
  hydrate();
  if (!Array.isArray(payload)) return 0;
  const fresh: FireEvent[] = [];
  for (const e of payload.slice(0, MAX_EVENTS)) {
    if (!isEvent(e)) continue;
    const copy = { ...e };
    if (add(copy, now)) fresh.push(copy);
  }
  if (fresh.length > 0) {
    notify();
    for (const e of fresh) {
      try { gossip?.(e); } catch { /* noop */ }
    }
  }
  return fresh.length;
}

export function listFireEvents(): FireEvent[] {
  hydrate();
  prune(Date.now());
  return [...events.values()].sort((a, b) => a.at - b.at);
}

export function attachFireGossip(fn: Gossip): void {
  gossip = fn;
}

export function subscribeFire(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function _resetFireForTest(): void {
  events.clear();
  listeners.clear();
  gossip = null;
  hydrated = true;
}
