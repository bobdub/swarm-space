/**
 * ═══════════════════════════════════════════════════════════════════════
 * UQRC FIELD 3-D — toroidal lattice generalisation of field.ts
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Same operator family as the 1-D ring field (𝒪_UQRC = ν Δ + ℛ + L_S),
 * lifted to a 3-D torus of side N and three field axes (x, y, z drifts).
 *
 *   𝒟_μ u(i,j,k) = (u(i+e_μ) − u(i,j,k)) / ℓ_min     (forward difference)
 *   [D_μ, D_ν] u = D_μ(D_ν u) − D_ν(D_μ u)            (commutator)
 *   Δu = sum of axial second differences              (Laplacian)
 *
 * Index layout: flat Float32Array length N³ per axis. idx = i + N*j + N²*k.
 * Pure, deterministic, allocation-light. ~1.5 M FLOPs per step at N=24.
 */

export const FIELD3D_N = 24;          // 13 824 cells per axis ≈ 55 KB × 3
export const FIELD3D_AXES = 3;        // x, y, z drift potentials

// ── UQRC named constants — one source of truth, no magic numbers in physics ──
export const FIELD3D_ELL_MIN = 1;          // ℓ_min — minimal lattice spacing
export const FIELD3D_DT_MIN = 1;           // Δt_min — one operator step
export const FIELD3D_NU = 0.05;            // ν     — Laplacian smoothing
export const FIELD3D_RICCI = 0.001;        // ℛ     — Ricci damping
export const FIELD3D_LAMBDA = 1e-100;      // λ(ε₀) — informational coupling
export const FIELD3D_DAMPING = 0.12;       // operator step size
export const FIELD3D_KAPPA_PIN = 0.85;     // L_S^pin coupling strength
export const FIELD3D_BOUND = 4;            // global regularity clamp

// Legacy aliases (do not use in new code)
export const FIELD3D_ELL = FIELD3D_ELL_MIN;
export const FIELD3D_PIN_STIFFNESS = FIELD3D_KAPPA_PIN;

export interface Field3D {
  N: number;
  axes: Float32Array[];           // length 3, each Float32Array(N³)
  pins: Map<number, number>;      // legacy sparse mirror of pinTemplate (for serialization & external readers)
  pinTemplate: Float32Array[];    // dense per-axis pin field — the L_S^pin target. Operator pulls u → template each tick.
  pinMask: Uint8Array[];          // per-axis 0/1 mask: 1 = cell is pinned (subject to L_S^pin)
  ticks: number;
  /** Φ — gravitational potential, ∇²Φ = ρ_mass. One Jacobi sweep per step3D tick. */
  phi?: Float32Array;
}

export function createField3D(N: number = FIELD3D_N): Field3D {
  const size = N * N * N;
  const axes: Float32Array[] = [];
  const pinTemplate: Float32Array[] = [];
  const pinMask: Uint8Array[] = [];
  for (let a = 0; a < FIELD3D_AXES; a++) {
    axes.push(new Float32Array(size));
    pinTemplate.push(new Float32Array(size));
    pinMask.push(new Uint8Array(size));
  }
  return { N, axes, pins: new Map(), pinTemplate, pinMask, ticks: 0, phi: new Float32Array(size) };
}

export function idx3(i: number, j: number, k: number, N: number): number {
  const ii = ((i % N) + N) % N;
  const jj = ((j % N) + N) % N;
  const kk = ((k % N) + N) % N;
  return ii + N * (jj + N * kk);
}

