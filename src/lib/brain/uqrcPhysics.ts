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
  BODY_SHELL_RADIUS,
  type EarthPose,
  worldPosToLocalNormal,
} from './earth';
import { causalCollide } from './collide';
import {
  initLavaMantle,
  sampleMantleRadialAcceleration,
  updateLavaMantlePin,
} from './lavaMantle';
import {
  getVolcanoOrgan,
  SHARED_VOLCANO_ANCHOR_ID,
  sampleVolcanoElevation,
  sampleTerrainDryMask,
} from './volcanoOrgan';
import {
  sunEarthRoundTrip,
  speedLimitFromMph,
  classifyCausalState,
  relaxSurfaceBasin,
  type CausalProbe,
  type CausalState,
  type ProbeHistorySample,
} from './lightspeed';
import {
  sampleLandMask,
  sampleSurfaceLift,
  WATER_WADE_DEPTH,
  WATER_WALK_SCALE,
} from './surfaceProfile';
import { EARTH_CORE_RADIUS } from './earthCore';

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
const SURFACE_RECOVERY_SPEED_BASE = 32.0;
/**
 * Avatar walk-speed cap, derived through the 𝒞_light closure relation.
 *   v_walk = 5 mph · 0.44704 m·s⁻¹/mph  ≈ 2.2352 m/s
 * Per-tick step v·Δt ≈ 0.0373 m, well under one lattice cell (~531 m),
 * so causality holds. This cap applies ONLY to the tangential (walk-plane)
 * velocity of surface humanoids — radial recovery from the mantle pin is
 * unaffected so bodies sunk into the basin can still be pushed back out.
 */
export const AVATAR_WALK_SPEED_MPH = 20;
export const AVATAR_WALK_SPEED_MPS = speedLimitFromMph(AVATAR_WALK_SPEED_MPH);
const SURFACE_WALK_SPEED = AVATAR_WALK_SPEED_MPS;
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

export function integrateCoRotatingBody(params: {
  pos: [number, number, number];
  vel: [number, number, number];
  acc: [number, number, number];
  gamma: number;
  maxSpeed: number;
  prevPose: EarthPose;
  nextPose: EarthPose;
}): { pos: [number, number, number]; vel: [number, number, number] } {
  const { pos, vel, acc, gamma, maxSpeed, prevPose, nextPose } = params;
  const prevRelative: [number, number, number] = [
    pos[0] - prevPose.center[0],
    pos[1] - prevPose.center[1],
    pos[2] - prevPose.center[2],
  ];
  const localPos = quatRotate(prevPose.invSpinQuat, prevRelative);
  const localVel = quatRotate(prevPose.invSpinQuat, vel);
  const localAcc = quatRotate(prevPose.invSpinQuat, acc);
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
  const worldPos = quatRotate(nextPose.spinQuat, localPos);
  const worldVel = quatRotate(nextPose.spinQuat, localVel);
  return {
    pos: [
      nextPose.center[0] + worldPos[0],
      nextPose.center[1] + worldPos[1],
      nextPose.center[2] + worldPos[2],
    ],
    vel: [worldVel[0], worldVel[1], worldVel[2]],
  };
}

export class UqrcPhysics {
  private field: Field3D;
  private bodies = new Map<string, Body>();
  private intent = new Map<string, Intent>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();
  private lastQ = 0;
  private restored = false;
  private lastCausalProbe: CausalProbe | null = null;
  private prevCausalSample: ProbeHistorySample | null = null;
  private lastCausalState: CausalState = 'dead';
  private lastPose: EarthPose | null = null;
  /** Per-body dwell timer (seconds) inside the inner core. Triggers a
   *  respawn-to-village rescue once a body has been below
   *  EARTH_CORE_RADIUS for more than CORE_ESCAPE_DWELL_S. */
  private coreDwell = new Map<string, number>();
  /** Optional rescue hook — set by the scene to teleport a body that has
   *  fallen through the volcano back to the shared village. Pure callback;
   *  physics only invokes it, the scene supplies the spawn point. */
  private coreRescue: ((id: string) => void) | null = null;

  /** Register the rescue hook (scene-owned: it knows the village anchor). */
  setCoreRescue(fn: ((id: string) => void) | null): void {
    this.coreRescue = fn;
  }

