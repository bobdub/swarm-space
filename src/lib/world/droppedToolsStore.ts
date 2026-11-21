/**
 * droppedToolsStore — what happened to a tool lying on the ground.
 *
 * A dropped tool is an ordinary world placement (see worldPlacementsStore)
 * of a holdable tool prefab. Two things can end it:
 *
 *   • pickup — a village NPC walked over and took it. The NPC owns it from
 *     then on and uses it in its work.
 *   • vanish — every NPC already owned that kind of tool, so nobody wanted
 *     it, and it disappeared one minute after it was dropped.
 *
 * Each outcome is a small fact keyed by the placement id and gossiped like
 * fire and nature events (see p2pPlacementBridge). NPCs run on every
 * device, so two peers' villagers can reach the same tool at once. Every
 * peer keeps only the EARLIEST fact for a placement (a pickup beats a
 * vanish at the same instant, then the lower NPC name, then the lower
 * recorder id), so all peers agree on one outcome and only one NPC ever
 * holds the tool. NPCs are named deterministically (seed roster, children
 * from their parents), so the name is the identity every device shares.
 *
 * Applying a fact retires the placement on this device through a normal
 * placement tombstone: it leaves the view, the physics engine and storage,
 * is never seeded to newcomers again, and a stale copy from a peer is
 * refused. NPC tool ownership is a pure fold of the winning pickup facts,
 * so it survives reloads and matches on every device.
 *
 * Facts are unsigned, like placement tombstones: they describe village
 * life, not property, and carry no value.
 */
import {
  listAllPlacementRecords,
  retirePlacement,
  subscribePlacements,
} from '@/lib/world/worldPlacementsStore';

export type DroppedToolOutcome = 'pickup' | 'vanish';

export interface DroppedToolFact {
  /** The dropped tool's placement id. One outcome per placement. */
  placementId: string;
  prefabId: string;
  universeKey: string;
  outcome: DroppedToolOutcome;
  /** Pickup only: the NPC that took it. */
  npcName?: string;
  /** Device / identity that recorded the fact (tie-break only). */
  by: string;
  /** When it happened (ms, shared clock). */
  at: number;
}

/** A dropped tool nobody needs vanishes this long after it was dropped. */
export const UNWANTED_TOOL_TTL_MS = 60_000;
/** Facts further in the future than this are refused. */
const MAX_FUTURE_MS = 5 * 60_000;
/** Vanish facts only matter while a stale copy of the tool might return. */
const VANISH_KEEP_MS = 30 * 24 * 60 * 60_000;
const MAX_FACTS = 4000;
const STORAGE_KEY = 'brain.droppedTools.v1';

type Listener = () => void;
type Gossip = (fact: DroppedToolFact) => void;

const facts = new Map<string, DroppedToolFact>();
const listeners = new Set<Listener>();
let gossip: Gossip | null = null;
let hydrated = false;
let placementsWatched = false;

function isShortString(v: unknown, max = 200): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= max;
}

export function isDroppedToolFact(v: unknown): v is DroppedToolFact {
  const f = v as DroppedToolFact | null;
  if (!f || typeof f !== 'object') return false;
  if (!isShortString(f.placementId) || !isShortString(f.prefabId) || !isShortString(f.universeKey)) return false;
  if (!isShortString(f.by)) return false;
  if (!Number.isFinite(f.at) || f.at <= 0) return false;
  if (f.outcome === 'pickup') return isShortString(f.npcName, 80);
  if (f.outcome === 'vanish') return f.npcName === undefined;
  return false;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Negative when `a` should win over `b`. Same order on every peer. */
export function compareDroppedToolFacts(a: DroppedToolFact, b: DroppedToolFact): number {
  if (a.at !== b.at) return a.at - b.at;
  if (a.outcome !== b.outcome) return a.outcome === 'pickup' ? -1 : 1;
  return cmp(a.npcName ?? '', b.npcName ?? '') || cmp(a.by, b.by);
}

function normalize(f: DroppedToolFact): DroppedToolFact {
  const out: DroppedToolFact = {
    placementId: f.placementId,
    prefabId: f.prefabId,
    universeKey: f.universeKey,
    outcome: f.outcome,
    by: f.by,
    at: f.at,
  };
  if (f.outcome === 'pickup') out.npcName = f.npcName;
  return out;
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return;
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return;
    for (const f of list) {
      if (!isDroppedToolFact(f)) continue;
      const prev = facts.get(f.placementId);
      if (!prev || compareDroppedToolFacts(f, prev) < 0) facts.set(f.placementId, normalize(f));
    }
    prune(Date.now());
  } catch { /* storage blocked or corrupt */ }
  watchPlacements();
}

