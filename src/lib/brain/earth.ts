/**
 * ═══════════════════════════════════════════════════════════════════════
 * EARTH — shared spawn body inside the galaxy
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Earth is a constant-position sphere ~2 m in radius, anchored as a strong
 * field pin so it cannot drift. Every arriving peer spawns on its surface
 * at a hash-derived (θ, φ) so bodies don't stack. Walking on Earth is
 * geodesic locally (intent rotated into the tangent plane) but the surface
 * itself is round — gravity is curvature pressure, not a magic constant.
 */

export const EARTH_POSITION: [number, number, number] = [12.0, 0.0, 4.5];
export const EARTH_RADIUS = 2.0;
export const EARTH_ATMOSPHERE = 0.6;        // metres above surface
export const EARTH_PIN_TARGET = 1.2;        // strong anchor pin
const EARTH_GRAVITY = 7.0;                  // radial pull when in atmosphere

/** djb2 string hash → uint32 deterministic. */
function hash32(s: string): number {
  let h = 5381 >>> 0;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

/**
 * Compute a (theta, phi) surface offset for a given peer id so peers don't
 * overlap. Uses the golden-ratio Fibonacci-sphere pattern but seeded by the
 * peer id hash so same peer → same spawn slot across reloads.
 */
export function spawnOnEarth(peerId: string): [number, number, number] {
  const h = hash32(peerId);
  const slot = h & 0xfff; // 4096 slots, plenty for sane peer counts
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (slot / 4095) * 2; // -1..1
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const phi = slot * golden;
  const sx = Math.cos(phi) * r;
  const sz = Math.sin(phi) * r;
  // Slightly above surface so the body falls onto it instead of clipping.
  const surfaceR = EARTH_RADIUS + 0.05;
  return [
    EARTH_POSITION[0] + sx * surfaceR,
    EARTH_POSITION[1] + y * surfaceR,
    EARTH_POSITION[2] + sz * surfaceR,
  ];
}

/**
 * Returns the radial force vector (fx, fy, fz) acting on a body at `pos`
 * if it is inside Earth's atmosphere; otherwise returns zeros. The force
 * pulls bodies toward the surface and pushes them outward if they sink
 * below it (so they rest at exactly r = EARTH_RADIUS).
 */
export function earthGravityForce(
  pos: [number, number, number],
): [number, number, number] {
  const dx = pos[0] - EARTH_POSITION[0];
  const dy = pos[1] - EARTH_POSITION[1];
  const dz = pos[2] - EARTH_POSITION[2];
  const r = Math.hypot(dx, dy, dz);
  if (r > EARTH_RADIUS + EARTH_ATMOSPHERE) return [0, 0, 0];
  if (r < 1e-4) return [0, EARTH_GRAVITY, 0];
  // Direction: pull inward toward surface if outside, push outward if inside.
  const surfaceDelta = r - EARTH_RADIUS;
  // Positive surfaceDelta → pull inward; negative → push outward.
  const fmag = -surfaceDelta * EARTH_GRAVITY;
  return [(dx / r) * fmag, (dy / r) * fmag, (dz / r) * fmag];
}

/**
 * Clamp a body that has clearly entered Earth back to its surface. Used
 * as a last-resort safety net; `earthGravityForce` does the heavy lifting.
 */
export function projectToEarthSurface(
  pos: [number, number, number],
): [number, number, number] {
  const dx = pos[0] - EARTH_POSITION[0];
  const dy = pos[1] - EARTH_POSITION[1];
  const dz = pos[2] - EARTH_POSITION[2];
  const r = Math.hypot(dx, dy, dz);
  if (r >= EARTH_RADIUS) return pos;
  if (r < 1e-4) return [EARTH_POSITION[0], EARTH_POSITION[1] + EARTH_RADIUS, EARTH_POSITION[2]];
  const k = EARTH_RADIUS / r;
  return [
    EARTH_POSITION[0] + dx * k,
    EARTH_POSITION[1] + dy * k,
    EARTH_POSITION[2] + dz * k,
  ];
}

/**
 * Rotate an intent vector (forward, right) — expressed in world XZ — into
 * the local tangent plane at the body's surface point. Locally this still
 * feels flat: the magnitude is preserved, only the direction is bent so
 * the body tracks the curvature instead of trying to fly off.
 */
export function geodesicStep(
  pos: [number, number, number],
  intentX: number,
  intentZ: number,
): [number, number, number] {
  const dx = pos[0] - EARTH_POSITION[0];
  const dy = pos[1] - EARTH_POSITION[1];
  const dz = pos[2] - EARTH_POSITION[2];
  const r = Math.hypot(dx, dy, dz);
  if (r > EARTH_RADIUS + EARTH_ATMOSPHERE || r < 1e-4) {
    return [intentX, 0, intentZ];
  }
  // Surface normal
  const nx = dx / r, ny = dy / r, nz = dz / r;
  // Project (intentX, 0, intentZ) onto tangent plane: v - (v·n)n
  const dot = intentX * nx + 0 * ny + intentZ * nz;
  const tx = intentX - dot * nx;
  const ty = 0 - dot * ny;
  const tz = intentZ - dot * nz;
  // Renormalise to original magnitude so locally it feels flat.
  const origMag = Math.hypot(intentX, intentZ);
  const tMag = Math.hypot(tx, ty, tz);
  if (tMag < 1e-6 || origMag < 1e-6) return [tx, ty, tz];
  const k = origMag / tMag;
  return [tx * k, ty * k, tz * k];
}

export function isOnEarth(pos: [number, number, number]): boolean {
  const dx = pos[0] - EARTH_POSITION[0];
  const dy = pos[1] - EARTH_POSITION[1];
  const dz = pos[2] - EARTH_POSITION[2];
  return Math.hypot(dx, dy, dz) <= EARTH_RADIUS + EARTH_ATMOSPHERE;
}