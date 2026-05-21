/**
 * swingFxBus — fire-and-forget event channel for visualising a tool swing
 * in the 3-D scene. The HUD/tool action publishes a single event and a
 * Canvas-side <ToolSwingFX/> subscribes to render a brief arc at the
 * swing point. Pure UI seam; no physics state lives here.
 */
export interface SwingFx {
  id: number;
  /** World-space swing point (in front of the user). */
  point: [number, number, number];
  /** Local "up" normal at the swing point (used to orient the arc). */
  up: [number, number, number];
  /** Tool colour from the prefab catalog. */
  color: string;
  /** Effective radius of the swing in world units. */
  radius: number;
  /** Physics-derived intensity (|𝒞_collide| at the swing point). */
  intensity: number;
  /** Wall-clock ms when the swing started. */
  startedAt: number;
  /** Animation lifetime ms. */
  durationMs: number;
}

let nextId = 1;
const listeners = new Set<(fx: SwingFx) => void>();

export function emitSwingFx(fx: Omit<SwingFx, 'id' | 'startedAt' | 'durationMs'> & {
  durationMs?: number;
}): SwingFx {
  const ev: SwingFx = {
    id: nextId++,
    startedAt: performance.now(),
    durationMs: fx.durationMs ?? 320,
    point: fx.point,
    up: fx.up,
    color: fx.color,
    radius: fx.radius,
    intensity: fx.intensity,
  };
  for (const fn of listeners) {
    try { fn(ev); } catch (err) { console.warn('[swingFx] listener', err); }
  }
  return ev;
}

export function subscribeSwingFx(fn: (fx: SwingFx) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}