/**
 * labField — singleton seam between the Lab UI and the UQRC field engine.
 *
 * SCAFFOLD STAGE — exposes the public surface the Lab will call into
 * (seed / tick / subscribe / serialize) without yet running the
 * 4 Hz scheduler. The actual `Field` from `src/lib/uqrc/field.ts` is
 * lazily created on first access so opening the Lab tab never costs
 * anything until the user starts drawing.
 *
 * INVARIANT — this module is the only place `/remix` may construct or
 * tick a `Field`. UI components never import `field.ts` directly, the
 * same way the Builder Bar never touches `field.axes`.
 */
import {
  createField,
  qScore,
  serializeField,
  type Field,
  type FieldSnapshot,
} from '@/lib/uqrc/field';

export interface LabFieldStats {
  ticks: number;
  qScore: number;
}

let _field: Field | null = null;
const _listeners = new Set<(s: LabFieldStats) => void>();

function ensureField(): Field {
  if (!_field) _field = createField();
  return _field;
}

export function getLabField(): Field {
  return ensureField();
}

export function getLabStats(): LabFieldStats {
  const f = ensureField();
  return { ticks: f.ticks, qScore: qScore(f) };
}

export function snapshotLab(): FieldSnapshot {
  return serializeField(ensureField());
}

export function subscribeLab(fn: (s: LabFieldStats) => void): () => void {
  _listeners.add(fn);
  fn(getLabStats());
  return () => { _listeners.delete(fn); };
}

/** Reset the Lab to a fresh `u(0)`. */
export function resetLab(): void {
  _field = createField();
  for (const fn of _listeners) fn(getLabStats());
}

/** Test seam — drop the singleton between unit tests. */
export function _disposeLabFieldForTest(): void {
  _field = null;
  _listeners.clear();
}