/** Sample axis `a` at lattice position (trilinear interpolation, toroidal). */
export function sample3D(field: Field3D, axis: number, x: number, y: number, z: number): number {
  const N = field.N;
  const u = field.axes[axis];
  const i0 = Math.floor(x), j0 = Math.floor(y), k0 = Math.floor(z);
  const fx = x - i0, fy = y - j0, fz = z - k0;
  const c000 = u[idx3(i0,     j0,     k0,     N)];
  const c100 = u[idx3(i0 + 1, j0,     k0,     N)];
  const c010 = u[idx3(i0,     j0 + 1, k0,     N)];
  const c110 = u[idx3(i0 + 1, j0 + 1, k0,     N)];
  const c001 = u[idx3(i0,     j0,     k0 + 1, N)];
  const c101 = u[idx3(i0 + 1, j0,     k0 + 1, N)];
  const c011 = u[idx3(i0,     j0 + 1, k0 + 1, N)];
  const c111 = u[idx3(i0 + 1, j0 + 1, k0 + 1, N)];
  const c00 = c000 * (1 - fx) + c100 * fx;
  const c10 = c010 * (1 - fx) + c110 * fx;
  const c01 = c001 * (1 - fx) + c101 * fx;
  const c11 = c011 * (1 - fx) + c111 * fx;
  const c0 = c00 * (1 - fy) + c10 * fy;
  const c1 = c01 * (1 - fy) + c11 * fy;
  return c0 * (1 - fz) + c1 * fz;
}

/** Discrete gradient ∇u at (x,y,z) on axis `a`. Returns [du/dx, du/dy, du/dz]. */
export function gradient3D(field: Field3D, axis: number, x: number, y: number, z: number): [number, number, number] {
  const h = 0.5;
  const dx = (sample3D(field, axis, x + h, y, z) - sample3D(field, axis, x - h, y, z)) / (2 * h);
  const dy = (sample3D(field, axis, x, y + h, z) - sample3D(field, axis, x, y - h, z)) / (2 * h);
  const dz = (sample3D(field, axis, x, y, z + h) - sample3D(field, axis, x, y, z - h)) / (2 * h);
  return [dx, dy, dz];
}

/** Pointwise commutator magnitude ‖[D_μ, D_ν] u‖² summed over axis pairs at (x,y,z). */
export function curvatureAt(field: Field3D, x: number, y: number, z: number): number {
  // Use cross-axis commutator approximation: |D_x u_y − D_y u_x| etc.
  const gx = gradient3D(field, 0, x, y, z);
  const gy = gradient3D(field, 1, x, y, z);
  const gz = gradient3D(field, 2, x, y, z);
  // Antisymmetric components
  const cxy = gx[1] - gy[0];
  const cxz = gx[2] - gz[0];
  const cyz = gy[2] - gz[1];
  return Math.sqrt(cxy * cxy + cxz * cxz + cyz * cyz);
}

/** Gradient of curvature magnitude at (x,y,z) — finite difference. */
export function curvatureGradient(field: Field3D, x: number, y: number, z: number): [number, number, number] {
  const h = 0.5;
  const gx = (curvatureAt(field, x + h, y, z) - curvatureAt(field, x - h, y, z)) / (2 * h);
  const gy = (curvatureAt(field, x, y + h, z) - curvatureAt(field, x, y - h, z)) / (2 * h);
  const gz = (curvatureAt(field, x, y, z + h) - curvatureAt(field, x, y, z - h)) / (2 * h);
  return [gx, gy, gz];
}

/** Add a Gaussian bump centred at (x,y,z) into axis `a`. */
export function inject3D(field: Field3D, axis: number, x: number, y: number, z: number, amplitude: number, sigma: number = 1.5): void {
  if (axis < 0 || axis >= FIELD3D_AXES) return;
  const N = field.N;
  const u = field.axes[axis];
  const r = Math.ceil(sigma * 2);
  const cx = Math.round(x), cy = Math.round(y), cz = Math.round(z);
  const inv2s2 = 1 / (2 * sigma * sigma);
  for (let dk = -r; dk <= r; dk++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        const d2 = di * di + dj * dj + dk * dk;
        const g = Math.exp(-d2 * inv2s2);
        const id = idx3(cx + di, cy + dj, cz + dk, N);
        u[id] += amplitude * g;
        if (u[id] > FIELD3D_BOUND) u[id] = FIELD3D_BOUND;
        else if (u[id] < -FIELD3D_BOUND) u[id] = -FIELD3D_BOUND;
      }
    }
  }
}

/** Pin a single lattice cell on `axis` at (i,j,k) to `target` (constraint). */
export function pin3D(field: Field3D, axis: number, i: number, j: number, k: number, target: number): void {
  if (axis < 0 || axis >= FIELD3D_AXES) return;
  const N = field.N;
  const flat = idx3(i, j, k, N);
  const key = ((axis & 0xff) << 24) | (flat & 0xffffff);
  field.pins.set(key, target);
  field.pinTemplate[axis][flat] = target;
  field.pinMask[axis][flat] = 1;
  // Seed live field so first render reflects the pin without waiting a tick.
  field.axes[axis][flat] = target;
}

