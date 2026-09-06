/**
 * worldDropsStore — loose gatherables lying on the ground.
 *
 * A drop is a short-lived, local visual: a felled tree leaves wood pieces
 * on the surface, the player walks over them, they fly in and the element
 * bag (and therefore the plain-words material totals) ticks up.
 *
 * Position is an Earth-LOCAL unit direction so drops stay glued to the
 * turning planet. In-memory only — a drop that outlives a reload would be
 * a ghost resource, so they simply expire.
 */
import type { Vec3 } from '@/lib/brain/earth';

export type DropKind = 'wood' | 'stone' | 'fibre' | 'food';

export interface WorldDrop {
  id: string;
  kind: DropKind;
  /** How many harvest units this piece is worth. */
  qty: number;
  localDir: Vec3;
  /** Metres above the local surface (drops settle to 0). */
  upOffset: number;
  createdAt: number;
  /** Set while the pickup is flying to the player. */
  claimedAt?: number;
}

type Listener = (list: WorldDrop[]) => void;

const drops = new Map<string, WorldDrop>();
const listeners = new Set<Listener>();

/** Drops disappear after this long so the ground never fills with litter. */
export const DROP_TTL_MS = 5 * 60_000;

function notify(): void {
  const snap = listDrops();
  for (const fn of listeners) {
    try { fn(snap); } catch { /* noop */ }
  }
}

export function listDrops(): WorldDrop[] {
  const now = Date.now();
  return [...drops.values()].filter((d) => now - d.createdAt < DROP_TTL_MS);
}

export function spawnDrop(input: Omit<WorldDrop, 'id' | 'createdAt'>): WorldDrop {
  const rec: WorldDrop = {
    ...input,
    id: `drop:${input.kind}:${Date.now().toString(36)}:${Math.floor(Math.random() * 1e6).toString(36)}`,
    createdAt: Date.now(),
  };
  drops.set(rec.id, rec);
  notify();
  return rec;
}

export function claimDrop(id: string): boolean {
  const d = drops.get(id);
  if (!d || d.claimedAt) return false;
  drops.set(id, { ...d, claimedAt: Date.now() });
  notify();
  return true;
}

export function removeDrop(id: string): void {
  if (!drops.delete(id)) return;
  notify();
}

export function subscribeDrops(fn: Listener): () => void {
  listeners.add(fn);
  try { fn(listDrops()); } catch { /* noop */ }
  return () => { listeners.delete(fn); };
}

export function _resetDropsForTest(): void {
  drops.clear();
  listeners.clear();
}
