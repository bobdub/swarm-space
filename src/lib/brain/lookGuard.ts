/**
 * Mark on any HUD element whose own drags and clicks must not turn the
 * camera: floating windows (mini map, Global Chat, live dock, shared
 * screens), joysticks and the like. Spread it onto the element's root.
 */
export const NO_LOOK = { 'data-no-look': 'true' } as const;

/**
 * True when a press on `target` belongs to the HUD, not the 3D view, so
 * the drag-to-look overlays (mouse and touch) leave the camera alone.
 */
export function blocksLook(target: EventTarget | null): boolean {
  const node = target instanceof Element ? target : null;
  return !!node?.closest('button, a, input, textarea, select, [role="button"], [data-no-look="true"]');
}