/** Remove a pin (used for portal tombstones). */
export function unpin3D(field: Field3D, axis: number, i: number, j: number, k: number): void {
  const N = field.N;
  const flat = idx3(i, j, k, N);
  const key = ((axis & 0xff) << 24) | (flat & 0xffffff);
  field.pins.delete(key);
  if (axis >= 0 && axis < FIELD3D_AXES) {
    field.pinTemplate[axis][flat] = 0;
    field.pinMask[axis][flat] = 0;
  }
}

/**
 * Write directly into the pin template (used by galaxy.ts and roundUniverse.ts
 * to bake large structural curvature without populating the sparse `pins` map).
 * The operator step re-asserts these every tick via L_S^pin.
 */
export function writePinTemplate(
  field: Field3D,
  axis: number,
  flatIdx: number,
  target: number,
): void {
  if (axis < 0 || axis >= FIELD3D_AXES) return;
  field.pinTemplate[axis][flatIdx] = target;
  field.pinMask[axis][flatIdx] = 1;
  field.axes[axis][flatIdx] = target; // seed for instant visibility
}

import { COLLIDE_KAPPA, COLLIDE_U_MAX_SQ } from '../brain/collide';

/** One UQRC evolution tick over the 3-D torus. Mutates in place. */
export function step3D(field: Field3D): Field3D {
  const N = field.N;
  const size = N * N * N;

  // ─────────────────────────────────────────────────────────────────────
  // 𝒢_mass — gravity as the gradient of u, sourced by pinTemplate.
  // ρ_mass(x) = Σ_a |pinTemplate_a(x)| ; ∇²Φ = ρ_mass (one Jacobi sweep).
  // ─────────────────────────────────────────────────────────────────────
  if (!field.phi || field.phi.length !== size) field.phi = new Float32Array(size);
  const phi = field.phi;
  const phiNext = new Float32Array(size);
  for (let k = 0; k < N; k++) {
    const kp = (k + 1) % N, km = (k + N - 1) % N;
    for (let j = 0; j < N; j++) {
      const jp = (j + 1) % N, jm = (j + N - 1) % N;
      for (let i = 0; i < N; i++) {
        const ip = (i + 1) % N, im = (i + N - 1) % N;
        const flat = i + N * (j + N * k);
        let rho = 0;
        for (let a = 0; a < FIELD3D_AXES; a++) {
          rho += Math.abs(field.pinTemplate[a][flat]);
        }
        const sumNb =
          phi[ip + N * (j + N * k)] + phi[im + N * (j + N * k)] +
          phi[i + N * (jp + N * k)] + phi[i + N * (jm + N * k)] +
          phi[i + N * (j + N * kp)] + phi[i + N * (j + N * km)];
        // Jacobi update: Φ = (Σ_neighbours − ρ) / 6
        phiNext[flat] = (sumNb - rho) / 6;
      }
    }
  }
  field.phi = phiNext;
  const Phi = phiNext;

  // Pre-compute Π(‖u‖²) per cell once per tick — reused for −∇Π.
  const piBuf = new Float32Array(size);
  for (let flat = 0; flat < size; flat++) {
    let m2 = 0;
    for (let a = 0; a < FIELD3D_AXES; a++) {
      const v = field.axes[a][flat];
      m2 += v * v;
    }
    piBuf[flat] = Math.exp(COLLIDE_KAPPA * m2 / COLLIDE_U_MAX_SQ);
  }

  for (let a = 0; a < FIELD3D_AXES; a++) {
    const u = field.axes[a];
    const tpl = field.pinTemplate[a];
    const mask = field.pinMask[a];
    // Allocation-light: reuse a single scratch buffer per axis per tick
    const next = new Float32Array(size);
    for (let k = 0; k < N; k++) {
      const kp = (k + 1) % N, km = (k + N - 1) % N;
      for (let j = 0; j < N; j++) {
        const jp = (j + 1) % N, jm = (j + N - 1) % N;
        for (let i = 0; i < N; i++) {
          const ip = (i + 1) % N, im = (i + N - 1) % N;
          const flat = i + N * (j + N * k);
          const c = u[flat];
          const ipFlat = ip + N * (j + N * k);
          const imFlat = im + N * (j + N * k);
          const jpFlat = i + N * (jp + N * k);
          const jmFlat = i + N * (jm + N * k);
          const kpFlat = i + N * (j + N * kp);
          const kmFlat = i + N * (j + N * km);
          const lap =
            (u[ipFlat] + u[imFlat] - 2 * c) +
            (u[jpFlat] + u[jmFlat] - 2 * c) +
            (u[kpFlat] + u[kmFlat] - 2 * c);
          // 𝒪_UQRC(u) = ν Δu + ℛ u + L_S u
          // L_S u := L_S^free u + κ_pin · mask · (template − u)   (one fused step)
          const pinTerm = mask[flat] ? FIELD3D_KAPPA_PIN * (tpl[flat] - c) : 0;

          // 𝒜_advect(u)_a = −Σ_μ u_μ · 𝒟_μ u_a   (central difference)
          const dax = (u[ipFlat] - u[imFlat]) * 0.5;
          const day = (u[jpFlat] - u[jmFlat]) * 0.5;
          const daz = (u[kpFlat] - u[kmFlat]) * 0.5;
          const ux = field.axes[0][flat];
          const uy = field.axes[1][flat];
          const uz = field.axes[2][flat];
          const advect = -(ux * dax + uy * day + uz * daz);

          // 𝒫_pressure_a = −∂_a Π(u)   (Π pre-computed in piBuf)
          let pPress = 0;
          if (a === 0) pPress = -(piBuf[ipFlat] - piBuf[imFlat]) * 0.5;
          else if (a === 1) pPress = -(piBuf[jpFlat] - piBuf[jmFlat]) * 0.5;
          else pPress = -(piBuf[kpFlat] - piBuf[kmFlat]) * 0.5;

          // 𝒢_mass_a = −∂_a Φ
          let gMass = 0;
          if (a === 0) gMass = -(Phi[ipFlat] - Phi[imFlat]) * 0.5;
          else if (a === 1) gMass = -(Phi[jpFlat] - Phi[jmFlat]) * 0.5;
          else gMass = -(Phi[kpFlat] - Phi[kmFlat]) * 0.5;

          const op = FIELD3D_NU * lap - FIELD3D_RICCI * c + pinTerm + advect + pPress + gMass;
          let v = c + FIELD3D_DAMPING * op;
          if (v > FIELD3D_BOUND) v = FIELD3D_BOUND;
          else if (v < -FIELD3D_BOUND) v = -FIELD3D_BOUND;
          next[flat] = v;
        }
      }
    }
    field.axes[a] = next;
  }
  // Pin re-assertion is now part of 𝒪_UQRC above (L_S^pin term).
  // No post-hoc field.axes writes — preserves [𝒟_μ, 𝒟_ν] guarantee.
  field.ticks++;
  return field;
}

