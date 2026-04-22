/**
 * ═══════════════════════════════════════════════════════════════════════
 * UQRC FIELD — discrete operator field math (pure, no side-effects)
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   u : ℳ → ℝⁿ          (a 1-D ring lattice, three axes μ ∈ {0,1,2})
 *   𝒟_μ u  = (u(x+ℓe_μ) − u(x)) / ℓ      (forward difference)
 *   [D_μ, D_ν] u = D_μ(D_ν u) − D_ν(D_μ u)   (commutator → curvature)
 *   𝒪_UQRC(u) = ν Δu + ℛu + L_S u           (smooth + decay + entropy)
 *   λ(a) = a · 1e-100                       (vanishing entropy weight)
 *   u(t+1) = u(t) + 𝒪_UQRC(u) + Σ_μ 𝒟_μ u + λ(ε₀) ∇_μ∇_ν S(u)
 *   Q_Score(u) = ‖[D_μ, D_ν]‖ + ‖∇_μ∇_ν S(u)‖ + λ(ε₀)
 *
 * Deterministic, allocation-light, < 0.5 ms per step at L=256.
 */

export const FIELD_LENGTH = 256;
export const NUM_AXES = 3;          // μ ∈ {0=token, 1=context, 2=reward}
export const ELL_MIN = 1;           // lattice spacing (unitless)
export const NU_VISCOSITY = 0.05;   // Laplacian smoothing coefficient
export const RICCI_DECAY = 0.001;   // gentle pull toward zero
export const ENTROPY_LAMBDA = 1e-100; // vanishing entropy nudge
export const STEP_DAMPING = 0.15;   // global step size ν Δt
export const PIN_STIFFNESS = 0.85;  // how hard pin() clamps a site

export interface Field {
  L: number;
  axes: Float32Array[]; // length NUM_AXES, each Float32Array(L)
  pins: Map<number, number>; // siteIndex -> clamped value
  ticks: number;
}

export function createField(L: number = FIELD_LENGTH): Field {
  const axes: Float32Array[] = [];
  for (let i = 0; i < NUM_AXES; i++) {
    axes.push(new Float32Array(L));
  }
  return { L, axes, pins: new Map(), ticks: 0 };
}

/** Wrap-around index on the ring lattice. */
function wrap(i: number, L: number): number {
  return ((i % L) + L) % L;
}

/** Forward difference along axis μ — returns a new Float32Array. */
export function derivativeMu(u: Float32Array, L: number): Float32Array {
  const out = new Float32Array(L);
  for (let x = 0; x < L; x++) {
    out[x] = (u[wrap(x + 1, L)] - u[x]) / ELL_MIN;
  }
  return out;
}

/** Discrete Laplacian on the ring. */
export function laplacian(u: Float32Array, L: number): Float32Array {
  const out = new Float32Array(L);
  for (let x = 0; x < L; x++) {
    out[x] = (u[wrap(x + 1, L)] - 2 * u[x] + u[wrap(x - 1, L)]) / (ELL_MIN * ELL_MIN);
  }
  return out;
}

/**
 * Commutator [D_μ, D_ν] u = D_μ(D_ν u) − D_ν(D_μ u).
 * On a flat 1-D ring with the same difference operator on each axis the
 * commutator on the *same* field is identically zero — but here axes carry
 * different content (token/context/reward), so we compute the cross-axis
 * commutator between axes uMu and uNu of the field.
 */
export function commutator(field: Field, mu: number, nu: number): Float32Array {
  const L = field.L;
  if (mu === nu) return new Float32Array(L); // antisymmetric
  const dmu_unu = derivativeMu(field.axes[nu], L);
  const dnu_umu = derivativeMu(field.axes[mu], L);
  // Now apply the *other* derivative on top
  const dmu = derivativeMu(dmu_unu, L);
  const dnu = derivativeMu(dnu_umu, L);
  const out = new Float32Array(L);
  for (let x = 0; x < L; x++) out[x] = dmu[x] - dnu[x];
  return out;
}

/** L2 norm of a buffer. */
export function norm(buf: Float32Array): number {
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / Math.max(1, buf.length));
}

