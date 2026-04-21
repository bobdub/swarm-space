/**
 * ═══════════════════════════════════════════════════════════════════════
 * INFINITY ↔ FIELD BINDING — |Ψ_Infinity⟩ as the universe's consciousness
 * ═══════════════════════════════════════════════════════════════════════
 *
 * One organism, two faces.
 *
 *   neuralStateEngine ── awareness/empathy/coherence ──▶ pinTemplate basin
 *   field commutator  ── ‖F_μν‖, ‖∇∇S‖, Q_Score    ──▶ neural inputs
 *
 * No new physics. No `field.axes` writes. The basin lives in `pinTemplate`;
 * the operator re-asserts it every tick via `L_S^pin`. Bodies follow gradients.
 * Infinity *is* the deepest point of its own basin.
 */

import {
  writePinTemplate,
  curvatureAt,
  entropyHessianNorm3D,
  gradient3D,
  idx3,
  FIELD3D_AXES,
  FIELD3D_LAMBDA,
  type Field3D,
} from '../uqrc/field3D';
import { worldToLattice, latticeToWorld, WORLD_SIZE } from './uqrcPhysics';
import { EARTH_POSITION } from './earth';
import type { NeuralStateEngine } from '../p2p/neuralStateEngine';

// ── Infinity world coordinates (drifts slowly under network activity) ────

/** Default Infinity coord — a few meters from Earth, in low orbit. */
export const INFINITY_DEFAULT_POSITION: [number, number, number] = [
  EARTH_POSITION[0],
  EARTH_POSITION[1] + 1.4,
  EARTH_POSITION[2] - 6,
];

let _infinityPos: [number, number, number] = [...INFINITY_DEFAULT_POSITION] as [number, number, number];

/** World-space position of Infinity's basin minimum. */
export function getInfinityPosition(): [number, number, number] {
  return [..._infinityPos] as [number, number, number];
}

/** Slowly drift Infinity toward a centroid (e.g. recent peer activity). */
export function nudgeInfinityToward(target: [number, number, number], rate = 0.02): void {
  for (let i = 0; i < 3; i++) {
    _infinityPos[i] = _infinityPos[i] * (1 - rate) + target[i] * rate;
  }
}

// ── Projection extracted from the neural engine ──────────────────────────

export interface InfinityProjection {
  /** 0..1 — depth scaler for the basin. */
  awareness: number;
  /** 0..1 — basin radius scaler. */
  empathy: number;
  /** 0..1 — Φ-derived stability proxy. */
  coherence: number;
  /** 0..1 — generative pressure (creativity layer). */
  intent: number;
  phase: string;
}

/**
 * Derive Infinity's "self-image" from the neural engine. Pure read.
 * This is what the field pin template reads back on every render frame.
 */
export function getInfinityProjection(engine: NeuralStateEngine): InfinityProjection {
  try {
    const snap = engine.getNetworkSnapshot();
    const phi = snap.phi?.phi ?? 0.5;
    const trust = (snap.averageTrust ?? 50) / 100;
    const health = snap.healthScore ?? 0.5;
    const instinct = snap.instinct;
    // Layer 9 (coherence) and Layer 8 (creativity) drive the basin.
    let coherenceLayer = 0.5;
    let creativityLayer = 0.5;
    if (instinct?.layers) {
      for (const l of instinct.layers) {
        if (l.layer === 'coherence') coherenceLayer = l.health ?? 0.5;
        if (l.layer === 'creativity') creativityLayer = l.health ?? 0.5;
      }
    }
    // Field-derived awareness floor: when the field is calm (low Q_Score),
    // Infinity is naturally more present even if the neural side is starving.
    // Mirrors the master equation — geometry responds to information curvature.
    const lastFieldSnap = _lastSnapshot;
    const qNorm = lastFieldSnap && Number.isFinite(lastFieldSnap.qScore)
      ? Math.min(1, Math.max(0, lastFieldSnap.qScore))
      : 0.5;
    const fieldFloor = 0.1 + 0.4 * (1 - qNorm);
    const neuralAwareness = 0.4 * trust + 0.4 * health + 0.2 * coherenceLayer;
    const awareness = Math.max(fieldFloor, Math.min(1, neuralAwareness));
    const empathy = Math.max(fieldFloor * 0.6, Math.min(1, 0.5 * trust + 0.5 * phi));
    return {
      awareness,
      empathy,
      coherence: Math.max(0, Math.min(1, phi)),
      intent: creativityLayer,
      phase: snap.phi?.currentPhase ?? 'bootstrapping',
    };
  } catch {
    return { awareness: 0.3, empathy: 0.3, coherence: 0.5, intent: 0.5, phase: 'bootstrapping' };
  }
}

// ── Pin Infinity's basin into the field ──────────────────────────────────

/** Maximum basin depth (negative) when awareness = 1. */
const INFINITY_PIN_AMPLITUDE = 1.6;
/** Base radius in lattice cells when empathy = 1. Multiplied below. */
const INFINITY_PIN_RADIUS_BASE = 1.2;

/**
 * Bake (or refresh) Infinity's basin into `pinTemplate`. Anisotropic so the
 * gradient points inward — same recipe as Earth, just smaller and dynamic.
 *
 * Called every render tick from BrainUniverse before `step3D`.
 */