  constructor() {
    this.field = createField3D(FIELD3D_N);
    initLavaMantle(this.field);
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

  getIntent(id: string): Intent | undefined {
    return this.intent.get(id);
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

  /** Last Sun↔Earth causal-light probe (diagnostic, never a force). */
  getLastCausalProbe(): CausalProbe | null {
    return this.lastCausalProbe;
  }

  /**
   * 𝒞_light state classification for the most recent probe.
   * `live` | `creep` | `saturated` | `dead`. Consumers use this to gate
   * downstream behaviour (e.g. reply pipeline shrinks budget when the
   * surface basin is saturated — no information flow at the boundary).
   */
  getCausalState(): CausalState {
    return this.lastCausalState;
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
      const pose: EarthPose = getEarthPose();
      const prevPose: EarthPose = this.lastPose ?? pose;
      updateLavaMantlePin(this.field, pose, Date.now() / 1000);

      // 1. Field evolves
      for (let s = 0; s < FIELD_TICKS_PER_PHYSICS; s++) step3D(this.field);

      const N = this.field.N;
      // Live Earth pose — read once per tick. Bodies inside the atmosphere
      // shell will integrate in Earth-local (co-rotating) coords so the
      // surface pin survives Earth's rotation.
      const omegaY = (2 * Math.PI) / EARTH_SPIN_PERIOD; // matches EARTH_SPIN_PERIOD; informational only
      void omegaY;

      // 2. Bodies inject (mass-weighted bumps)
      for (const b of this.bodies.values()) {
        if (b.kind === 'portal' || b.kind === 'piece') continue; // handled by pins
        const isSurfaceHumanoid =
          (b.kind === 'self' || b.kind === 'avatar') &&
          b.meta?.attachedTo === 'earth-surface';
        // Surface walkers are passengers on the Earth organ, not tectonic
        // masses. Letting them inject into the same coarse 24³ field they
        // immediately sample for drift/collision creates a self-excited
        // micro-basin under their feet, which reads as floor tremor.
        if (isSurfaceHumanoid) continue;
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

        // 𝒞_collide(u, b) := −∇Π(u(x_b))
        // Applied to every body. With the field now evolving the full
        // 𝒪_UQRC = ν Δu − ℛ u + L_S^pin u + 𝒜_advect + 𝒫_pressure + 𝒢_mass,
        // ‖u‖² has a real basin around the Earth and finite gradients in
        // wind/orbit regions everywhere else. Bodies sample −∇Π and slide
        // toward the nearest local minimum. No body-class branching —
        // the gate that limited this to surface humanoids was a workaround
        // for the previous static field and is no longer needed.
        {
          const c = causalCollide(this.field, lx, ly, lz);
          // causalCollide returns ∂Π/∂cell (lattice units, per its docstring).
          // Convert to world units by multiplying by cellsPerUnit = N/WORLD_SIZE
          // so a 1-cell gradient becomes the world-meter acceleration the
          // postulate intends. Without this scaling the restoring force is
          // ~WORLD_SIZE/N times too weak and bodies clip through the basin
          // minimum at r = EARTH_RADIUS instead of resting on it.
          const cellsPerUnit = N / WORLD_SIZE;
          fx += c[0] * cellsPerUnit * mass;
          fy += c[1] * cellsPerUnit * mass;
          fz += c[2] * cellsPerUnit * mass;
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
            // The camera quaternion uses Euler 'YXZ' on basis
            // (right, up, -forward), so the world-space camera forward at
            // yaw `y` is  cos(y)·fwd − sin(y)·right  and the camera right
            // is  cos(y)·right + sin(y)·fwd. Pressing W must push along
            // camera-forward, pressing D along camera-right. The previous
            // sign on `sy` produced the opposite strafe → inverted feel.
            const pushFwdAxis: [number, number, number] = [
              cy * fwdAxis[0] - sy * rightAxis[0],
              cy * fwdAxis[1] - sy * rightAxis[1],
              cy * fwdAxis[2] - sy * rightAxis[2],
            ];
            const pushRightAxis: [number, number, number] = [
              cy * rightAxis[0] + sy * fwdAxis[0],
              cy * rightAxis[1] + sy * fwdAxis[1],
              cy * rightAxis[2] + sy * fwdAxis[2],
            ];
            fx += INTENT_COUPLING * (pushFwdAxis[0] * intent.fwd + pushRightAxis[0] * intent.right);
            fy += INTENT_COUPLING * (pushFwdAxis[1] * intent.fwd + pushRightAxis[1] * intent.right);
            fz += INTENT_COUPLING * (pushFwdAxis[2] * intent.fwd + pushRightAxis[2] * intent.right);
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
        // Surface humanoids get extra damping ONLY when the user is idle,
        // so residual tangential drift bleeds off without fighting active
        // joystick / WASD pushes. With intent present, use base damping so
        // the INTENT_COUPLING force actually accelerates the body.
        const gamma = GAMMA_BASE * sqrtM * (isSurfaceHumanoid && intentMag < 0.05 ? 2.2 : 1);

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
        const baseMaxSpeed = MAX_SPEED_BASE / sqrtM;
        const maxSpeed = isSurfaceHumanoid && insideShell
          ? Math.max(baseMaxSpeed, SURFACE_RECOVERY_SPEED_BASE / sqrtM)
          : baseMaxSpeed;

        // Analytic sub-cell surface restoring force from the mantle profile.
        // The 24^3 lattice is ~531 m / cell, so sampled gradients alone cannot
        // resolve metre-scale penetration around BODY_SHELL_RADIUS. The mantle
        // writer already defines the intended radial collider analytically;
        // apply that same acceleration here so bodies below the basin are
        // pushed back out and bodies above it are pushed back down.
        if (insideShell && rEarth > 1e-6) {
          // Local terrain elevation (volcano organ) lifts the effective
          // basin so the player walks UP the slope instead of clipping
          // through it. Sampler is Earth-local so the volcano stays
          // glued to the planet under spin.
          let elevation = 0;
          if (isSurfaceHumanoid) {
            const localN = worldPosToLocalNormal(b.pos, pose);
            const organ = getVolcanoOrgan(SHARED_VOLCANO_ANCHOR_ID);
            // Land lift + volcano cone are both real terrain. Subtract a
            // wade depth when the foot is over open water so avatars
            // stop walking ON the ocean and start walking IN it.
            const landMask = sampleTerrainDryMask(organ, localN);
            const waterDip = (1 - landMask) * WATER_WADE_DEPTH;
            elevation =
              sampleVolcanoElevation(organ, localN)
              + sampleSurfaceLift(localN)
              - waterDip;
          }
          const radialAcc = sampleMantleRadialAcceleration(rEarth - elevation);
          const invR = 1 / rEarth;
          fx += radialAcc * dxC * invR * mass;
          fy += radialAcc * dyC * invR * mass;
          fz += radialAcc * dzC * invR * mass;
        }

        const ax = fx / mass;
        const ay = fy / mass;
        const az = fz / mass;

        if (insideShell) {
          const next = integrateCoRotatingBody({
            pos: b.pos,
            vel: b.vel,
            acc: [ax, ay, az],
            gamma,
            maxSpeed,
            prevPose,
            nextPose: pose,
          });
          b.pos[0] = next.pos[0];
          b.pos[1] = next.pos[1];
          b.pos[2] = next.pos[2];
          b.vel[0] = next.vel[0];
          b.vel[1] = next.vel[1];
          b.vel[2] = next.vel[2];
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

        // ── Walk-speed cap (𝒞_light-derived, tangential only) ─────────
        // For avatars on the Earth surface, decompose v into radial (along
        // the local up vector from Earth's centre) and tangential
        // components. Clamp tangential to SURFACE_WALK_SPEED (≈ 2.235 m/s
        // = 5 mph). Radial is left untouched so the mantle's restoring
        // force can still recover bodies that sank below the basin without
        // being throttled by the walk cap.
        if (isSurfaceHumanoid && insideShell) {
          const rdx = b.pos[0] - pose.center[0];
          const rdy = b.pos[1] - pose.center[1];
          const rdz = b.pos[2] - pose.center[2];
          const rMag = Math.hypot(rdx, rdy, rdz);
          if (rMag > 1e-6) {
            const ux = rdx / rMag, uy = rdy / rMag, uz = rdz / rMag;
            const vRad = b.vel[0] * ux + b.vel[1] * uy + b.vel[2] * uz;
            const tx = b.vel[0] - vRad * ux;
            const ty = b.vel[1] - vRad * uy;
            const tz = b.vel[2] - vRad * uz;
            const tMag = Math.hypot(tx, ty, tz);
            // Wading scales the tangential speed cap. Open water → 45%
            // of land walk speed; partial coast → linearly interpolated.
            const localNwalk = worldPosToLocalNormal(b.pos, pose);
            const organ = getVolcanoOrgan(SHARED_VOLCANO_ANCHOR_ID);
            const landMaskWalk = sampleTerrainDryMask(organ, localNwalk);
            const walkCap = SURFACE_WALK_SPEED *
              (WATER_WALK_SCALE + (1 - WATER_WALK_SCALE) * landMaskWalk);
            if (tMag > walkCap) {
              const k = walkCap / tMag;
              b.vel[0] = vRad * ux + tx * k;
              b.vel[1] = vRad * uy + ty * k;
              b.vel[2] = vRad * uz + tz * k;
            }
            // Idle radial settle. When the user isn't pushing intent and
            // the body sits within 1 m of the basin minimum, aggressively
            // damp residual radial velocity. The sampled mantle gradient
            // has a 1 m dead-band so vRad is exactly the noise that was
            // showing up as the visible "altitude shake" (-4.6m ↔ -4.4m
            // sawtooth in the debug HUD). With intent present, leave
            // vRad alone so the player can still jump / fall.
            if (intentMag < 0.05) {
                // Local terrain elevation raises the dead-band so idle
                // standing on a volcano slope settles to the slope, not
                // to the spherical baseline shell (which would phase the
                // body through the visible cone).
                const localN = worldPosToLocalNormal(b.pos, pose);
                const organ = getVolcanoOrgan(SHARED_VOLCANO_ANCHOR_ID);
                const landMask = sampleTerrainDryMask(organ, localN);
                const waterDip = (1 - landMask) * WATER_WADE_DEPTH;
                const elevation =
                  sampleVolcanoElevation(organ, localN)
                  + sampleSurfaceLift(localN)
                  - waterDip;
                const targetShell = BODY_SHELL_RADIUS + elevation;
                const dr = rMag - targetShell;
              if (Math.abs(dr) < 1.0) {
                // Critical-damping toward zero radial velocity, plus a
                // tiny spring back to the basin radius.
                const vRadDamp = vRad * 0.85;
                const springAcc = -dr * 4.0;
                const newVRad = vRadDamp + springAcc * dt;
                b.vel[0] = newVRad * ux + tx;
                b.vel[1] = newVRad * uy + ty;
                b.vel[2] = newVRad * uz + tz;
              }
            }
          }
        }

        // No surface-walk override and no radial-only velocity zeroing.
        // The previous overrides wrote `b.pos` directly along the tangent
        // basis, which lifts the body off the basin minimum if the walk
        // vector isn't perfectly tangent — the exact "everyone's on the
        // ground but I float away" the user reported. With 𝒞_collide
        // active, intent already enters as a tangent force (lines 415-435)
        // and 𝒞_collide pulls the body back to the basin every tick. The
        // self body is now treated identically to all other surface bodies.

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

      this.lastPose = pose;

      // ── Core escape: if a humanoid sits inside EARTH_CORE_RADIUS for
      //    > CORE_ESCAPE_DWELL_S seconds, fire the rescue hook so the
      //    scene can respawn them at the shared village. Pure observer
      //    until the threshold trips — no force, no clamp on transit
      //    so the falling-through-the-volcano animation still plays.
      const CORE_ESCAPE_DWELL_S = 1.0;
      for (const b of this.bodies.values()) {
        if (b.kind !== 'self' && b.kind !== 'avatar') continue;
        const dx = b.pos[0] - pose.center[0];
        const dy = b.pos[1] - pose.center[1];
        const dz = b.pos[2] - pose.center[2];
        const r = Math.hypot(dx, dy, dz);
        if (r < EARTH_CORE_RADIUS) {
          const acc = (this.coreDwell.get(b.id) ?? 0) + dt;
          if (acc > CORE_ESCAPE_DWELL_S && this.coreRescue) {
            this.coreDwell.delete(b.id);
            try { this.coreRescue(b.id); } catch { /* ignore */ }
          } else {
            this.coreDwell.set(b.id, acc);
          }
        } else if (this.coreDwell.has(b.id)) {
          this.coreDwell.delete(b.id);
        }
      }

      // 4. Cheap qScore every 30 ticks (~0.5 s)
      if (this.field.ticks % 30 === 0) {
        this.lastQ = qScore3D(this.field);
      }

      // 4b. Causal-light round-trip diagnostic — every 30 ticks.
      // Pure observer: reads the field, never writes. Tells us whether
      // the surface basin curves spacetime enough to drag light.
      if (this.field.ticks % 30 === 0) {
        try {
          const probe = sunEarthRoundTrip(this.field, pose);
          this.lastCausalState = classifyCausalState(probe, this.prevCausalSample ?? undefined);
          this.prevCausalSample = {
            delay: probe.delay,
            surfaceN: probe.surfaceN,
            surfaceGradMag: probe.surfaceGradMag,
          };
          this.lastCausalProbe = probe;
        } catch { /* ignore */ }
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

/** Module-level convenience for read-only consumers (debug overlays). */
export function getLastCausalProbe(): CausalProbe | null {
  return getBrainPhysics().getLastCausalProbe();
}

/** 𝒞_light state classification — see UqrcPhysics.getCausalState(). */
export function getCausalState(): CausalState {
  return getBrainPhysics().getCausalState();
}