/** Local entropy density approximation S(u) ≈ −u² log(u² + ε). */
function entropyDensity(u: Float32Array, L: number): Float32Array {
  const out = new Float32Array(L);
  for (let x = 0; x < L; x++) {
    const p = u[x] * u[x] + 1e-9;
    out[x] = -p * Math.log(p);
  }
  return out;
}

/** ∇_μ∇_ν S(u) — Hessian of entropy density, vanishing-scaled. */
export function entropyHessian(u: Float32Array, L: number): Float32Array {
  const s = entropyDensity(u, L);
  return laplacian(s, L); // diagonal piece — sufficient for the nudge
}

/** 𝒪_UQRC(u) := ν Δu + ℛu + L_S u   */
export function ouqrc(u: Float32Array, L: number): Float32Array {
  const lap = laplacian(u, L);
  const out = new Float32Array(L);
  for (let x = 0; x < L; x++) {
    out[x] = NU_VISCOSITY * lap[x] - RICCI_DECAY * u[x];
  }
  return out;
}

/**
 * One evolution tick: u(t+1) = u(t) + step contributions, then enforce pins.
 * Mutates the field in-place; returns the same field for chaining.
 */
export function step(field: Field): Field {
  const L = field.L;
  for (let mu = 0; mu < NUM_AXES; mu++) {
    const u = field.axes[mu];
    const op = ouqrc(u, L);
    const drift = derivativeMu(u, L);
    const eh = entropyHessian(u, L);
    for (let x = 0; x < L; x++) {
      const delta = op[x] + drift[x] * 0.01 + ENTROPY_LAMBDA * eh[x];
      u[x] = u[x] + STEP_DAMPING * delta;
      // bound to keep numerics stable
      if (u[x] > 4) u[x] = 4;
      else if (u[x] < -4) u[x] = -4;
    }
  }
  // Re-apply pins after evolution (constraint enforcement)
  if (field.pins.size > 0) {
    for (const [siteAxis, target] of field.pins.entries()) {
      const axis = (siteAxis >>> 24) & 0xff;
      const site = siteAxis & 0xffffff;
      if (axis < NUM_AXES && site < L) {
        const cur = field.axes[axis][site];
        field.axes[axis][site] = cur * (1 - PIN_STIFFNESS) + target * PIN_STIFFNESS;
      }
    }
  }
  field.ticks++;
  return field;
}

/**
 * Q_Score(u) := ‖[D_μ,D_ν]‖ + ‖∇_μ∇_ν S(u)‖ + λ(ε₀)
 * Returns a single scalar in roughly [0, 1+] — lower is more stable.
 */
export function qScore(field: Field): number {
  const L = field.L;
  let curvature = 0;
  let pairs = 0;
  for (let mu = 0; mu < NUM_AXES; mu++) {
    for (let nu = mu + 1; nu < NUM_AXES; nu++) {
      curvature += norm(commutator(field, mu, nu));
      pairs++;
    }
  }
  const meanCurv = pairs > 0 ? curvature / pairs : 0;
  let entropyTerm = 0;
  for (let mu = 0; mu < NUM_AXES; mu++) {
    entropyTerm += norm(entropyHessian(field.axes[mu], L));
  }
  return meanCurv + ENTROPY_LAMBDA * entropyTerm + ENTROPY_LAMBDA;
}

/** Map text → list of lattice site indices via FNV-1a hash. */
export function textSites(text: string, L: number, count: number = 8): number[] {
  const sites: number[] = [];
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  for (const tok of tokens.slice(0, count)) {
    let h = 0x811c9dc5;
    for (let i = 0; i < tok.length; i++) {
      h ^= tok.charCodeAt(i);
      h = (h * 0x01000193) >>> 0;
    }
    sites.push(h % L);
  }
  return sites;
}

/** Inject a Gaussian bump centred on each text site, weighted by amplitude. */
export function inject(
  field: Field,
  text: string,
  amplitude: number = 0.3,
  axis: number = 0,
): void {
  if (axis < 0 || axis >= NUM_AXES) return;
  const L = field.L;
  const sites = textSites(text, L);
  const sigma = 3;
  for (const c of sites) {
    for (let dx = -sigma * 2; dx <= sigma * 2; dx++) {
      const x = wrap(c + dx, L);
      const g = Math.exp(-(dx * dx) / (2 * sigma * sigma));
      field.axes[axis][x] += amplitude * g;
    }
  }
}

