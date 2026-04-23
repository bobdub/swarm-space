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
  writePinTemplate,
  idx3,
  FIELD3D_N,
  FIELD3D_AXES,
  FIELD3D_NU,
  FIELD3D_LAMBDA,
  type Field3D,
  type Field3DSnapshot,
} from '../uqrc/field3D';
import {
  EARTH_RADIUS,
  EARTH_SPIN_PERIOD,
  getEarthPose,
  quatRotate,
  type EarthPose,
} from './earth';
import { sampleMantleRadialAcceleration } from './lavaMantle';

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

// WORLD_SIZE scales with WORLD_SCALE (×212.5) so the relative geometry
// (Earth/sun/galaxy occupy the same fraction of the lattice as before)
// is preserved. Old: 60 m. New: 60 × 212.5 = 12 750 m. Field lattice
// stays 24³ → 531 m / cell. Earth (1700 m radius) spans ≈ 3.2 cells —
// identical to the pre-scale stamp resolution.
export const WORLD_SIZE = 60 * 212.5;    // 12 750 m
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
const SURFACE_WALK_SPEED = 3.2;
/** Inside this radius around the Earth pose center, bodies integrate in
 *  Earth-local (co-rotating) coords so the surface basin and the avatar
 *  share the same frame — pins survive Earth's rotation. Kept as a function
 *  to avoid reading EARTH_RADIUS during module init inside the earth↔physics
 *  import cycle. */
