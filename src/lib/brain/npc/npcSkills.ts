/**
 * npcSkills — sparse Welford-smoothed skill memory per NPC.
 *
 * SCAFFOLD STAGE — in-memory only. Throttled IndexedDB persistence
 * (≥ 2.5 m project rule) lands with boot wiring.
 */
import type { SkillKey } from './npcTypes';

const _skills = new Map<string, Map<SkillKey, number>>();

function ensureFor(npcId: string): Map<SkillKey, number> {
  let m = _skills.get(npcId);
  if (!m) { m = new Map(); _skills.set(npcId, m); }
  return m;
}

/** Snapshot of an NPC's skill map (plain object copy). */
export function skillSnapshot(npcId: string): Record<SkillKey, number> {
  const m = _skills.get(npcId);
  if (!m) return {};
  return Object.fromEntries(m);
}

/** Record an outcome — Welford-smoothed in [0, 1]. */
export function recordOutcome(npcId: string, key: SkillKey, success: boolean): number {
  const m = ensureFor(npcId);
  const prev = m.get(key) ?? 0.5;
  const target = success ? 1 : 0;
  // Smooth: 0.9 inertia keeps the personality-like low-noise feel.
  const next = +(prev * 0.9 + target * 0.1).toFixed(4);
  m.set(key, next);
  return next;
}

/** Test seam. */
export function _resetSkillsForTest(): void {
  _skills.clear();
}