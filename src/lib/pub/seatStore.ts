/**
 * seatStore — "take a seat" state for pub furniture.
 *
 * Sitting only changes the camera: the eye rises a little and the view
 * pitches down so the tabletop is actually readable. The avatar body
 * keeps its normal physics — no new locomotion mode, no new bodies.
 */

export interface PubSeatPose {
  /** Extra metres added to EYE_LIFT while seated. */
  lift: number;
  /** Desired view pitch in radians, applied once on sit down. */
  pitch: number | null;
  /** Bumps every sit/stand so the render loop knows to re-apply pitch. */
  nonce: number;
}

let pose: PubSeatPose = { lift: 0, pitch: null, nonce: 0 };
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => { try { l(); } catch { /* ignore */ } });
}

export function subscribeSeat(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function getSeatPose(): PubSeatPose {
  return pose;
}

export function getSeatLift(): number {
  return pose.lift;
}

/** Sit down. `lift` is extra eye height, `pitch` a downward view angle. */
export function sitDown(lift = 0.3, pitch = -0.45): void {
  pose = { lift, pitch, nonce: pose.nonce + 1 };
  emit();
}

export function standUp(): void {
  if (pose.lift === 0 && pose.pitch === null) return;
  pose = { lift: 0, pitch: null, nonce: pose.nonce + 1 };
  emit();
}
