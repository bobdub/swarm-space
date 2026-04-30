/**
 * npcRegistry — singleton enforcing population cap and personality
 * uniqueness. The registry is the only authoritative list of living
 * NPCs. Renderers / HUDs subscribe; the engine mutates.
 *
 * SCAFFOLD STAGE — in-memory only. Persistence (throttled IndexedDB
 * writes per project core rule) lands with the boot wiring patch.
 */
import { NPC_CAP, PERSONALITY_UNIQUENESS_EPS, type Npc, type PersonalitySeed } from './npcTypes';
import { vectorDistance } from './personalitySeed';

const _npcs = new Map<string, Npc>();
const _listeners = new Set<(list: Npc[]) => void>();

function notify(): void {
  const list = listNpcs();
  for (const fn of _listeners) fn(list);
}

/** Snapshot of all living NPCs. */
export function listNpcs(): Npc[] {
  return [...(_npcs.values())];
}

export function getNpc(id: string): Npc | undefined {
  return _npcs.get(id);
}

export function npcCount(): number {
  return _npcs.size;
}

/** True iff `seed` is at least PERSONALITY_UNIQUENESS_EPS from every existing NPC. */
export function isSeedUnique(seed: PersonalitySeed): boolean {
  for (const npc of _npcs.values()) {
    if (vectorDistance(seed, npc.seed) < PERSONALITY_UNIQUENESS_EPS) return false;
  }
  return true;
}

export type RegisterResult =
  | { ok: true; npc: Npc }
  | { ok: false; reason: 'cap-reached' | 'duplicate-personality' };

export function register(npc: Npc): RegisterResult {
  if (_npcs.size >= NPC_CAP) return { ok: false, reason: 'cap-reached' };
  if (!isSeedUnique(npc.seed)) return { ok: false, reason: 'duplicate-personality' };
  _npcs.set(npc.id, npc);
  notify();
  return { ok: true, npc };
}

export function unregister(id: string): boolean {
  const removed = _npcs.delete(id);
  if (removed) notify();
  return removed;
}

/** Replace an NPC in-place (e.g. after personality drift / aging). */
export function update(npc: Npc): void {
  if (!_npcs.has(npc.id)) return;
  _npcs.set(npc.id, npc);
  notify();
}

export function subscribe(fn: (list: Npc[]) => void): () => void {
  _listeners.add(fn);
  fn(listNpcs());
  return () => { _listeners.delete(fn); };
}

/** Test seam — drop the registry between unit tests. */
export function _resetRegistryForTest(): void {
  _npcs.clear();
  _listeners.clear();
}