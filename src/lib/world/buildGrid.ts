/**
 * buildGrid — shared grid constants + snap helpers for Builder Mode v2.
 *
 * All math lives in the Earth-local tangent frame (the same frame
 * `placementController.deriveLocalFrame` registers via
 * `registerLocalSiteFrame`). Keeping the grid in tangent coords means
 * it follows Earth's curvature/spin instead of drifting in world XYZ.
 *
 * Tile pitch (`WALL_PITCH = 2.5`) matches `SurfaceBar.SEG_LEN`, so the
 * canonical hand-built bar already lies on the cell lattice and any
 * user-placed wall slot-aligns with it automatically.
 */

/** Wall segment pitch (m) — matches SurfaceBar SEG_LEN. */
export const WALL_PITCH = 2.5;
/**
 * Base cell pitch (m) along the right/forward tangent axes. Locked to
 * `WALL_PITCH` so one visible grid box equals exactly one wall length
 * and one plot cell (`landPlots.PLOT_CELL`). Asset drags therefore
 * slide along wall-length lines, and four walls enclose one 3-SWARM
 * plot box.
 */
export const CELL = WALL_PITCH;
/** Vertical snap step (m) for stacked placements. */
export const Y_STEP = 0.5;
/** Visible grid radius around the anchor (m). */
export const GRID_RADIUS = 40;

/**
 * Stable lattice-origin anchor id. The world grid's cell (0,0) is the
 * tangent-plane projection of this anchor's Earth-local normal. Any peer
 * computing `(localPos · right_ref, localPos · forward_ref)` against this
 * anchor's frame gets the same global tangent coordinates, so every
 * viewer sees lines paint on the same world cells. The choice of anchor
 * is otherwise arbitrary — it is *not* the centre of the world.
 */
export const WORLD_GRID_ORIGIN_ANCHOR = 'swarm-shared-village';

function roundTo(v: number, step: number): number {
  return Math.round(v / step) * step;
}

/** Snap an XZ point (in tangent coords) to the nearest cell centre. */
export function snapToCell(
  xz: { x: number; z: number },
  step: number = CELL,
): { x: number; z: number } {
  return { x: roundTo(xz.x, step), z: roundTo(xz.z, step) };
}

/** Snap yaw to the nearest multiple of `step` (default π/2). */
export function snapYaw(rad: number, step: number = Math.PI / 2): number {
  return roundTo(rad, step);
}

/** Snap a height value (m above the tangent plane) to `Y_STEP`. */
export function snapY(up: number, step: number = Y_STEP): number {
  return roundTo(up, step);
}