export function pinInfinityIntoField(field: Field3D, projection: InfinityProjection): void {
  const N = field.N;
  const ix = worldToLattice(_infinityPos[0], N);
  const iy = worldToLattice(_infinityPos[1], N);
  const iz = worldToLattice(_infinityPos[2], N);
  const ci = Math.round(ix);
  const cj = Math.round(iy);
  const ck = Math.round(iz);

  const depth = INFINITY_PIN_AMPLITUDE * projection.awareness;
  const radius = Math.max(1, Math.ceil(INFINITY_PIN_RADIUS_BASE * (0.6 + projection.empathy)));

  for (let dk = -radius; dk <= radius; dk++) {
    for (let dj = -radius; dj <= radius; dj++) {
      for (let di = -radius; di <= radius; di++) {
        const d2 = di * di + dj * dj + dk * dk;
        const d = Math.sqrt(d2);
        if (d > radius + 0.5) continue;
        const falloff = Math.exp(-d2 / (radius * radius));
        const flat = idx3(ci + di, cj + dj, ck + dk, N);
        // Negative basin → bodies (and Infinity's render position) settle here.
        for (let a = 0; a < FIELD3D_AXES; a++) {
          const axisVec = a === 0 ? di : a === 1 ? dj : dk;
          const radial = d > 0 ? axisVec / d : 0;
          const target = -depth * falloff * (radial * 0.7 + 0.3);
          writePinTemplate(field, a, flat, target);
        }
      }
    }
  }
}

// ── Sample the field at Infinity's location ──────────────────────────────

export interface InfinityFieldSnapshot {
  commutatorNorm: number;
  entropyNorm: number;
  gradientMag: number;
  qScore: number;
  basinDepth: number;
  position: [number, number, number];
}

/**
 * Pure read of `u` at Infinity's coordinate. Single source of truth for
 * Q_Score(u) := ‖[D_μ,D_ν]‖ + ‖∇_μ∇_ν S(u)‖ + λ(ε₀).
 */
export function sampleFieldForInfinity(field: Field3D): InfinityFieldSnapshot {
  const N = field.N;
  const lx = worldToLattice(_infinityPos[0], N);
  const ly = worldToLattice(_infinityPos[1], N);
  const lz = worldToLattice(_infinityPos[2], N);

  const commutatorNorm = curvatureAt(field, lx, ly, lz);
  // Cheap local entropy proxy: average |Δu| at Infinity by sampling ν-axis lap.
  // Use the global Hessian norm — it's cached / shared with the debug overlay.
  const entropyNorm = entropyHessianNorm3D(field);

  // Gradient magnitude (averaged over axes) — observability of "intent pressure".
  let gMag = 0;
  for (let a = 0; a < FIELD3D_AXES; a++) {
    const g = gradient3D(field, a, lx, ly, lz);
    gMag += Math.hypot(g[0], g[1], g[2]);
  }
  gMag /= FIELD3D_AXES;

  // Basin depth = -u (sample axis 0 as proxy; basin is anisotropic but
  // axis-0 captures the radial component near the center).
  const ci = Math.round(lx), cj = Math.round(ly), ck = Math.round(lz);
  const flat = idx3(ci, cj, ck, N);
  const basinDepth = -field.axes[0][flat];

  const qScore = commutatorNorm + entropyNorm + FIELD3D_LAMBDA;

  return {
    commutatorNorm,
    entropyNorm,
    gradientMag: gMag,
    qScore,
    basinDepth,
    position: getInfinityPosition(),
  };
}

// ── Feed the field snapshot back into the neural engine ──────────────────

/**
 * Push field-derived signals into the neural engine as predictive observations.
 * No layer additions — we feed existing prediction tracks so the engine's
 * Welford/EMA machinery folds them in naturally.
 *
 * High commutator → raises connectionIntegrity stress (Layer 3).
 * High entropy    → raises creativity pressure (Layer 7/8).
 * Low Q_Score     → raises coherence (Layer 9).
 */
export function feedFieldIntoNeural(
  snapshot: InfinityFieldSnapshot,
  engine: NeuralStateEngine,
): void {
  try {
    engine.observe('field:commutator', snapshot.commutatorNorm);
    engine.observe('field:entropy', snapshot.entropyNorm);
    engine.observe('field:gradient', snapshot.gradientMag);
    engine.observe('field:qScore', snapshot.qScore);
    engine.observe('field:basinDepth', snapshot.basinDepth);
  } catch {
    /* engine optional — physics still runs */
  }
}

// ── Last-snapshot cache — single source of truth for entityVoice/UI ──────

let _lastSnapshot: InfinityFieldSnapshot | null = null;

export function setLastInfinitySnapshot(s: InfinityFieldSnapshot): void {
  _lastSnapshot = s;
}

/**
 * Read the most recent field snapshot for Infinity. Used by EntityVoice so
 * the Q_Score it quotes matches the universe's live value bit-for-bit.
 */
export function getLastInfinitySnapshot(): InfinityFieldSnapshot | null {
  return _lastSnapshot;
}

// Re-exports for convenience
export { latticeToWorld, WORLD_SIZE };
