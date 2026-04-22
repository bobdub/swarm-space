/**
 * ═══════════════════════════════════════════════════════════════════════
 * EARTH — deep, *co-moving* pin in the UQRC field
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Under UQRC there is no gravity constant, no surface spring, no clamp.
 * Earth is a *deep, anisotropic basin* baked into `pinTemplate`. The
 * operator 𝒪_UQRC re-asserts that basin every tick via L_S^pin, and
 * bodies fall toward it under Σ_μ 𝒟_μ u — gradient flow, nothing else.
 *
 * Geometry, not force. Curvature *is* gravity.
 *
 * The basin is *non-stationary*: Earth orbits the galactic core and spins
 * on its own axis. Every animation tick `updateEarthPin(field, pose)`
 * clears the previous-tick Earth cells and rewrites the radial basin at
 * the *live* center. Bodies inside the atmosphere shell integrate in
 * Earth-local coords (see uqrcPhysics.ts) so a foot pinned to the surface
 * stays pinned even as the planet rotates underneath the world frame.
 */

import { writePinTemplate, idx3, FIELD3D_AXES, type Field3D } from '../uqrc/field3D';
import { worldToLattice } from './uqrcPhysics';

export const EARTH_POSITION: [number, number, number] = [12.0, 0.0, 4.5];
export const EARTH_RADIUS = 2.0;
export const EARTH_ATMOSPHERE = 0.6;

/**
 * Single source of truth for the Sun's world-space position. Both the
 * scene's <pointLight>, the Earth/Moon shader `uSunPos` uniforms, and
 * the daylight-biased spawn logic import this constant so they can never
 * disagree about which hemisphere is lit.
 */
export const SUN_POSITION: [number, number, number] = [60, 40, 30];

/** Outer boundary of Earth's atmosphere (used later for "leave atmosphere → space flight"). */
export const ATMOSPHERE_RADIUS = EARTH_RADIUS * 1.08;
export function getAtmosphereRadius(): number { return ATMOSPHERE_RADIUS; }

/** Height of a standing humanoid body (metres, sim units). Feet at surface, head ~1.7m up. */
export const HUMAN_HEIGHT = 1.7;
/** Vertical offset of the feet relative to the body anchor. 0 = anchor sits at surface. */
export const FEET_OFFSET = 0;

/** Depth of the Earth basin written into pinTemplate. Deeper → steeper Σ_μ 𝒟_μ u. */
export const EARTH_PIN_AMPLITUDE = 2.4;
/** Legacy export (used by galaxy.ts to scale its earth pin). */
export const EARTH_PIN_TARGET = EARTH_PIN_AMPLITUDE;

/** Earth's rotational period (seconds, sim time). 60 s = visibly rotating. */
export const EARTH_SPIN_PERIOD = 60;
/** Earth's orbital radius around the galactic core (galaxy.ts core sits at 0,0,0). */
export const EARTH_ORBIT_RADIUS = Math.hypot(EARTH_POSITION[0], EARTH_POSITION[2]);
/** Orbital period (seconds, sim time). Long enough that bodies settle within one revolution. */
export const EARTH_ORBIT_PERIOD = 600;
/** Initial orbital phase derived from EARTH_POSITION so spawn==boot is continuous. */
const EARTH_ORBIT_PHASE_0 = Math.atan2(EARTH_POSITION[2], EARTH_POSITION[0]);

