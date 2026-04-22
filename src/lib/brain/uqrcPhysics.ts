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
import {
  EARTH_RADIUS,
  HUMAN_HEIGHT,
  clampToEarthSurface,
  getEarthPose,
  quatRotate,
  type EarthPose,
} from './earth';
import { INTERIOR_RADIUS } from './street';

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
  /** Optional surface tangent basis. When present, fwd/right are pushed
   *  along this local plane instead of world XZ. Required for the hollow
   *  Earth interior so movement follows the inner shell, not world axes. */
  basis?: {
    up: [number, number, number];
    forward: [number, number, number];
    right: [number, number, number];
  };
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
const GAMMA_BASE = 1.2;
const MAX_SPEED_BASE = 6.0;
/** Inside this radius around the Earth pose center, bodies integrate in
 *  Earth-local (co-rotating) coords so the surface basin and the avatar
 *  share the same frame — pins survive Earth's rotation. */
const ATMOSPHERE_SHELL = EARTH_RADIUS * 1.05;

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
      // Live Earth pose — read once per tick. Bodies inside the atmosphere
      // shell will integrate in Earth-local (co-rotating) coords so the
      // surface pin survives Earth's rotation.
      const pose: EarthPose = getEarthPose();
      const omegaY = (2 * Math.PI) / 60; // matches EARTH_SPIN_PERIOD; informational only
      void omegaY;

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

        // Intent (read once — used both to gate gradient drift on interior
        // bodies and to add the player's tangential push below).
        const intent = this.intent.get(b.id);
        const intentMag = intent
          ? Math.abs(intent.fwd) + Math.abs(intent.right)
          : 0;
        const isInteriorHumanoid =
          (b.kind === 'self' || b.kind === 'avatar') &&
          b.meta?.attachedTo === 'earth-interior';
        // Interior humanoid bodies suppress field-gradient drift when the
        // player isn't actively pushing — the curvature gradient on the
        // inner shell is non-zero and would otherwise slide the body off
        // its spawn point. Walking is the gradient-augmented state.
        const suppressDrift = isInteriorHumanoid && intentMag < 0.05;

        // ─────────────────────────────────────────────────────────────
        // PURE UQRC body update — bodies sample the field, never decide.
        //
        //   acc = (Σ_μ 𝒟_μ u + ν·Δu + λ(ε₀)·∇∇S + intent) / mass
        //   v  += acc · Δt
        //   x  += v · Δt
        //
        // No gravity constant, no surface spring, no Earth conditional.
        // The Earth pin in pinTemplate creates a deep basin in u; the
        // gradient term below pulls bodies down it. That gradient *is*
        // gravity. The basin is deep enough that the surface is the
        // attractor — no clamp required.
        //
        // Mass enters as F=ma (acc = F/mass). Heavier bodies respond more
        // slowly to the same field gradient, are capped at a lower top
        // speed (∝ 1/√m) and bleed kinetic energy faster (γ ∝ √m) so they
        // settle on the basin instead of bouncing.
        // ─────────────────────────────────────────────────────────────

        // Σ_μ 𝒟_μ u — gradient drift, averaged over field axes
        let dxAcc = 0, dyAcc = 0, dzAcc = 0;
        if (!suppressDrift) {
          for (let a = 0; a < FIELD3D_AXES; a++) {
            const g = gradient3D(this.field, a, lx, ly, lz);
            dxAcc -= g[0]; dyAcc -= g[1]; dzAcc -= g[2];
          }
        }
        const driftScale = DRIFT_COUPLING / FIELD3D_AXES;
        let fx = dxAcc * driftScale;
        let fy = dyAcc * driftScale;
        let fz = dzAcc * driftScale;

        // ν · Δu — informational viscosity (smooths body trajectory).
        // Approximated locally by ∇‖F_{μν}‖ which falls to 0 in flat regions.
        // Also suppressed for resting interior humanoids: on the inner
        // shell ‖F_{μν}‖ has a non-zero gradient at the street pins, and
        // sampling it would slowly slide the body off its spawn point —
        // the exact "drift without moving" the user reported.
        const cg = curvatureGradient(this.field, lx, ly, lz);
        if (!suppressDrift) {
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
        }

        // Player intent. If a surface basis is supplied (interior shell),
        // push along that local tangent plane using yaw to rotate fwd/right
        // within it. Otherwise fall back to world-XZ legacy behaviour.
        if (intent) {
          if (intent.basis) {
            const { forward: fwdAxis, right: rightAxis } = intent.basis;
            const cy = Math.cos(intent.yaw), sy = Math.sin(intent.yaw);
            // Local push: yaw rotates the (fwd,right) intent within the
            // tangent plane. cos·fwd - sin·right gives the look-aligned
            // forward component; sin·fwd + cos·right gives the strafe.
            const lf = cy * intent.fwd - sy * intent.right;
            const lr = sy * intent.fwd + cy * intent.right;
            fx += INTENT_COUPLING * (fwdAxis[0] * lf + rightAxis[0] * lr);
            fy += INTENT_COUPLING * (fwdAxis[1] * lf + rightAxis[1] * lr);
            fz += INTENT_COUPLING * (fwdAxis[2] * lf + rightAxis[2] * lr);
          } else {
            const cosY = Math.cos(intent.yaw);
            const sinY = Math.sin(intent.yaw);
            const ifx = -sinY * intent.fwd + cosY * intent.right;
            const ifz = -cosY * intent.fwd - sinY * intent.right;
            fx += INTENT_COUPLING * ifx;
            fz += INTENT_COUPLING * ifz;
          }
        }

        // ── Mass-scaled response: a = F/m, γ = γ₀·√m, v_max = v₀/√m ──
        const mass = Math.max(0.01, b.mass);
        const sqrtM = Math.sqrt(mass);
        // Interior humanoid bodies get 3× damping so any residual
        // tangential drift bleeds off in <1 s (rest is the default state).
        const gamma = GAMMA_BASE * sqrtM * (isInteriorHumanoid ? 3 : 1);
        const maxSpeed = MAX_SPEED_BASE / sqrtM;
        const ax = fx / mass;
        const ay = fy / mass;
        const az = fz / mass;

        // ── Co-rotating frame inside Earth's atmosphere shell ──────────
        // The Earth pin is rewritten each tick at pose.center, but the
        // body inherits no spin. To keep a foot pinned to the rotating
        // surface we transform pos+vel into Earth-local coords, integrate
        // there, then transform back. Outside the shell, bodies integrate
        // in world space exactly as before.
        const dxC = b.pos[0] - pose.center[0];
        const dyC = b.pos[1] - pose.center[1];
        const dzC = b.pos[2] - pose.center[2];
        const rEarth = Math.hypot(dxC, dyC, dzC);
        const insideShell = rEarth <= ATMOSPHERE_SHELL && b.kind !== 'infinity';

        if (insideShell) {
          // Transform pos/vel into Earth-local frame using invSpinQuat.
          const localPos = quatRotate(pose.invSpinQuat, [dxC, dyC, dzC]);
          const localVel = quatRotate(pose.invSpinQuat, b.vel);
          // Acceleration is sampled from the world-space field; rotate it too.
          const localAcc = quatRotate(pose.invSpinQuat, [ax, ay, az]);
          localVel[0] += dt * (localAcc[0] - gamma * localVel[0]);
          localVel[1] += dt * (localAcc[1] - gamma * localVel[1]);
          localVel[2] += dt * (localAcc[2] - gamma * localVel[2]);
          const sp = Math.hypot(localVel[0], localVel[1], localVel[2]);
          if (sp > maxSpeed) {
            const k = maxSpeed / sp;
            localVel[0] *= k; localVel[1] *= k; localVel[2] *= k;
          }
          localPos[0] += dt * localVel[0];
          localPos[1] += dt * localVel[1];
          localPos[2] += dt * localVel[2];
          // Back to world frame using spinQuat.
          const worldPos = quatRotate(pose.spinQuat, localPos);
          const worldVel = quatRotate(pose.spinQuat, localVel);
          b.pos[0] = pose.center[0] + worldPos[0];
          b.pos[1] = pose.center[1] + worldPos[1];
          b.pos[2] = pose.center[2] + worldPos[2];
          b.vel[0] = worldVel[0];
          b.vel[1] = worldVel[1];
          b.vel[2] = worldVel[2];
        } else {
          // World-space integration (deep space / Infinity / portals).
          b.vel[0] += dt * (ax - gamma * b.vel[0]);
          b.vel[1] += dt * (ay - gamma * b.vel[1]);
          b.vel[2] += dt * (az - gamma * b.vel[2]);
          const sp = Math.hypot(b.vel[0], b.vel[1], b.vel[2]);
          if (sp > maxSpeed) {
            const k = maxSpeed / sp;
            b.vel[0] *= k; b.vel[1] *= k; b.vel[2] *= k;
          }
          b.pos[0] += dt * b.vel[0];
          b.pos[1] += dt * b.vel[1];
          b.pos[2] += dt * b.vel[2];
        }

        // Infinity is a special render-only entity: it floats. (Not a force.)
        if (b.kind === 'infinity') {
          b.pos[1] = 1.4;
          b.vel[1] = 0;
        }

        // ── Hard surface clamp for humanoid bodies ──────────────────────
        // The attractor field alone occasionally lets `self` / remote
        // `avatar` bodies tunnel inside the planet or drift off the
        // surface during boot. Clamp them into the human shell
        // [EARTH_RADIUS, EARTH_RADIUS + HUMAN_HEIGHT] and zero the radial
        // velocity component so we don't fight the integrator.
        if (b.kind === 'self' || b.kind === 'avatar') {
          const interior = b.meta?.attachedTo === 'earth-interior';
          if (interior) {
            // ── Hollow-Earth interior clamp ────────────────────────────
            // Body lives in the shell [INTERIOR_HEAD, INTERIOR_RADIUS]
            // INSIDE the planet. Gravity points OUTWARD from the core
            // (the inner shell is "down" for the player); the integrator
            // already supplies that via the Earth pin's outward-pointing
            // bias on cells *outside* the body. Here we just clamp the
            // radial position into the interior shell and zero the
            // radial velocity component, preserving tangential motion.
            const dx = b.pos[0] - pose.center[0];
            const dy = b.pos[1] - pose.center[1];
            const dz = b.pos[2] - pose.center[2];
            const rr = Math.hypot(dx, dy, dz) || 1;
            const minR = Math.max(0, INTERIOR_RADIUS - HUMAN_HEIGHT);
            const maxR = INTERIOR_RADIUS - HUMAN_HEIGHT / 2; // body center
            const target = Math.min(maxR, Math.max(minR + HUMAN_HEIGHT / 2, rr));
            if (Math.abs(rr - target) > 1e-4) {
              const k = target / rr;
              b.pos[0] = pose.center[0] + dx * k;
              b.pos[1] = pose.center[1] + dy * k;
              b.pos[2] = pose.center[2] + dz * k;
              const ux = dx / rr, uy = dy / rr, uz = dz / rr;
              const radial = b.vel[0] * ux + b.vel[1] * uy + b.vel[2] * uz;
              b.vel[0] -= radial * ux;
              b.vel[1] -= radial * uy;
              b.vel[2] -= radial * uz;
            }
            // ── Hard tangential rest ────────────────────────────────────
            // When the player isn't pressing anything, bleed residual
            // tangential velocity hard. Without this, leftover momentum
            // from earlier frames + the co-rotating frame transform
            // appears as the body sliding along the street while the
            // user feels stationary. Match: "I drift without moving."
            if (suppressDrift) {
              const dx2 = b.pos[0] - pose.center[0];
              const dy2 = b.pos[1] - pose.center[1];
              const dz2 = b.pos[2] - pose.center[2];
              const rr2 = Math.hypot(dx2, dy2, dz2) || 1;
              const ux2 = dx2 / rr2, uy2 = dy2 / rr2, uz2 = dz2 / rr2;
              const radial2 = b.vel[0] * ux2 + b.vel[1] * uy2 + b.vel[2] * uz2;
              const tx = b.vel[0] - radial2 * ux2;
              const ty = b.vel[1] - radial2 * uy2;
              const tz = b.vel[2] - radial2 * uz2;
              const decay = 0.5; // 50% per physics tick → ~e-fold in ~33 ms
              b.vel[0] -= tx * decay;
              b.vel[1] -= ty * decay;
              b.vel[2] -= tz * decay;
              // Below 0.02 m/s, snap to zero so the body truly rests.
              const sp2 = Math.hypot(b.vel[0], b.vel[1], b.vel[2]);
              if (sp2 < 0.02) {
                b.vel[0] = 0; b.vel[1] = 0; b.vel[2] = 0;
              }
            }
            // Inject user mass into the field at the body's location so
            // the player perturbs the manifold they stand on (UQRC
            // consistency — bodies are not invisible to the field).
            const lxm = worldToLattice(b.pos[0], N);
            const lym = worldToLattice(b.pos[1], N);
            const lzm = worldToLattice(b.pos[2], N);
            inject3D(this.field, 0, lxm, lym, lzm, 0.02 * b.mass, 0.8);
          } else {
            const { pos: clamped, clamped: didClamp } = clampToEarthSurface(b.pos, pose);
            if (didClamp) {
              b.pos[0] = clamped[0];
              b.pos[1] = clamped[1];
              b.pos[2] = clamped[2];
              const dx = b.pos[0] - pose.center[0];
              const dy = b.pos[1] - pose.center[1];
              const dz = b.pos[2] - pose.center[2];
              const rr = Math.hypot(dx, dy, dz) || 1;
              const ux = dx / rr, uy = dy / rr, uz = dz / rr;
              const radial = b.vel[0] * ux + b.vel[1] * uy + b.vel[2] * uz;
              b.vel[0] -= radial * ux;
              b.vel[1] -= radial * uy;
              b.vel[2] -= radial * uz;
            }
          }
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