/**
 * landOverlayStore — "Show land" toggle for the surface plot markers.
 *
 * Markers are ON by default so ownership is always legible while
 * walking, not just while building.
 */
const KEY = 'brain-show-land-markers-v1';
let show = (() => {
  try {
    if (typeof localStorage === 'undefined') return true;
    const raw = localStorage.getItem(KEY);
    return raw == null ? true : raw === '1';
  } catch { return true; }
})();

const listeners = new Set<(v: boolean) => void>();

export function getShowLandMarkers(): boolean { return show; }

export function setShowLandMarkers(next: boolean): void {
  show = next;
  try { localStorage.setItem(KEY, next ? '1' : '0'); } catch { /* ignore */ }
  for (const fn of listeners) { try { fn(show); } catch { /* ignore */ } }
}

export function toggleShowLandMarkers(): void { setShowLandMarkers(!show); }

export function subscribeShowLandMarkers(fn: (v: boolean) => void): () => void {
  listeners.add(fn);
  fn(show);
  return () => { listeners.delete(fn); };
}
