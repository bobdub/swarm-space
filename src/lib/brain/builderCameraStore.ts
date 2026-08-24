/**
 * builderCameraStore — tiny subscribable flag for the Builder Mode
 * overhead ("Top view") camera. Read per-frame by `PhysicsCameraRig`,
 * written by the Top view chip in `BrainBuilderBar`.
 *
 * Pure UI/camera state: no physics, no field, no persistence.
 */
let topView = false;
type Listener = (topView: boolean) => void;
const listeners = new Set<Listener>();

export function getBuilderTopView(): boolean {
  return topView;
}

export function setBuilderTopView(next: boolean): void {
  if (topView === next) return;
  topView = next;
  for (const l of listeners) {
    try { l(topView); } catch { /* listener crash isolated */ }
  }
}

export function toggleBuilderTopView(): void {
  setBuilderTopView(!topView);
}

export function subscribeBuilderTopView(listener: Listener): () => void {
  listeners.add(listener);
  try { listener(topView); } catch { /* noop */ }
  return () => { listeners.delete(listener); };
}

/**
 * Look-sensitivity multiplier. Top view is a precision placement mode,
 * so drag-to-look is damped hard — the camera creeps instead of jetting.
 */
export const TOP_VIEW_LOOK_SCALE = 0.3;

export function getBuilderLookScale(): number {
  return topView ? TOP_VIEW_LOOK_SCALE : 1;
}
