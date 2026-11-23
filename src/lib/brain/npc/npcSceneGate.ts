/**
 * npcSceneGate — tells the NPC schedulers whether anyone can see the village.
 *
 * The NPC layer boots app-wide from the loading chain, but its heartbeat
 * (8 Hz) and reproduction check only matter while a 3D Brain scene showing
 * the village is mounted and the tab is visible. On 2D pages (/index,
 * /wallet, /settings, ...) they sleep, so the village never burns
 * main-thread time off-screen.
 */

let _activeScenes = 0;

/** Mark a Brain scene as showing the NPCs. Returns the release function. */
export function retainNpcScene(): () => void {
  _activeScenes += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    _activeScenes = Math.max(0, _activeScenes - 1);
  };
}

/** True when a Brain scene is mounted and the tab is visible. */
export function isNpcSceneActive(): boolean {
  if (_activeScenes === 0) return false;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
  return true;
}

/** Test seam. */
export function _resetNpcSceneGateForTest(): void {
  _activeScenes = 0;
}