/**
 * Discrete commutator norm ‖[𝒟_μ, 𝒟_ν] u‖ averaged over the lattice.
 * This is F_{μν} — the curvature observable. Bounded ↔ smooth evolution.
 */
export function commutatorNorm3D(field: Field3D): number {
  const N = field.N;
  const step = Math.max(1, Math.floor(N / 8));
  let sum = 0;
  let count = 0;
  for (let k = 0; k < N; k += step) {
    for (let j = 0; j < N; j += step) {
      for (let i = 0; i < N; i += step) {
        sum += curvatureAt(field, i, j, k);
        count++;
      }
    }
  }
  return count > 0 ? sum / count : 0;
}

/**
 * Discrete second derivative norm ‖∇_μ ∇_ν S(u)‖ proxy — uses Laplacian magnitude
 * as a cheap stand-in. Used by Q_Score and the debug overlay.
 */
export function entropyHessianNorm3D(field: Field3D): number {
  const N = field.N;
  const step = Math.max(1, Math.floor(N / 8));
  let sum = 0;
  let count = 0;
  for (let a = 0; a < FIELD3D_AXES; a++) {
    const u = field.axes[a];
    for (let k = 0; k < N; k += step) {
      const kp = (k + 1) % N, km = (k + N - 1) % N;
      for (let j = 0; j < N; j += step) {
        const jp = (j + 1) % N, jm = (j + N - 1) % N;
        for (let i = 0; i < N; i += step) {
          const ip = (i + 1) % N, im = (i + N - 1) % N;
          const c = u[i + N * (j + N * k)];
          const lap =
            (u[ip + N * (j + N * k)] + u[im + N * (j + N * k)] - 2 * c) +
            (u[i + N * (jp + N * k)] + u[i + N * (jm + N * k)] - 2 * c) +
            (u[i + N * (j + N * kp)] + u[i + N * (j + N * km)] - 2 * c);
          sum += Math.abs(lap);
          count++;
        }
      }
    }
  }
  return count > 0 ? sum / count : 0;
}

