/**
 * npcSceneGate — tells the NPC schedulers whether anyone can see the village.
 *
 * The NPC layer boots app-wide from the loading chain, but its heartbeat
 * (8 Hz) and reproduction check only matter while a 3D Brain scene showing
 * the village is mounted, the tab is visible and the viewer is near the
 * village. On 2D pages (/index, /wallet, /settings, ...) and while the
 * viewer is off exploring elsewhere on the planet they sleep, so the
 * village never burns main-thread time nobody can see.
 */

let _activeScenes = 0;
/** Whether the viewer's camera is within reach of the village. */
let _viewerNear = true;

/** Wake the village within this arc distance (m) of its centre. */
export const NPC_WAKE_RADIUS_M = 300;
/** ...and let it sleep again only past this one, so it doesn't flicker. */
export const NPC_SLEEP_RADIUS_M = 360;

/**
 * Feed the viewer's arc distance (m) from the village centre. Uses a
 * hysteresis band so standing on the edge doesn't toggle every second.
 */
export function reportNpcViewerDistance(metres: number): void {
  if (!Number.isFinite(metres)) return;
  if (_viewerNear && metres > NPC_SLEEP_RADIUS_M) _viewerNear = false;
  else if (!_viewerNear && metres < NPC_WAKE_RADIUS_M) _viewerNear = true;
}

/** Mark a Brain scene as showing the NPCs. Returns the release function. */
export function retainNpcScene(): () => void {
  _activeScenes += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    _activeScenes = Math.max(0, _activeScenes - 1);
    if (_activeScenes === 0) _viewerNear = true;
  };
}

/** True when a Brain scene is mounted, the tab is visible and the viewer is near. */
export function isNpcSceneActive(): boolean {
  if (_activeScenes === 0) return false;
  if (!_viewerNear) return false;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
  return true;
}

/** Test seam. */
export function _resetNpcSceneGateForTest(): void {
  _activeScenes = 0;
  _viewerNear = true;
}
