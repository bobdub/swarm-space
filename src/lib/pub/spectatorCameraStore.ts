/**
 * spectatorCameraStore — overhead "look down on the table" camera.
 *
 * Purely a camera mode: the body never moves, so seating, physics and
 * presence are untouched. Used to confirm at a glance that every avatar
 * is on a stool and that the tabletop is readable from above.
 */

let overhead = false;
let debug = false;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => { try { l(); } catch { /* ignore */ } });
}

export const SPECTATOR_UP_M = 7;
export const SPECTATOR_BACK_M = 4;

export function subscribeSpectator(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function isOverheadView(): boolean { return overhead; }
export function setOverheadView(next: boolean): void {
  if (overhead === next) return;
  overhead = next;
  emit();
}
export function toggleOverheadView(): void { setOverheadView(!overhead); }

export function isSeatDebugOn(): boolean { return debug; }
export function toggleSeatDebug(): void { debug = !debug; emit(); }
