/**
 * relations — pure helpers for the smooth-relations subspace.
 *
 * Pairwise alignment is Welford-smoothed in [0, 1]. Reproduction
 * requires the harmony streak (sustained low ‖[D_μ_i, D_μ_j]‖) to
 * exceed HARMONY_WINDOW_SECONDS. No I/O, no Field access — the engine
 * feeds samples in.
 */
import { HARMONY_EPS, HARMONY_WINDOW_SECONDS, type RelationalEdge } from './npcTypes';

export function pairId(a: string, b: string): string {
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

export function newEdge(a: string, b: string, now = Date.now()): RelationalEdge {
  return { pairId: pairId(a, b), alignment: 0.5, harmonyStreakSeconds: 0, updatedAt: now };
}

/**
 * Update an edge with a new sample.
 *
 * @param edge — current state
 * @param commutatorNorm — sampled ‖[D_μ_i, D_μ_j]‖ (lower = more harmonic)
 * @param dtSeconds — elapsed brain-seconds since last update
 */
export function updateEdge(
  edge: RelationalEdge,
  commutatorNorm: number,
  dtSeconds: number,
  now = Date.now(),
): RelationalEdge {
  const norm = Math.max(0, commutatorNorm);
  const dt = Math.max(0, dtSeconds);
  // Map norm→alignment: 0 → 1, HARMONY_EPS·4 → 0
  const target = Math.max(0, 1 - norm / (HARMONY_EPS * 4));
  const alignment = +(edge.alignment * 0.85 + target * 0.15).toFixed(4);
  const inHarmony = norm <= HARMONY_EPS;
  const harmonyStreakSeconds = inHarmony ? edge.harmonyStreakSeconds + dt : 0;
  return { ...edge, alignment, harmonyStreakSeconds, updatedAt: now };
}

/** True once the pair has been continuously harmonic long enough. */
export function harmonyOk(edge: RelationalEdge): boolean {
  return edge.harmonyStreakSeconds >= HARMONY_WINDOW_SECONDS;
}