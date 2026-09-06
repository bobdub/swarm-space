/**
 * cameraViewStore — which camera the Brain is looking through.
 *
 *   'third' — over-the-shoulder boom (default everywhere in the Brain)
 *   'first' — close-up first person
 *   'top'   — the existing overhead builder view
 *
 * Sits alongside `builderCameraStore`, which stays the single flag the
 * grid/ghost snapping code reads for "am I in Top view?". This store is
 * the authority: writing `'top'` here mirrors into `setBuilderTopView`,
 * and leaving `'top'` clears it.
 *
 * Pure UI/camera state — no physics, no field, no persistence.
 */
import { setBuilderTopView } from '@/lib/brain/builderCameraStore';

export type CameraView = 'third' | 'first' | 'top';

let view: CameraView = 'third';
/** Remembered ground view so leaving Top view returns where you were. */
let lastGroundView: Exclude<CameraView, 'top'> = 'third';

type Listener = (view: CameraView) => void;
const listeners = new Set<Listener>();

export function getCameraView(): CameraView {
  return view;
}

export function setCameraView(next: CameraView): void {
  if (view === next) return;
  view = next;
  if (next !== 'top') lastGroundView = next;
  setBuilderTopView(next === 'top');
  for (const l of listeners) {
    try { l(view); } catch { /* listener crash isolated */ }
  }
}

/** `V` key / view button: flip between over-the-shoulder and first person. */
export function toggleShoulderView(): void {
  setCameraView(view === 'first' ? 'third' : 'first');
}

/** Top view chip: enter overhead, or fall back to the previous ground view. */
export function toggleTopView(): void {
  setCameraView(view === 'top' ? lastGroundView : 'top');
}

export function subscribeCameraView(listener: Listener): () => void {
  listeners.add(listener);
  try { listener(view); } catch { /* noop */ }
  return () => { listeners.delete(listener); };
}

/** Boom geometry for the over-the-shoulder rig, metres. */
export const THIRD_PERSON_BACK_M = 4.5;
export const THIRD_PERSON_UP_M = 2.2;
