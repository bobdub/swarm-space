/**
 * ═══════════════════════════════════════════════════════════════════════
 * EARTH — deep pin in the UQRC field
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Under UQRC there is no gravity constant, no surface spring, no clamp.
 * Earth is a *deep, anisotropic basin* baked into `pinTemplate`. The
 * operator 𝒪_UQRC re-asserts that basin every tick via L_S^pin, and
 * bodies fall toward it under Σ_μ 𝒟_μ u — gradient flow, nothing else.
 *
 * Geometry, not force. Curvature *is* gravity.
 */

export const EARTH_POSITION: [number, number, number] = [12.0, 0.0, 4.5];
export const EARTH_RADIUS = 2.0;
export const EARTH_ATMOSPHERE = 0.6;

/** Depth of the Earth basin written into pinTemplate. Deeper → steeper Σ_μ 𝒟_μ u. */
export const EARTH_PIN_AMPLITUDE = 2.4;
/** Legacy export (used by galaxy.ts to scale its earth pin). */
export const EARTH_PIN_TARGET = EARTH_PIN_AMPLITUDE;

/** djb2 string hash → uint32 deterministic. */
function hash32(s: string): number {
  let h = 5381 >>> 0;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

/**
 * Initial-condition only: place a peer at a deterministic Fibonacci-sphere
 * point on Earth's surface. After spawn, motion is governed entirely by
 * 𝒪_UQRC — there is no surface clamp.
 */
export function spawnOnEarth(peerId: string): [number, number, number] {
  const h = hash32(peerId);
  const slot = h & 0xfff;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (slot / 4095) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const phi = slot * golden;
  const sx = Math.cos(phi) * r;
  const sz = Math.sin(phi) * r;
  return [
    EARTH_POSITION[0] + sx * EARTH_RADIUS,
    EARTH_POSITION[1] + y * EARTH_RADIUS,
    EARTH_POSITION[2] + sz * EARTH_RADIUS,
  ];
}

/** Pure observation helper for the debug overlay; never used by physics. */
export function radiusFromEarth(pos: [number, number, number]): number {
  return Math.hypot(
    pos[0] - EARTH_POSITION[0],
    pos[1] - EARTH_POSITION[1],
    pos[2] - EARTH_POSITION[2],
  );
}

/** Render-only proximity test (used by visual layer to decide LOD, not physics). */
export function isOnEarth(pos: [number, number, number]): boolean {
  return radiusFromEarth(pos) <= EARTH_RADIUS + EARTH_ATMOSPHERE;
}