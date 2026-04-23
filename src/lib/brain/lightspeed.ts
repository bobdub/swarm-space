/**
 * ═══════════════════════════════════════════════════════════════════════
 * 𝒞_light — Causal Conversion Operator
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   𝒞_light(Δt) := c · Δt              (time → length)
 *   ℓ_min       = 𝒞_light(Δt_min)      (closure: lattice cell = c · tick)
 *
 * Pure observer. Fires Sun → Earth.surface → Sun through the live field
 * and reports how much extra time the round-trip takes versus a Euclidean
 * baseline. Field potential |u(x)| acts as a refractive index:
 *
 *   n(x) := 1 + κ · |u(x)|
 *   Δt_actual = Σ_segments  ds · n(x) / c
 *   delay     = Δt_actual − 2·|ray|/c
 *
 * delay > 0  ⇒  the surface basin pulls light, i.e. there is real
 *               geometric pull at the Earth surface.
 * delay ≈ 0  ⇒  field is flat at the surface, bodies will float.
 *
 * Never writes to the field. Never decides. Diagnostic only.
 */
import { sample3D, FIELD3D_N, FIELD3D_AXES, type Field3D } from '../uqrc/field3D';
import { EARTH_RADIUS, SUN_POSITION, getEarthPose, type EarthPose } from './earth';

// NOTE: constants are duplicated from uqrcPhysics.ts on purpose — importing
// from there creates a circular dependency (uqrcPhysics imports lightspeed
// for the probe). Keep these two values in lock-step with uqrcPhysics.
const WORLD_SIZE_LOCAL = 60 * 212.5; // 12 750 m  ↔ uqrcPhysics.WORLD_SIZE
const PHYSICS_HZ_LOCAL = 60;         //           ↔ uqrcPhysics.PHYSICS_HZ

/** Sim-unit lattice spacing — one cell on the 3-D torus. */
export const LATTICE_CELL = WORLD_SIZE_LOCAL / FIELD3D_N;
/** Sim-unit physics tick interval. */
export const TICK_DT = 1 / PHYSICS_HZ_LOCAL;
/** Closure relation: 𝒞_light(Δt_min) = ℓ_min  ⇒  c = ℓ_min / Δt_min. */
export const C_LIGHT = LATTICE_CELL / TICK_DT;

/** κ — coupling between field potential and refractive index.
 *  κ=1 makes a unit-magnitude pin double the optical path. */
const KAPPA = 1.0;

/** 𝒞_light: temporal interval → spatial displacement. */
export function causalConvert(dt: number): number {
  return C_LIGHT * dt;
}

function worldToLat(p: number, N: number): number {
  return ((p / WORLD_SIZE_LOCAL + 0.5) * N + N) % N;
}

/** Aggregate scalar field potential at a world coord — averaged across axes. */
export function sampleFieldPotential(field: Field3D, x: [number, number, number]): number {
  const N = field.N;
  const lx = worldToLat(x[0], N);
  const ly = worldToLat(x[1], N);
  const lz = worldToLat(x[2], N);
  let sum = 0;
  for (let a = 0; a < FIELD3D_AXES; a++) sum += sample3D(field, a, lx, ly, lz);
  return sum / FIELD3D_AXES;
}

/** n(x) := 1 + κ · |u(x)| */
export function refractiveIndex(field: Field3D, x: [number, number, number]): number {
  return 1 + KAPPA * Math.abs(sampleFieldPotential(field, x));
}

/** ‖∇u‖ at a world coord — magnitude of the field gradient (informational). */
export function gradientMagnitude(field: Field3D, x: [number, number, number]): number {
  const h = LATTICE_CELL * 0.5;
  let gx = 0, gy = 0, gz = 0;
  for (const sign of [1, -1] as const) {
    void sign;
  }
  const px = sampleFieldPotential(field, [x[0] + h, x[1], x[2]]);
  const mx = sampleFieldPotential(field, [x[0] - h, x[1], x[2]]);
  const py = sampleFieldPotential(field, [x[0], x[1] + h, x[2]]);
  const my = sampleFieldPotential(field, [x[0], x[1] - h, x[2]]);
  const pz = sampleFieldPotential(field, [x[0], x[1], x[2] + h]);
  const mz = sampleFieldPotential(field, [x[0], x[1], x[2] - h]);
  gx = (px - mx) / (2 * h);
  gy = (py - my) / (2 * h);
  gz = (pz - mz) / (2 * h);
  return Math.hypot(gx, gy, gz);
}

/** Trace a single causal ray from→to, integrating ds·n(x)/c over `samples` segments. */
export function traceCausalRay(
  field: Field3D,
  from: [number, number, number],
  to: [number, number, number],
  samples: number = 64,
): { length: number; actualDt: number } {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const length = Math.hypot(dx, dy, dz);
  const ds = length / samples;
  let actualDt = 0;
  for (let i = 0; i < samples; i++) {
    const t = (i + 0.5) / samples;
    const x: [number, number, number] = [
      from[0] + dx * t,
      from[1] + dy * t,
      from[2] + dz * t,
    ];
    const n = refractiveIndex(field, x);
    actualDt += (ds * n) / C_LIGHT;
  }
  return { length, actualDt };
}

export interface CausalProbe {
  flatDt: number;
  actualDt: number;
  delay: number;
  surfaceN: number;
  surfaceGradMag: number;
  rayLength: number;
}

/** Sun → Earth surface (Sun-facing point) → Sun round-trip probe. */
export function sunEarthRoundTrip(field: Field3D, pose: EarthPose = getEarthPose()): CausalProbe {
  const sx = SUN_POSITION[0] - pose.center[0];
  const sy = SUN_POSITION[1] - pose.center[1];
  const sz = SUN_POSITION[2] - pose.center[2];
  const r = Math.hypot(sx, sy, sz) || 1;
  const surface: [number, number, number] = [
    pose.center[0] + (sx / r) * EARTH_RADIUS,
    pose.center[1] + (sy / r) * EARTH_RADIUS,
    pose.center[2] + (sz / r) * EARTH_RADIUS,
  ];
  const fwd = traceCausalRay(field, SUN_POSITION, surface, 96);
  const back = traceCausalRay(field, surface, SUN_POSITION, 96);
  const rayLength = fwd.length + back.length;
  const flatDt = rayLength / C_LIGHT;
  const actualDt = fwd.actualDt + back.actualDt;
  return {
    flatDt,
    actualDt,
    delay: actualDt - flatDt,
    surfaceN: refractiveIndex(field, surface),
    surfaceGradMag: gradientMagnitude(field, surface),
    rayLength,
  };
}
