/**
 * ═══════════════════════════════════════════════════════════════════════
 * UQRC PHYSICS — bodies as point samples of the 3-D field
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Movement is integrated from the field's gradient (drift force) minus the
 * gradient of curvature magnitude (curvature pressure → "collision").
 * Bodies inject Gaussian bumps back into the field each tick, scaled by mass.
 *
 *   F_drift(b)   = − Σ_a sample ∇u_a at b.position    (down-hill flow)
 *   F_collide(b) = − ∇‖[D_μ, D_ν]‖ at b.position
 *   v += dt · (F_drift + F_collide + intent − γ·v)
 *   x += dt · v
 *
 * Symplectic-like Verlet, with strong damping γ to keep the system bounded.
 * Runs on the main thread, throttled to physicsHz; render frame reads the
 * latest body transforms via getBodies().
 */

import {
  createField3D,
  step3D,
  inject3D,
  pin3D,
  unpin3D,
  gradient3D,
  curvatureGradient,
  curvatureAt,
  qScore3D,
  commutatorNorm3D,
  entropyHessianNorm3D,
  serializeField3D,
  deserializeField3D,
  FIELD3D_N,
  FIELD3D_AXES,
  FIELD3D_NU,
  FIELD3D_LAMBDA,
  type Field3D,
  type Field3DSnapshot,
} from '../uqrc/field3D';
import { EARTH_POSITION, EARTH_RADIUS, radiusFromEarth } from './earth';

export type BodyKind = 'avatar' | 'infinity' | 'portal' | 'piece' | 'self';

export interface Body {
  id: string;
  kind: BodyKind;
  // World position — kept in lattice units (0..N) internally, exposed
  // as world units (0..WORLD_SIZE) via getBodies().
  pos: [number, number, number];
  vel: [number, number, number];
  mass: number;        // injection amplitude scaler
  trust: number;       // 0..1, used for visual + injection scale
  meta?: Record<string, unknown>;
}

export interface Intent {
  fwd: number;
  right: number;
  yaw: number;        // rotation, used by client to choose forward vector
}

export const WORLD_SIZE = 60;            // metres in either horizontal axis
export const PHYSICS_HZ = 60;
export const FIELD_TICKS_PER_PHYSICS = 1;

const dt = 1 / PHYSICS_HZ;
/** ν Δu coupling on the body integrator (informational viscosity). */
const NU_BODY = FIELD3D_NU;
/** Σ_μ 𝒟_μ u coupling — strength of the gradient drift on the body. */
const DRIFT_COUPLING = 8.0;
/** Player intent is a tangential push along the field's tangent plane. */
const INTENT_COUPLING = 6.0;
/** Mild self-damping prevents body energy from accumulating to NaN over hours. */
const GAMMA = 1.2;
const MAX_SPEED = 6.0;

function worldToLattice(p: number, N: number): number {
  // Centre world (0..WORLD_SIZE) in the torus middle; allow negative wrap.
  return ((p / WORLD_SIZE + 0.5) * N + N) % N;
}

function latticeToWorld(p: number, N: number): number {
  return (p / N - 0.5) * WORLD_SIZE;
}

export class UqrcPhysics {
  private field: Field3D;
  private bodies = new Map<string, Body>();
  private intent = new Map<string, Intent>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();
  private lastQ = 0;
  private restored = false;

  constructor() {
    this.field = createField3D(FIELD3D_N);
  }