/** djb2 string hash → uint32 deterministic. */
function hash32(s: string): number {
  let h = 5381 >>> 0;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

// ── Pose ────────────────────────────────────────────────────────────────

export type Vec3 = [number, number, number];
/** Quaternion as [x, y, z, w] — spin around world Y axis. */
export type Quat = [number, number, number, number];

export interface EarthPose {
  center: Vec3;
  spinQuat: Quat;     // rotation Earth-local → world
  invSpinQuat: Quat;  // rotation world → Earth-local (conjugate)
  spinAngle: number;  // radians, for debug / shader sync
  orbitPhase: number;
}

let _poseTime = 0; // seconds elapsed since boot; advanced by setEarthPoseTime

/** Advance the pose clock. Called from the BrainUniverse animation loop. */
export function setEarthPoseTime(seconds: number): void {
  _poseTime = Number.isFinite(seconds) ? seconds : 0;
}

/** Build a Y-axis quaternion from an angle. */
function quatY(angle: number): Quat {
  const half = angle * 0.5;
  return [0, Math.sin(half), 0, Math.cos(half)];
}

function quatConjugate(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

/** Apply quaternion q to vector v: q · v · q⁻¹. */
export function quatRotate(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}

/** Live Earth pose (center + spin) at the current pose time. */
export function getEarthPose(): EarthPose {
  const t = _poseTime;
  const orbitPhase = EARTH_ORBIT_PHASE_0 + (t / EARTH_ORBIT_PERIOD) * Math.PI * 2;
  const spinAngle = (t / EARTH_SPIN_PERIOD) * Math.PI * 2;
  const center: Vec3 = [
    Math.cos(orbitPhase) * EARTH_ORBIT_RADIUS,
    EARTH_POSITION[1],
    Math.sin(orbitPhase) * EARTH_ORBIT_RADIUS,
  ];
  const spinQuat = quatY(spinAngle);
  const invSpinQuat = quatConjugate(spinQuat);
  return { center, spinQuat, invSpinQuat, spinAngle, orbitPhase };
}

// ── Pin writer (per-tick, co-moving) ────────────────────────────────────

/** Cells written by the previous updateEarthPin call — cleared before the next write. */
const _lastPinFlats = new Set<number>();

/**
 * Rewrite Earth's radial basin into pinTemplate at the live `pose.center`.
 * Idempotent: previous-tick Earth cells are cleared first, so the basin
 * tracks Earth as it orbits. The basin shape is rotationally symmetric
 * (radial), so spin doesn't change pinTemplate values — only the center
 * moves. Spin is applied to *bodies* via the co-rotating frame in
 * uqrcPhysics.ts.
 */
export function updateEarthPin(field: Field3D, pose: EarthPose): void {
  const N = field.N;
  if (_lastPinFlats.size > 0) {
    for (const flat of _lastPinFlats) {
      for (let a = 0; a < FIELD3D_AXES; a++) {
        field.pinTemplate[a][flat] = 0;
        field.pinMask[a][flat] = 0;
      }
    }
    _lastPinFlats.clear();
  }

  const stamp = Math.max(1, Math.ceil(EARTH_RADIUS));
  const ei = Math.round(worldToLattice(pose.center[0], N));
  const ej = Math.round(worldToLattice(pose.center[1], N));
  const ek = Math.round(worldToLattice(pose.center[2], N));

  for (let dk = -stamp; dk <= stamp; dk++) {
    for (let dj = -stamp; dj <= stamp; dj++) {
      for (let di = -stamp; di <= stamp; di++) {
        const d2 = di * di + dj * dj + dk * dk;
        const d = Math.sqrt(d2);
        if (d > stamp + 0.5) continue;
        const depth = -EARTH_PIN_AMPLITUDE * Math.exp(-d2 / (stamp * stamp));
        const flat = idx3(ei + di, ej + dj, ek + dk, N);
        for (let a = 0; a < FIELD3D_AXES; a++) {
          const axisVec = a === 0 ? di : a === 1 ? dj : dk;
          const bias = depth * (d > 0 ? axisVec / d : 0);
          writePinTemplate(field, a, flat, bias);
        }
        _lastPinFlats.add(flat);
      }
    }
  }
}

// ── Avatar mass ─────────────────────────────────────────────────────────

/** Default avatar masses. Heavier ⇒ slower, harder to fly off the surface. */
export const AVATAR_MASS: Record<string, number> = {
  rabbit: 1.0,
  human: 1.8,
  heavy: 2.6,
};
export const DEFAULT_AVATAR_MASS = 1.8;

export function getAvatarMass(avatarKind?: string | null): number {
  if (!avatarKind) return DEFAULT_AVATAR_MASS;
  return AVATAR_MASS[avatarKind] ?? DEFAULT_AVATAR_MASS;
}

/**
 * Initial-condition only: place a peer at a deterministic Fibonacci-sphere
 * point on Earth's surface. If a `pose` is supplied the spawn is taken in
 * the *live* Earth frame (slot in Earth-local coords, then rotated by the
 * spin quaternion and offset by the live center) so the body lands on the
 * surface at any wall-clock time, not just t=0.
 */
export function spawnOnEarth(peerId: string, pose?: EarthPose): [number, number, number] {
  const h = hash32(peerId);
  // djb2 of short similar strings ("peer-15", "peer-16") barely changes
  // the high bits, which would cluster every test peer in the same θ.
  // A second salted pass + cheap xorshift mix decorrelates θ and φ so
  // sequential ids spread evenly across the lit hemisphere.
  const mix = (n: number): number => {
    let x = n >>> 0;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17; x >>>= 0;
    x ^= x << 5;  x >>>= 0;
    return x;
  };
  const hMixed = mix(h);
  const h2 = mix(hash32(`${peerId}\u0001sun-bias`));
  // ── Daylight-biased spawn ───────────────────────────────────────────
  // Pick a point on the lit hemisphere: rotate around the subsolar axis
  // by a hash-derived angle θ ∈ [0, 2π), then tilt away from it by a
  // zenith offset φ ∈ [10°, 60°] (mid-morning .. mid-afternoon — never
  // at the subsolar pole, never at the day/night terminator). The result
  // is a unit surface normal in WORLD space that always faces the Sun
  // with comfortable margin.
  const center: Vec3 = pose ? pose.center : EARTH_POSITION;
  const sx0 = SUN_POSITION[0] - center[0];
  const sy0 = SUN_POSITION[1] - center[1];
  const sz0 = SUN_POSITION[2] - center[2];
  const sLen = Math.hypot(sx0, sy0, sz0) || 1;
  const sun: Vec3 = [sx0 / sLen, sy0 / sLen, sz0 / sLen];
  // Build an orthonormal basis (sun, e1, e2) so we can parameterise the
  // spawn cone around the subsolar direction.
  const ref: Vec3 = Math.abs(sun[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
  let e1x = ref[1] * sun[2] - ref[2] * sun[1];
  let e1y = ref[2] * sun[0] - ref[0] * sun[2];
  let e1z = ref[0] * sun[1] - ref[1] * sun[0];
  const e1n = Math.hypot(e1x, e1y, e1z) || 1;
  e1x /= e1n; e1y /= e1n; e1z /= e1n;
  const e2x = sun[1] * e1z - sun[2] * e1y;
  const e2y = sun[2] * e1x - sun[0] * e1z;
  const e2z = sun[0] * e1y - sun[1] * e1x;
  // Hash → (θ, φ). Two independent salted+mixed hashes.
  const theta = (hMixed / 0x100000000) * Math.PI * 2;
  const phiMin = (10 * Math.PI) / 180;
  const phiMax = (60 * Math.PI) / 180;
  const phi = phiMin + (h2 / 0x100000000) * (phiMax - phiMin);
  const cp = Math.cos(phi), sp = Math.sin(phi);
  const ct = Math.cos(theta), st = Math.sin(theta);
  // World-space unit surface normal at the spawn point.
  const nx = sun[0] * cp + (e1x * ct + e2x * st) * sp;
  const ny = sun[1] * cp + (e1y * ct + e2y * st) * sp;
  const nz = sun[2] * cp + (e1z * ct + e2z * st) * sp;
  // Body center sits at EARTH_RADIUS + HUMAN_HEIGHT/2 so feet land on
  // the surface and the head is ~1.7m up.
  const standR = EARTH_RADIUS + HUMAN_HEIGHT / 2;
  return [
    center[0] + nx * standR,
    center[1] + ny * standR,
    center[2] + nz * standR,
  ];
}

/**
 * Orthonormal surface frame at `pos` relative to Earth's live `pose`.
 * `up` is the outward surface normal; `forward` and `right` are tangent to
 * the sphere. Used by camera and avatar orientation so renders stand
 * upright on the curved surface instead of in world space.
 */
export function getSurfaceFrame(
  pos: [number, number, number],
  pose: EarthPose = getEarthPose(),
): { up: Vec3; forward: Vec3; right: Vec3 } {
  const dx = pos[0] - pose.center[0];
  const dy = pos[1] - pose.center[1];
  const dz = pos[2] - pose.center[2];
  const r = Math.hypot(dx, dy, dz) || 1;
  const up: Vec3 = [dx / r, dy / r, dz / r];
  // Pick a stable reference axis that isn't parallel to `up`.
  const ref: Vec3 = Math.abs(up[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
  // right = normalize(ref × up)
  let rx = ref[1] * up[2] - ref[2] * up[1];
  let ry = ref[2] * up[0] - ref[0] * up[2];
  let rz = ref[0] * up[1] - ref[1] * up[0];
  const rn = Math.hypot(rx, ry, rz) || 1;
  rx /= rn; ry /= rn; rz /= rn;
  // forward = up × right
  const fx = up[1] * rz - up[2] * ry;
  const fy = up[2] * rx - up[0] * rz;
  const fz = up[0] * ry - up[1] * rx;
  return { up, forward: [fx, fy, fz], right: [rx, ry, rz] };
}

/**
 * Hard kinematic clamp: ensure `pos` lies within the surface shell
 * `[EARTH_RADIUS, EARTH_RADIUS + HUMAN_HEIGHT]` around the live Earth pose.
 * Returns the clamped position and a flag indicating whether the radial
 * component had to be adjusted (callers should zero the radial velocity in
 * that case). Tangential motion is preserved.
 */
export function clampToEarthSurface(
  pos: [number, number, number],
  pose: EarthPose = getEarthPose(),
): { pos: [number, number, number]; clamped: boolean } {
  const dx = pos[0] - pose.center[0];
  const dy = pos[1] - pose.center[1];
  const dz = pos[2] - pose.center[2];
  const r = Math.hypot(dx, dy, dz);
  const minR = EARTH_RADIUS;
  const maxR = EARTH_RADIUS + HUMAN_HEIGHT;
  if (r >= minR && r <= maxR) return { pos, clamped: false };
  if (r < 1e-6) {
    return {
      pos: [pose.center[0], pose.center[1] + minR, pose.center[2]],
      clamped: true,
    };
  }
  const target = r < minR ? minR + HUMAN_HEIGHT / 2 : maxR;
  const k = target / r;
  return {
    pos: [
      pose.center[0] + dx * k,
      pose.center[1] + dy * k,
      pose.center[2] + dz * k,
    ],
    clamped: true,
  };
}

/**
 * Project any world-space point onto the live Earth surface with a small
 * optional altitude offset. Useful for boot-time anchoring when a body or
 * camera should begin visibly on the planet even before the basin settles it.
 */
/** Pure observation helper for the debug overlay; never used by physics.
 * If a pose is given, measures from the live center; otherwise from the
 * spawn-time anchor. */
export function radiusFromEarth(pos: [number, number, number], pose?: EarthPose): number {
  const c = pose ? pose.center : EARTH_POSITION;
  return Math.hypot(pos[0] - c[0], pos[1] - c[1], pos[2] - c[2]);
}

/** Render-only proximity test (used by visual layer to decide LOD, not physics). */
export function isOnEarth(pos: [number, number, number], pose?: EarthPose): boolean {
  return radiusFromEarth(pos, pose) <= EARTH_RADIUS + EARTH_ATMOSPHERE;
}
