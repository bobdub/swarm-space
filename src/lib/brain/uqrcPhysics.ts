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

        // ─────────────────────────────────────────────────────────────
        // PURE UQRC body update — bodies sample the field, never decide.
        //
        //   acc = Σ_μ 𝒟_μ u  +  ν · Δu  +  λ(ε₀) · ∇_μ ∇_ν S(u)  +  intent
        //   v  += acc · Δt
        //   x  += v · Δt
        //
        // No gravity constant, no surface spring, no Earth conditional.
        // The Earth pin in pinTemplate creates a deep basin in u; the
        // gradient term below pulls bodies down it. That gradient *is*
        // gravity. The basin is deep enough that the surface is the
        // attractor — no clamp required.
        // ─────────────────────────────────────────────────────────────

        // Σ_μ 𝒟_μ u — gradient drift, averaged over field axes
        let dxAcc = 0, dyAcc = 0, dzAcc = 0;
        for (let a = 0; a < FIELD3D_AXES; a++) {
          const g = gradient3D(this.field, a, lx, ly, lz);
          dxAcc -= g[0]; dyAcc -= g[1]; dzAcc -= g[2];
        }
        const driftScale = DRIFT_COUPLING / FIELD3D_AXES;
        let fx = dxAcc * driftScale;
        let fy = dyAcc * driftScale;
        let fz = dzAcc * driftScale;

        // ν · Δu — informational viscosity (smooths body trajectory).
        // Approximated locally by ∇‖F_{μν}‖ which falls to 0 in flat regions.
        const cg = curvatureGradient(this.field, lx, ly, lz);
        fx -= NU_BODY * cg[0];
        fy -= NU_BODY * cg[1];
        fz -= NU_BODY * cg[2];

        // λ(ε₀) · ∇_μ ∇_ν S(u) — informational inertia, scaled by mass.
        // λ is ~1e-100 so this term is mathematically present but quiescent;
        // it surfaces only in the Q_Score, never as a runaway force.
        const massInertia = FIELD3D_LAMBDA * b.mass;
        fx += massInertia * cg[0];
        fy += massInertia * cg[1];
        fz += massInertia * cg[2];

        // Player intent — a tangential push in world XZ. Because the Earth
        // basin's gradient near the surface is overwhelmingly radial, the
        // tangential component of intent slides the body around the sphere
        // naturally; the radial component fights the basin and is absorbed.
        const i = this.intent.get(b.id);
        if (i) {
          const cosY = Math.cos(i.yaw);
          const sinY = Math.sin(i.yaw);
          const ifx = -sinY * i.fwd + cosY * i.right;
          const ifz = -cosY * i.fwd - sinY * i.right;
          fx += INTENT_COUPLING * ifx;
          fz += INTENT_COUPLING * ifz;
        }

        // Mild self-damping → bounded |v| over arbitrarily long sessions.
        b.vel[0] += dt * (fx - GAMMA * b.vel[0]);
        b.vel[1] += dt * (fy - GAMMA * b.vel[1]);
        b.vel[2] += dt * (fz - GAMMA * b.vel[2]);

        const sp = Math.hypot(b.vel[0], b.vel[1], b.vel[2]);
        if (sp > MAX_SPEED) {
          const k = MAX_SPEED / sp;
          b.vel[0] *= k; b.vel[1] *= k; b.vel[2] *= k;
        }

        b.pos[0] += dt * b.vel[0];
        b.pos[1] += dt * b.vel[1];
        b.pos[2] += dt * b.vel[2];

        // Infinity is a special render-only entity: it floats. (Not a force.)
        if (b.kind === 'infinity') {
          b.pos[1] = 1.4;
          b.vel[1] = 0;
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