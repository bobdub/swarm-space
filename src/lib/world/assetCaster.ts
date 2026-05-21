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

export interface GhostBox { kind: 'box'; w: number; h: number; d: number; color: string }
export interface GhostRing { kind: 'ring'; color: string }
export type Ghost = GhostBox | GhostRing;

export interface PendingCast {
  kind: CastKind;
  /** Human-readable hint shown while casting. */
  label?: string;
  /** Opaque payload returned to the handler. */
  payload?: unknown;
  /** Visual ghost rendered at hitPoint while positioning. */
  ghost: Ghost;
  /** Live ghost world-space position (seeded from camera-forward on arm,
   *  updated as the user drags across the planet shell). */
  hitPoint: Vec3 | null;
  /** Yaw rotation (radians) around the surface normal. */
  yaw: number;
  /** Commit handler — runs when the user presses Confirm. */
  onConfirm: (hitPoint: Vec3, yaw: number, payload: unknown) => void;
  /** Optional discard handler — runs when the user presses Cancel. */
  onCancel?: () => void;
}

type Listener = (cast: PendingCast | null) => void;

let pending: PendingCast | null = null;
const listeners = new Set<Listener>();

export function getPendingCast(): PendingCast | null {
  return pending;
}

export function setPendingCast(cast: Omit<PendingCast, 'yaw'> & { yaw?: number } | null): void {
  pending = cast ? { yaw: 0, ...cast } : null;
  for (const l of listeners) {
    try { l(pending); } catch { /* listener crash isolated */ }
  }
}

export function clearPendingCast(): void {
  const cur = pending;
  pending = null;
  for (const l of listeners) {
    try { l(null); } catch { /* noop */ }
  }
  if (cur?.onCancel) {
    try { cur.onCancel(); } catch { /* noop */ }
  }
}

/** Update the live ghost position without committing. */
export function updateCastHit(hit: Vec3): void {
  if (!pending) return;
  pending = { ...pending, hitPoint: hit };
  for (const l of listeners) {
    try { l(pending); } catch { /* noop */ }
  }
}

/**
 * Update the live ghost position WITHOUT notifying listeners. Used by the
 * frame loop to keep `hitPoint` synced to Earth's spin (so a committed
 * placement uses the world point under the ghost *right now*) while
 * avoiding per-frame React re-renders.
 */
export function setCastHitSilent(hit: Vec3): void {
  if (!pending) return;
  pending.hitPoint = hit;
}

/** Adjust ghost yaw (radians). Notifies listeners so HUD reflects state. */
export function rotateCast(delta: number): void {
  if (!pending) return;
  pending = { ...pending, yaw: (pending.yaw ?? 0) + delta };
  for (const l of listeners) {
    try { l(pending); } catch { /* noop */ }
  }
}

/** Commit the placement at the current hitPoint. No-op if not positioned. */
export function confirmCast(): void {
  const cur = pending;
  if (!cur || !cur.hitPoint) return;
  const hit = cur.hitPoint;
  const yaw = cur.yaw ?? 0;
  pending = null;
  for (const l of listeners) {
    try { l(null); } catch { /* noop */ }
  }
  try { cur.onConfirm(hit, yaw, cur.payload); } catch (err) { console.warn('[cast] onConfirm threw', err); }
}

export function subscribeCast(listener: Listener): () => void {
  listeners.add(listener);
  // prime with current state for late subscribers
  try { listener(pending); } catch { /* noop */ }
  return () => { listeners.delete(listener); };
}