/** Mean curvature norm — global Q_Score proxy. */
export function qScore3D(field: Field3D): number {
  const N = field.N;
  // Sample on a sparse 8³ grid for cheap global estimate.
  let sum = 0;
  let count = 0;
  const step = N / 8;
  for (let k = 0; k < N; k += step) {
    for (let j = 0; j < N; j += step) {
      for (let i = 0; i < N; i += step) {
        sum += curvatureAt(field, i, j, k);
        count++;
      }
    }
  }
  return count > 0 ? sum / count + FIELD3D_LAMBDA : FIELD3D_LAMBDA;
}

/** Curvature heatmap on a single Y-slice — used for the floor mesh. */
export function curvatureSliceY(field: Field3D, y: number, resolution: number = 32): Float32Array {
  const out = new Float32Array(resolution * resolution);
  const scale = field.N / resolution;
  for (let kr = 0; kr < resolution; kr++) {
    for (let ir = 0; ir < resolution; ir++) {
      out[ir + resolution * kr] = curvatureAt(field, ir * scale, y, kr * scale);
    }
  }
  return out;
}

export interface Field3DSnapshot {
  N: number;
  axes: number[][];
  pins: Array<[number, number]>;
  pinTemplate?: number[][];
  pinMask?: number[][];
  ticks: number;
}

export function serializeField3D(field: Field3D): Field3DSnapshot {
  return {
    N: field.N,
    axes: field.axes.map((a) => Array.from(a)),
    pins: Array.from(field.pins.entries()),
    pinTemplate: field.pinTemplate.map((a) => Array.from(a)),
    pinMask: field.pinMask.map((a) => Array.from(a)),
    ticks: field.ticks,
  };
}

export function deserializeField3D(snap: Field3DSnapshot): Field3D {
  const f = createField3D(snap.N);
  for (let a = 0; a < Math.min(FIELD3D_AXES, snap.axes.length); a++) {
    const arr = snap.axes[a];
    const len = Math.min(f.axes[a].length, arr.length);
    for (let i = 0; i < len; i++) f.axes[a][i] = arr[i];
  }
  f.pins = new Map(snap.pins);
  if (snap.pinTemplate) {
    for (let a = 0; a < Math.min(FIELD3D_AXES, snap.pinTemplate.length); a++) {
      const arr = snap.pinTemplate[a];
      const len = Math.min(f.pinTemplate[a].length, arr.length);
      for (let i = 0; i < len; i++) f.pinTemplate[a][i] = arr[i];
    }
  }
  if (snap.pinMask) {
    for (let a = 0; a < Math.min(FIELD3D_AXES, snap.pinMask.length); a++) {
      const arr = snap.pinMask[a];
      const len = Math.min(f.pinMask[a].length, arr.length);
      for (let i = 0; i < len; i++) f.pinMask[a][i] = arr[i];
    }
  } else {
    // Backfill from sparse pins (legacy snapshots)
    for (const [key, target] of f.pins.entries()) {
      const a = (key >>> 24) & 0xff;
      const flat = key & 0xffffff;
      if (a < FIELD3D_AXES) {
        f.pinTemplate[a][flat] = target;
        f.pinMask[a][flat] = 1;
      }
    }
  }
  f.ticks = snap.ticks ?? 0;
  return f;
}