function getAtmosphereShell(): number {
  return EARTH_RADIUS * 1.05;
}

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

  /**
   * Volumetric support basin — stamps a small inward-bowl into the field
   * over a sphere of `radiusM` metres around `world`. Replaces the
   * single-cell `pinPiece` defect for builder content: the resulting
   * basin co-moves with the live world position because the engine
   * re-issues this call every tick at the Earth-derived pose. Returns a
   * handle holding every cell that was written so it can be cleared
   * before the next stamp.
   */
  pinSupportBasin(
    world: [number, number, number],
    radiusM: number,
    depth: number = 0.6,
  ): { cells: number[] } {
    const N = this.field.N;
    const cellsPerUnit = N / WORLD_SIZE;
    const stampCells = Math.max(1, Math.ceil(radiusM * cellsPerUnit));
    const ci = Math.round(worldToLattice(world[0], N));
    const cj = Math.round(worldToLattice(world[1], N));
    const ck = Math.round(worldToLattice(world[2], N));
    const written: number[] = [];
    for (let dk = -stampCells; dk <= stampCells; dk++) {
      for (let dj = -stampCells; dj <= stampCells; dj++) {
        for (let di = -stampCells; di <= stampCells; di++) {
          const dCells = Math.sqrt(di * di + dj * dj + dk * dk);
          if (dCells > stampCells + 0.5) continue;
          const u = Math.min(1, dCells / Math.max(1e-6, stampCells));
          // Hermite bowl — deepest at the centre, flush at the rim.
          const fall = 1 - u * u * (3 - 2 * u);
          const cellDepth = -depth * fall;
          const flat = idx3(ci + di, cj + dj, ck + dk, N);
          for (let a = 0; a < FIELD3D_AXES; a++) {
            // Bias along the radial axis component for axis 0/1/2.
            const axisVec = a === 0 ? di : a === 1 ? dj : dk;
            const bias = cellDepth * (dCells > 0 ? axisVec / dCells : 0);
            writePinTemplate(this.field, a, flat, bias);
          }
          written.push(flat);
        }
      }
    }
    return { cells: written };
  }

  /** Clear every cell written by a previous `pinSupportBasin`. */
  unpinSupportBasin(handle: { cells: number[] } | null | undefined): void {
    if (!handle) return;
    for (const flat of handle.cells) {
      for (let a = 0; a < FIELD3D_AXES; a++) {
        this.field.pinTemplate[a][flat] = 0;
        this.field.pinMask[a][flat] = 0;
      }
    }
    handle.cells.length = 0;
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
      const omegaY = (2 * Math.PI) / EARTH_SPIN_PERIOD; // matches EARTH_SPIN_PERIOD; informational only
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
        const isSurfaceHumanoid =
          (b.kind === 'self' || b.kind === 'avatar') &&
          b.meta?.attachedTo === 'earth-surface';
        // Phase 4 fix: never suppress field drift. The lava-mantle pin
        // now places the global basin minimum exactly at r=EARTH_RADIUS,
        // so the gradient at a resting surface body is zero by
        // construction — no need to mute it. Suppressing drift was the
        // cheat that hid the missing collision: with no force from the
        // field, idle bodies free-fell into the core. The atmosphere
        // wall above the surface plus the basin descent below it act as
        // a true UQRC collider for self/avatar humanoids.
        const suppressDrift = false;

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
        const mass = Math.max(0.01, b.mass);

        if (isSurfaceHumanoid) {
          const dxR = b.pos[0] - pose.center[0];
          const dyR = b.pos[1] - pose.center[1];
          const dzR = b.pos[2] - pose.center[2];
          const rNow = Math.hypot(dxR, dyR, dzR) || 1;
          const radialAccel = sampleMantleRadialAcceleration(rNow);
          if (radialAccel !== 0) {
            fx += (dxR / rNow) * radialAccel * mass;
            fy += (dyR / rNow) * radialAccel * mass;
            fz += (dzR / rNow) * radialAccel * mass;
          }
        }

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
        const sqrtM = Math.sqrt(mass);
        // Interior humanoid bodies get 3× damping so any residual
        // tangential drift bleeds off in <1 s (rest is the default state).
        const gamma = GAMMA_BASE * sqrtM * (isSurfaceHumanoid ? (intentMag >= 0.05 ? 1.4 : 2.2) : 1);
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
        const insideShell = rEarth <= getAtmosphereShell() && b.kind !== 'infinity';

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

        if (isSurfaceHumanoid && intent && intentMag >= 0.05 && intent.basis) {
          const { forward: fwdAxis, right: rightAxis } = intent.basis;
          const cy = Math.cos(intent.yaw), sy = Math.sin(intent.yaw);
          const lf = cy * intent.fwd - sy * intent.right;
          const lr = sy * intent.fwd + cy * intent.right;
          const walkX = fwdAxis[0] * lf + rightAxis[0] * lr;
          const walkY = fwdAxis[1] * lf + rightAxis[1] * lr;
          const walkZ = fwdAxis[2] * lf + rightAxis[2] * lr;
          const walkLen = Math.hypot(walkX, walkY, walkZ) || 1;
          const walkScale = SURFACE_WALK_SPEED * dt / walkLen;
          b.pos[0] += walkX * walkScale;
          b.pos[1] += walkY * walkScale;
          b.pos[2] += walkZ * walkScale;
          b.vel[0] = walkX * (SURFACE_WALK_SPEED / walkLen);
          b.vel[1] = walkY * (SURFACE_WALK_SPEED / walkLen);
          b.vel[2] = walkZ * (SURFACE_WALK_SPEED / walkLen);
        } else if (isSurfaceHumanoid && intentMag < 0.05) {
          const dx = b.pos[0] - pose.center[0];
          const dy = b.pos[1] - pose.center[1];
          const dz = b.pos[2] - pose.center[2];
          const r = Math.hypot(dx, dy, dz) || 1;
          const upx = dx / r;
          const upy = dy / r;
          const upz = dz / r;
          const radial = b.vel[0] * upx + b.vel[1] * upy + b.vel[2] * upz;
          b.vel[0] = upx * radial;
          b.vel[1] = upy * radial;
          b.vel[2] = upz * radial;
        }

        // Infinity is a special render-only entity: it floats. (Not a force.)
        if (b.kind === 'infinity') {
          b.pos[1] = 1.4;
          b.vel[1] = 0;
        }

        // Phase 4A — no post-hoc surface clamp. The Earth pin profile
        // (lavaMantle.ts) owns radial placement: the static crust band
        // is the attractor that keeps humanoids on the visible ground.
        // Any per-tick rewrite here would re-introduce the "pressure
        // reads sideways across the ground" failure mode by suppressing
        // the very radial response the field is trying to produce.
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