function persist(): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify([...facts.values()]));
  } catch { /* storage blocked */ }
}

function prune(now: number): void {
  // Pickups are ownership, so they stay; old vanish facts can go.
  for (const [id, f] of facts) {
    if (f.outcome === 'vanish' && now - f.at > VANISH_KEEP_MS) facts.delete(id);
  }
  if (facts.size > MAX_FACTS) {
    const oldest = [...facts.values()]
      .sort((a, b) => (a.outcome === b.outcome ? a.at - b.at : a.outcome === 'vanish' ? -1 : 1))
      .slice(0, facts.size - MAX_FACTS);
    for (const f of oldest) facts.delete(f.placementId);
  }
}

function notify(): void {
  for (const fn of listeners) {
    try { fn(); } catch { /* noop */ }
  }
}

/** Retire the placement a winning fact ends, here and in other tabs. */
function retire(f: DroppedToolFact): void {
  try { retirePlacement(f.placementId, f.universeKey, f.at); } catch { /* noop */ }
}

/**
 * A copy of an ended tool can still arrive (a peer that missed the fact,
 * a record stamped by a clock running ahead of ours). Retire it again
 * whenever it shows up.
 */
function watchPlacements(): void {
  if (placementsWatched) return;
  placementsWatched = true;
  try {
    subscribePlacements(() => {
      for (const rec of listAllPlacementRecords()) {
        const f = facts.get(rec.placementId);
        if (f) retire(f);
      }
    });
  } catch { /* noop */ }
}

/** Keep `f` if it beats what we hold. Returns true when it became the winner. */
function add(f: DroppedToolFact, now: number): boolean {
  hydrate();
  watchPlacements();
  if (f.at - now > MAX_FUTURE_MS) return false;
  if (f.outcome === 'vanish' && now - f.at > VANISH_KEEP_MS) return false;
  const prev = facts.get(f.placementId);
  if (prev && compareDroppedToolFacts(f, prev) >= 0) return false;
  const next = normalize(f);
  facts.set(f.placementId, next);
  prune(now);
  persist();
  retire(next);
  return true;
}

/**
 * Record an outcome seen on this device and tell the other peers.
 * Returns the fact that now stands for that placement — which is a
 * different one when an earlier outcome was already known.
 */
export function recordDroppedToolFact(fact: DroppedToolFact, now = Date.now()): DroppedToolFact | null {
  if (!isDroppedToolFact(fact)) return null;
  if (add(fact, now)) {
    notify();
    try { gossip?.(facts.get(fact.placementId)!); } catch { /* noop */ }
  }
  return facts.get(fact.placementId) ?? null;
}

/** A fact from another peer. Returns true if it changed the outcome here. */
export function acceptPeerDroppedToolFact(payload: unknown, now = Date.now()): boolean {
  if (!isDroppedToolFact(payload)) return false;
  if (!add({ ...payload }, now)) return false;
  notify();
  // Relay onward so peers we're linked to but the sender isn't converge.
  try { gossip?.(facts.get(payload.placementId)!); } catch { /* noop */ }
  return true;
}

/** Merge a peer's full list (newcomer backfill). Returns how many changed. */
export function mergeDroppedToolFacts(payload: unknown, now = Date.now()): number {
  if (!Array.isArray(payload)) return 0;
  // Keyed by placement: a list may hold several claims on one tool.
  const changed = new Set<string>();
  for (const f of payload.slice(0, MAX_FACTS)) {
    if (!isDroppedToolFact(f)) continue;
    if (add({ ...f }, now)) changed.add(f.placementId);
  }
  if (changed.size > 0) {
    notify();
    for (const id of changed) {
      const f = facts.get(id);
      if (!f) continue;
      try { gossip?.(f); } catch { /* noop */ }
    }
  }
  return changed.size;
}

export function getDroppedToolFact(placementId: string): DroppedToolFact | null {
  hydrate();
  return facts.get(placementId) ?? null;
}

export function listDroppedToolFacts(): DroppedToolFact[] {
  hydrate();
  prune(Date.now());
  return [...facts.values()].sort((a, b) => a.at - b.at);
}

/** Prefab ids of every tool this NPC picked up, oldest first. */
export function toolsOwnedByNpc(npcName: string): string[] {
  hydrate();
  return [...facts.values()]
    .filter((f) => f.outcome === 'pickup' && f.npcName === npcName)
    .sort((a, b) => a.at - b.at)
    .map((f) => f.prefabId);
}

export function attachDroppedToolGossip(fn: Gossip): void {
  gossip = fn;
}

export function subscribeDroppedTools(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function _resetDroppedToolsForTest(): void {
  facts.clear();
  listeners.clear();
  gossip = null;
  hydrated = true;
}
