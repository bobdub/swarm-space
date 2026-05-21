/**
 * swingFxBus — fire-and-forget event channel for visualising a tool swing
 * in the 3-D scene. The HUD/tool action publishes a single event and a
 * Canvas-side <ToolSwingFX/> subscribes to render a brief arc at the
 * swing point. Pure UI seam; no physics state lives here.
 */
export interface SwingFx {
  id: number;
  /** Visual mode — broad swing arc or a target impact marker. */
  variant: 'swing' | 'impact';
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
  /** Optional world-space text badge rendered at the event point. */
  label?: string;
  /** Optional outcome bit so impact markers can read as success/failure. */
  success?: boolean;
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
    variant: fx.variant,
    startedAt: performance.now(),
    durationMs: fx.durationMs ?? 320,
    point: fx.point,
    up: fx.up,
    color: fx.color,
    radius: fx.radius,
    intensity: fx.intensity,
    label: fx.label,
    success: fx.success,
  };
  for (const fn of listeners) {
    try { fn(ev); } catch (err) { console.warn('[swingFx] listener', err); }
  }
  return ev;
}

export function emitImpactFx(fx: Omit<SwingFx, 'id' | 'startedAt' | 'durationMs' | 'variant'> & {
  durationMs?: number;
}): SwingFx {
  return emitSwingFx({
    ...fx,
    variant: 'impact',
    durationMs: fx.durationMs ?? 760,
  });
}

export function subscribeSwingFx(fn: (fx: SwingFx) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}