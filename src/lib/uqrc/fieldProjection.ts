/**
 * fieldProjection — pick the response candidate that minimises curvature
 * when added to the current field. Implements the |Ψ_Output⟩ rule:
 *
 *     Δ_q = Q_Score(u + ghost(c)) − Q_Score(u)        ← lower is better
 *
 * Ties merge → re-minimise once → pick the lowest.
 */

import {
  deserializeField,
  inject as fieldInject,
  qScore as fieldQScore,
  type Field,
} from './field';
import { FieldEngine } from './fieldEngine';

export interface ScoredCandidate<T> {
  candidate: T;
  text: string;
  deltaQ: number;
}

/** Score a single candidate against a cloned field. */
function scoreCandidate(snapshot: ReturnType<FieldEngine['cloneSnapshot']>, baselineQ: number, text: string, amplitude: number): number {
  const ghost: Field = deserializeField(snapshot);
  fieldInject(ghost, text, amplitude, 0);
  const q = fieldQScore(ghost);
  return q - baselineQ;
}

/**
 * Select the candidate whose injection produces the lowest curvature delta.
 * `getText` extracts the text representation from each candidate.
 * If the engine hasn't warmed up yet, returns null so callers fall back.
 */
export function selectByMinCurvature<T>(
  candidates: T[],
  engine: FieldEngine,
  getText: (c: T) => string,
  amplitude: number = 0.3,
): T | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  if (!engine.isWarmedUp()) return null;

  const snapshot = engine.cloneSnapshot();
  const baselineQ = engine.getQScore();

  const scored: ScoredCandidate<T>[] = candidates.map((c) => {
    const text = getText(c);
    const deltaQ = text.trim() ? scoreCandidate(snapshot, baselineQ, text, amplitude) : Number.POSITIVE_INFINITY;
    return { candidate: c, text, deltaQ };
  });

  scored.sort((a, b) => a.deltaQ - b.deltaQ);

  // Tie detection: top candidates within 1e-4 of the leader → merge & re-min
  const leader = scored[0];
  const tied = scored.filter((s) => Math.abs(s.deltaQ - leader.deltaQ) < 1e-4);
  if (tied.length === 1) return leader.candidate;

  // Merge: inject all tied texts into a fresh ghost, then pick whichever
  // candidate's solo signature most-aligns (lowest residual).
  const mergedField = deserializeField(snapshot);
  for (const t of tied) {
    if (t.text.trim()) fieldInject(mergedField, t.text, amplitude * 0.4, 0);
  }
  const mergedQ = fieldQScore(mergedField);

  let best = tied[0];
  let bestDist = Number.POSITIVE_INFINITY;
  for (const t of tied) {
    const d = Math.abs((t.deltaQ + mergedQ) - baselineQ);
    if (d < bestDist) { bestDist = d; best = t; }
  }
  return best.candidate;
}

/** Detect "definition-style" text — used by languageLearner to choose pin vs inject. */
const DEF_PATTERNS: RegExp[] = [
  /^\s*[A-Za-z][\w-]*\s+is\s+/i,
  /^\s*[A-Za-z][\w-]*\s+means\s+/i,
  /^\s*define\s+[A-Za-z]/i,
  /^\s*>\s*def:/i,
];

export function isDefinitionText(text: string): boolean {
  if (!text || text.length < 6) return false;
  return DEF_PATTERNS.some((re) => re.test(text));
}