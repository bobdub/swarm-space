/**
 * assetCaster — shared "pending cast" registry used by the in-Canvas
 * AssetCaster surface. Lets feature modules (portal drop, prefab place,
 * future tools) request a raycast click on Earth without each one
 * shipping its own invisible interaction sphere.
 *
 * Determinism: cast payload is whatever the requester provides; the
 * raycast surface only resolves the world-space hit point and forwards
 * it back via onHit. No randomness, no schedule, no side effects.
 */
import type { Vec3 } from '@/lib/brain/earth';

export type CastKind = 'portal' | 'prefab' | 'generic';

export interface PendingCast {
  kind: CastKind;
  /** Human-readable hint shown while casting. */
  label?: string;
  /** Opaque payload returned to the handler. */
  payload?: unknown;
  /** Called with the world-space hit point on Earth. Return true to
   *  consume the cast (clears the pending state). */
  onHit: (hitPoint: Vec3, payload: unknown) => boolean | void;
}

type Listener = (cast: PendingCast | null) => void;

let pending: PendingCast | null = null;
const listeners = new Set<Listener>();

export function getPendingCast(): PendingCast | null {
  return pending;
}

export function setPendingCast(cast: PendingCast | null): void {
  pending = cast;
  for (const l of listeners) {
    try { l(pending); } catch { /* listener crash isolated */ }
  }
}

export function clearPendingCast(): void {
  setPendingCast(null);
}

export function subscribeCast(listener: Listener): () => void {
  listeners.add(listener);
  // prime with current state for late subscribers
  try { listener(pending); } catch { /* noop */ }
  return () => { listeners.delete(listener); };
}