  start(): void {
    if (this.timer || typeof window === 'undefined') return;
    const intervalMs = 1000 / PHYSICS_HZ;
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  addBody(b: Body): void {
    this.bodies.set(b.id, b);
  }

  removeBody(id: string): void {
    this.bodies.delete(id);
    this.intent.delete(id);
  }

  setIntent(id: string, i: Intent): void {
    this.intent.set(id, i);
  }

  getBody(id: string): Body | undefined {
    return this.bodies.get(id);
  }

  getBodies(): Body[] {
    return Array.from(this.bodies.values());
  }

  getQScore(): number {
    return this.lastQ;
  }

  getTicks(): number {
    return this.field.ticks;
  }

  /** Read-only access to the underlying field (used by FieldFloor sampling). */
  getField(): Field3D {
    return this.field;
  }

  /** Inject text-driven content (chat) at a lattice position. */
  injectAt(world: [number, number, number], amplitude: number, axis: number = 0): void {
    const N = this.field.N;
    inject3D(
      this.field,
      axis,
      worldToLattice(world[0], N),
      worldToLattice(world[1], N),
      worldToLattice(world[2], N),
      amplitude,
      1.5,
    );
  }

  /** Pin a build piece (static defect). Returns the lattice key for later removal. */
  pinPiece(world: [number, number, number], target: number = 1.0): { axis: number; i: number; j: number; k: number } {
    const N = this.field.N;
    const i = Math.round(worldToLattice(world[0], N));
    const j = Math.round(worldToLattice(world[1], N));
    const k = Math.round(worldToLattice(world[2], N));
    pin3D(this.field, 0, i, j, k, target);
    pin3D(this.field, 1, i, j, k, target * 0.5);
    return { axis: 0, i, j, k };
  }

  /** Pin a portal — negative target creates a basin bodies fall into. */
  pinPortal(world: [number, number, number]): { i: number; j: number; k: number } {
    const N = this.field.N;
    const i = Math.round(worldToLattice(world[0], N));
    const j = Math.round(worldToLattice(world[1], N));
    const k = Math.round(worldToLattice(world[2], N));
    pin3D(this.field, 0, i, j, k, -1.5);
    pin3D(this.field, 1, i, j, k, -1.5);
    pin3D(this.field, 2, i, j, k, -1.5);
    return { i, j, k };
  }

  unpin(coord: { i: number; j: number; k: number }): void {
    for (let a = 0; a < FIELD3D_AXES; a++) unpin3D(this.field, a, coord.i, coord.j, coord.k);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  snapshot(): Field3DSnapshot {
    return serializeField3D(this.field);
  }

  restore(snap: Field3DSnapshot): void {
    if (this.restored) return;
    this.restored = true;
    try { this.field = deserializeField3D(snap); }
    catch (err) { console.warn('[UqrcPhysics] restore failed:', err); }
  }

  // ── private ────────────────────────────────────────────────────

  private tick(): void {
    try {
      // 1. Field evolves
      for (let s = 0; s < FIELD_TICKS_PER_PHYSICS; s++) step3D(this.field);

      const N = this.field.N;

      // 2. Bodies inject (mass-weighted bumps)
      for (const b of this.bodies.values()) {
        if (b.kind === 'portal' || b.kind === 'piece') continue; // handled by pins
        const lx = worldToLattice(b.pos[0], N);
        const ly = worldToLattice(b.pos[1], N);
        const lz = worldToLattice(b.pos[2], N);
        const amp = 0.04 * b.mass * (0.3 + b.trust);
        inject3D(this.field, 0, lx, ly, lz, amp, 1.0);
      }

      // 3. Integrate body motion from field forces + intent
      for (const b of this.bodies.values()) {
        if (b.kind === 'portal' || b.kind === 'piece') continue;
        const lx = worldToLattice(b.pos[0], N);
        const ly = worldToLattice(b.pos[1], N);
        const lz = worldToLattice(b.pos[2], N);

        // Drift force = − ∇u (down-hill); average across axes
        let fx = 0, fy = 0, fz = 0;
        for (let a = 0; a < FIELD3D_AXES; a++) {
          const g = gradient3D(this.field, a, lx, ly, lz);
          fx -= g[0]; fy -= g[1]; fz -= g[2];
        }
        fx *= DRIFT_FORCE / FIELD3D_AXES;
        fy *= DRIFT_FORCE / FIELD3D_AXES;
        fz *= DRIFT_FORCE / FIELD3D_AXES;

        // Curvature pressure = − ∇‖F_{μν}‖ (repels from ridges → "collision")
        const cg = curvatureGradient(this.field, lx, ly, lz);
        fx -= CURVATURE_FORCE * cg[0];
        fy -= CURVATURE_FORCE * cg[1];
        fz -= CURVATURE_FORCE * cg[2];

        // Intent (player input)
        const i = this.intent.get(b.id);
        if (i) {
          const cosY = Math.cos(i.yaw);
          const sinY = Math.sin(i.yaw);
          // forward = (-sin yaw, 0, -cos yaw)  matches three.js camera fwd
          const ifx = -sinY * i.fwd + cosY * i.right;
          const ifz = -cosY * i.fwd - sinY * i.right;
          // If standing on Earth, rotate intent into the local tangent
          // plane so walking feels flat locally even on a round surface.
          if (isOnEarth(b.pos)) {
            const tangent = geodesicStep(b.pos, ifx, ifz);
            fx += INTENT_FORCE * tangent[0];
            fy += INTENT_FORCE * tangent[1];
            fz += INTENT_FORCE * tangent[2];
          } else {
            fx += INTENT_FORCE * ifx;
            fz += INTENT_FORCE * ifz;
          }
        }

        // Earth gravity — radial pull/spring scaled by body mass and
        // local field curvature. Curvature pressure stiffens the bond
        // to the surface in high-‖F_{μν}‖ regions, so a heavy player in
        // a curved zone is held more tightly than a light one in flat
        // space. Bodies always rest at exactly r = EARTH_RADIUS.
        const localCurv = curvatureAt(this.field, lx, ly, lz);
        const grav = earthGravityForce(b.pos, b.mass, localCurv);
        fx += grav[0];
        fy += grav[1];
        fz += grav[2];

        // Damped Verlet
        b.vel[0] += dt * (fx - GAMMA * b.vel[0]);
        b.vel[1] += dt * (fy - GAMMA * b.vel[1]);
        b.vel[2] += dt * (fz - GAMMA * b.vel[2]);

        // Speed clamp
        const sp = Math.hypot(b.vel[0], b.vel[1], b.vel[2]);
        if (sp > MAX_SPEED) {
          const k = MAX_SPEED / sp;
          b.vel[0] *= k; b.vel[1] *= k; b.vel[2] *= k;
        }

        // Integrate position in 3D first.
        b.pos[0] += dt * b.vel[0];
        b.pos[1] += dt * b.vel[1];
        b.pos[2] += dt * b.vel[2];

        if (b.kind === 'infinity') {
          b.pos[1] = 1.4; // Infinity floats above the galactic plane
          b.vel[1] = 0;
        } else {
          // Use 3D distance — match isOnEarth so the branches agree.
          const dxE = b.pos[0] - EARTH_POSITION[0];
          const dyE = b.pos[1] - EARTH_POSITION[1];
          const dzE = b.pos[2] - EARTH_POSITION[2];
          const rE = Math.hypot(dxE, dyE, dzE);
          if (rE <= EARTH_RADIUS + EARTH_ATMOSPHERE) {
            // On Earth (or in its atmosphere): clamp to the crust so the
            // body never floats off and never sinks. Velocity component
            // along the surface normal is killed (perfect inelastic).
            const proj = projectToEarthSurface(b.pos);
            b.pos[0] = proj[0]; b.pos[1] = proj[1]; b.pos[2] = proj[2];
            const nx = dxE / (rE || 1);
            const ny = dyE / (rE || 1);
            const nz = dzE / (rE || 1);
            const vDotN = b.vel[0] * nx + b.vel[1] * ny + b.vel[2] * nz;
            b.vel[0] -= vDotN * nx;
            b.vel[1] -= vDotN * ny;
            b.vel[2] -= vDotN * nz;
          } else {
            // Outside Earth's influence: pin to galactic plane.
            b.pos[1] = 0;
            b.vel[1] = 0;
          }
        }

        // World clamp (soft)
        const r = Math.hypot(b.pos[0], b.pos[2]);
        if (r > WORLD_SIZE * 0.45) {
          const k = (WORLD_SIZE * 0.45) / r;
          b.pos[0] *= k; b.pos[2] *= k;
          b.vel[0] *= -0.3; b.vel[2] *= -0.3;
        }
      }

      // 4. Cheap qScore every 30 ticks (~0.5 s)
      if (this.field.ticks % 30 === 0) {
        this.lastQ = qScore3D(this.field);
      }

      // 5. Notify renderers
      for (const fn of this.listeners) {
        try { fn(); } catch { /* ignore */ }
      }
    } catch (err) {
      console.warn('[UqrcPhysics] tick error:', err);
    }
  }
}

// ── Singleton ────────────────────────────────────────────────────────

let _physics: UqrcPhysics | null = null;

export function getBrainPhysics(): UqrcPhysics {
  if (!_physics) {
    _physics = new UqrcPhysics();
    _physics.start();
  }
  return _physics;
}

export function teardownBrainPhysics(): void {
  if (_physics) {
    _physics.stop();
    _physics = null;
  }
}

export { latticeToWorld, worldToLattice };