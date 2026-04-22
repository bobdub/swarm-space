/**
 * ═══════════════════════════════════════════════════════════════════════
 * STREET — UQRC particle patch on Earth's INNER shell
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Earth is a hollow planet from the player's POV: spawn happens *inside*
 * the crust, on a small disc of land with a strip of street running
 * across it. The street is not a render-only mesh — every grid cell of
 * the patch is registered as a UQRC pin in the field, so the physics
 * sees the road exactly the way it sees galaxy stars and Earth itself.
 *
 * Frame: the street is defined in Earth-LOCAL coordinates (relative to
 * the spinning Earth). The world-space position of any street cell is
 *   world = pose.center + quatRotate(pose.spinQuat, localOffset)
 * which means the street co-rotates with Earth automatically. Inside
 * `ATMOSPHERE_SHELL` the body integrator already runs in the same
 * Earth-local frame (uqrcPhysics.ts), so a player standing on the
 * street stays put as Earth spins.
 */

import { pin3D, type Field3D } from '../uqrc/field3D';
import { EARTH_RADIUS, quatRotate, type EarthPose, type Vec3 } from './earth';
import { worldToLattice } from './uqrcPhysics';

/** Thickness of the crust between the inner street surface and the visible Earth radius. */
export const LAND_THICKNESS = 0.5;
/** Radius of the spawn cavity surface bodies stand on. */
export const INTERIOR_RADIUS = EARTH_RADIUS - LAND_THICKNESS;
/**
 * Sphere on which the avatar's *feet* rest (== the inner shell). The
 * body integrator clamps the body center to
 * `STANDING_RADIUS - HUMAN_HEIGHT/2`, so feet touch this sphere exactly.
 * The render layer (StreetMesh) and the UQRC pin grid both live on this
 * sphere too — render and physics agree on "ground".
 *
 * NOTE: Equal to INTERIOR_RADIUS by construction; kept as its own export
 * so render/physics/spawn/test code reads the same intent everywhere.
 * `HUMAN_HEIGHT` is referenced so the constant is recomputed if either
 * `INTERIOR_RADIUS` or the standing model changes.
 */
export const STANDING_RADIUS = INTERIOR_RADIUS;
/** Length of the street strip (sim units). */
export const STREET_LENGTH = 12;
/** Width of the street strip. */
export const STREET_WIDTH = 3;
/** Radius of the surrounding land disc. */
export const LAND_RADIUS = 6;
/** Mass written per street cell into the UQRC pin field. */
export const STREET_CELL_MASS = 0.18;
/** Spacing between pinned street/land cells (sim units). */
export const STREET_CELL_SPACING = 0.75;

export interface StreetParticle {
  /** Earth-local position (before spin). */
  local: Vec3;
  mass: number;
  kind: 'road' | 'land';
}

export interface StreetPatch {
  /** Earth-local center of the patch (on the inner shell). */
  centerLocal: Vec3;
  /** Earth-local outward normal at the center (unit). */
  normalLocal: Vec3;
  /** Earth-local tangent along the street's long axis (unit). */
  tangentLocal: Vec3;
  /** Earth-local tangent perpendicular to the street (unit). */
  bitangentLocal: Vec3;
  particles: StreetParticle[];
}

function normalize(v: Vec3): Vec3 {
  const r = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / r, v[1] / r, v[2] / r];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Build the street patch (pure / deterministic). */
export function buildStreet(): StreetPatch {
  // Anchor along Earth-local +Y so spawn is near the spin axis (least
  // co-rotational sliding). Slight tilt for a more interesting view.
  const normalLocal: Vec3 = normalize([0.15, 1, 0.05]);
  const centerLocal: Vec3 = [
    normalLocal[0] * STANDING_RADIUS,
    normalLocal[1] * STANDING_RADIUS,
    normalLocal[2] * STANDING_RADIUS,
  ];
  const ref: Vec3 = Math.abs(normalLocal[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
  const tangentLocal = normalize(cross(ref, normalLocal));
  const bitangentLocal = normalize(cross(normalLocal, tangentLocal));

  const particles: StreetParticle[] = [];
  const half = LAND_RADIUS;
  const step = STREET_CELL_SPACING;
  for (let u = -half; u <= half; u += step) {
    for (let v = -half; v <= half; v += step) {
      if (u * u + v * v > half * half) continue;
      const onRoad = Math.abs(v) <= STREET_WIDTH / 2 && Math.abs(u) <= STREET_LENGTH / 2;
      const local: Vec3 = [
        centerLocal[0] + tangentLocal[0] * u + bitangentLocal[0] * v,
        centerLocal[1] + tangentLocal[1] * u + bitangentLocal[1] * v,
        centerLocal[2] + tangentLocal[2] * u + bitangentLocal[2] * v,
      ];
      // Project the offset point onto the STANDING sphere so the rendered
      // patch and the UQRC pin grid coincide with the body integrator's
      // clamp surface (= where feet actually rest).
      const r = Math.hypot(local[0], local[1], local[2]) || 1;
      const k = STANDING_RADIUS / r;
      particles.push({
        local: [local[0] * k, local[1] * k, local[2] * k],
        mass: STREET_CELL_MASS * (onRoad ? 1.0 : 0.6),
        kind: onRoad ? 'road' : 'land',
      });
    }
  }
  return { centerLocal, normalLocal, tangentLocal, bitangentLocal, particles };
}

/** Convert an Earth-local coordinate to world space using the live pose. */
export function streetLocalToWorld(local: Vec3, pose: EarthPose): Vec3 {
  const r = quatRotate(pose.spinQuat, local);
  return [pose.center[0] + r[0], pose.center[1] + r[1], pose.center[2] + r[2]];
}

/** Register every street particle as a UQRC pin in the field. */
export function registerStreetParticles(
  field: Field3D,
  street: StreetPatch,
  pose: EarthPose,
): void {
  const N = field.N;
  for (const p of street.particles) {
    const w = streetLocalToWorld(p.local, pose);
    const i = Math.round(worldToLattice(w[0], N));
    const j = Math.round(worldToLattice(w[1], N));
    const k = Math.round(worldToLattice(w[2], N));
    pin3D(field, 0, i, j, k, p.mass);
  }
}

/** Project an arbitrary world-space position onto the inner shell. */
export function projectToStreet(posWorld: Vec3, pose: EarthPose): Vec3 {
  const dx = posWorld[0] - pose.center[0];
  const dy = posWorld[1] - pose.center[1];
  const dz = posWorld[2] - pose.center[2];
  const r = Math.hypot(dx, dy, dz) || 1;
  const k = STANDING_RADIUS / r;
  return [
    pose.center[0] + dx * k,
    pose.center[1] + dy * k,
    pose.center[2] + dz * k,
  ];
}

let _street: StreetPatch | null = null;
export function getStreet(): StreetPatch {
  if (!_street) _street = buildStreet();
  return _street;
}
export function resetStreetForTests(): void {
  _street = null;
}