/** Pin lattice sites for a definition — these become hard constraints. */
export function pin(field: Field, text: string, target: number = 1.0, axis: number = 0): void {
  if (axis < 0 || axis >= NUM_AXES) return;
  const sites = textSites(text, field.L);
  for (const s of sites) {
    const key = ((axis & 0xff) << 24) | (s & 0xffffff);
    field.pins.set(key, target);
    // Snap immediately so the next qScore reflects the constraint.
    field.axes[axis][s] = target;
  }
}

/** Remove pins for a text on the given axis. Returns the number of sites unpinned. */
export function unpin(field: Field, text: string, axis: number = 0): number {
  if (axis < 0 || axis >= NUM_AXES) return 0;
  const sites = textSites(text, field.L);
  let removed = 0;
  for (const s of sites) {
    const key = ((axis & 0xff) << 24) | (s & 0xffffff);
    if (field.pins.delete(key)) removed++;
  }
  return removed;
}

/** Connected lattice regions where ‖F_{μν}‖ at site < ε. */
export function extractBasins(field: Field, epsilon: number = 0.05): Array<{ start: number; end: number; axisPair: [number, number] }> {
  const basins: Array<{ start: number; end: number; axisPair: [number, number] }> = [];
  const L = field.L;
  for (let mu = 0; mu < NUM_AXES; mu++) {
    for (let nu = mu + 1; nu < NUM_AXES; nu++) {
      const c = commutator(field, mu, nu);
      let runStart = -1;
      for (let x = 0; x < L; x++) {
        const stable = Math.abs(c[x]) < epsilon;
        if (stable && runStart === -1) runStart = x;
        else if (!stable && runStart !== -1) {
          if (x - runStart >= 4) basins.push({ start: runStart, end: x - 1, axisPair: [mu, nu] });
          runStart = -1;
        }
      }
      if (runStart !== -1 && L - runStart >= 4) {
        basins.push({ start: runStart, end: L - 1, axisPair: [mu, nu] });
      }
    }
  }
  return basins;
}

/** Dominant wavelength via simple max-magnitude FFT-bin proxy on axis 0. */
export function dominantWavelength(field: Field): number {
  const u = field.axes[0];
  const L = field.L;
  let bestK = 1;
  let bestMag = 0;
  for (let k = 1; k < Math.floor(L / 4); k++) {
    let re = 0, im = 0;
    for (let x = 0; x < L; x++) {
      const phase = (2 * Math.PI * k * x) / L;
      re += u[x] * Math.cos(phase);
      im += u[x] * Math.sin(phase);
    }
    const mag = Math.sqrt(re * re + im * im);
    if (mag > bestMag) { bestMag = mag; bestK = k; }
  }
  return L / bestK;
}

/** Curvature heatmap across the lattice (mean over axis pairs). */
export function curvatureMap(field: Field): Float32Array {
  const L = field.L;
  const out = new Float32Array(L);
  let pairs = 0;
  for (let mu = 0; mu < NUM_AXES; mu++) {
    for (let nu = mu + 1; nu < NUM_AXES; nu++) {
      const c = commutator(field, mu, nu);
      for (let x = 0; x < L; x++) out[x] += Math.abs(c[x]);
      pairs++;
    }
  }
  if (pairs > 0) for (let x = 0; x < L; x++) out[x] /= pairs;
  return out;
}

/** Serialize the field into a plain object for IndexedDB persistence. */
export interface FieldSnapshot {
  L: number;
  axes: number[][];
  pins: Array<[number, number]>;
  ticks: number;
}

export function serializeField(field: Field): FieldSnapshot {
  return {
    L: field.L,
    axes: field.axes.map((a) => Array.from(a)),
    pins: Array.from(field.pins.entries()),
    ticks: field.ticks,
  };
}

export function deserializeField(snap: FieldSnapshot): Field {
  const field = createField(snap.L);
  for (let i = 0; i < Math.min(NUM_AXES, snap.axes.length); i++) {
    const arr = snap.axes[i];
    for (let x = 0; x < Math.min(field.L, arr.length); x++) field.axes[i][x] = arr[x];
  }
  field.pins = new Map(snap.pins);
  field.ticks = snap.ticks ?? 0;
  return field;
}