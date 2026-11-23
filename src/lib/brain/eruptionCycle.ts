/**
 * eruptionCycle — when the shared volcano is quiet, building, erupting or
 * draining, read from the shared Earth clock so every peer sees the same
 * eruption at the same moment.
 *
 * Physics, simplified:
 *
 * - Recharge. Mantle melt feeds a crustal chamber under the vent. The
 *   column's overpressure p (0 … 1, 1 = the rock above fails) builds as
 *   (τ/τ_on)³: slowly at first, then faster, because rising magma
 *   decompresses, exsolves gas and grows more buoyant (a runaway, not a
 *   steady climb). The head of the column sits `REST_DEPTH_M` down the
 *   conduit and rises hydrostatically with p (Δh = ΔP / ρg), so for most of
 *   the cycle you only see it by looking straight down the vent.
 * - Eruption. At p = 1 magma reaches the crater floor, ponds and spills over
 *   the lowest part of the summit. Effusion then wanes exponentially as the
 *   chamber relaxes (Wadge 1981), for `durationS`.
 * - Drain. Supply stops; the pond drains back down the conduit and the
 *   flows on the flank crust over and cool.
 *
 * The cycle is `ERUPTION_CYCLE_S` long. Each cycle's onset and intensity
 * come from an integer hash of its index, so eruptions are irregular but
 * the same on every device. Intensity also scales with the mantle supply
 * under the vent (`ventSupplyPressure`, the mantle loop's steady state,
 * around which `getMantlePressure()` swings with this cycle), so a
 * stronger mantle feeds bigger eruptions and longer flows.
 *
 * Pure: no state, no writes. Safe to call per frame.
 */
import { GAME_DAY_SECONDS } from './earth';
import { ventSupplyPressure } from './lavaMantle';
import { STROMBOLIAN_PERIOD_S, magmaHeadAt, slugPhaseAt } from './magmaConduit';
import type { VolcanoOrgan } from './volcanoOrgan';

/** Seconds from one cycle's start to the next, on the shared clock: one
 *  eruption per game week (one real day). Between eruptions the magma
 *  rests down the conduit and the flank flows cool and weather away, so
 *  lava only runs down the volcano when it has erupted recently. */
export const ERUPTION_CYCLE_S = 7 * GAME_DAY_SECONDS;
/** Depth (m) below the crater floor where the column rests when quiet. */
export const REST_DEPTH_M = 42;
/** Pond level (m) above the crater-frame origin while effusing. */
export const POND_LEVEL_M = 0.6;
/** Seconds for the pond to drain back down the conduit. */
export const DRAIN_S = 120;
/** Seconds the pond takes to fill once magma reaches the floor. */
const FILL_S = 12;
/** Faint white fumarole steam that never fully stops. */
export const FUMAROLE_STEAM = 0.16;

export type EruptionPhase = 'quiet' | 'unrest' | 'eruption' | 'waning';

export interface EruptionCycle {
  /** Cycle index (floor(t / ERUPTION_CYCLE_S)). */
  index: number;
  /** Shared time the cycle starts. */
  startS: number;
  /** Seconds into the cycle when magma reaches the floor. */
  onsetS: number;
  /** Seconds the effusion lasts. */
  durationS: number;
  /** 0.3 … 1: how strong this eruption is. */
  intensity: number;
}

export interface EruptionState {
  phase: EruptionPhase;
  /** Overpressure of the column, 0 … 1 (1 at onset). */
  pressure: number;
  /** Column head (m) relative to the crater-frame origin; negative = down
   *  the conduit. */
  level: number;
  /** Effusion rate relative to this eruption's peak (0 … 1). */
  effusion: number;
  /** Seconds since this cycle's eruption began (negative before it). */
  sinceOnsetS: number;
  /** Seconds since effusion stopped (negative before it). */
  sinceEndS: number;
  cycle: EruptionCycle;
}

/** Integer hash → [0, 1). Bit-exact on every JS engine (no Math.sin). */
export function cycleHash(k: number, salt: number): number {
  let h = Math.imul((k | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt | 0, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function eruptionCycleAt(index: number): EruptionCycle {
  const supply = ventSupplyPressure();
  const u1 = cycleHash(index, 1);
  const u2 = cycleHash(index, 2);
  const intensity = Math.max(0.3, Math.min(1, (0.6 + 0.4 * u2) * (0.45 + 0.8 * supply)));
  return {
    index,
    startS: index * ERUPTION_CYCLE_S,
    // Dormant for most of the cycle: 68–76 % of it is recharge.
    onsetS: ERUPTION_CYCLE_S * (0.68 + 0.08 * u1),
    durationS: 100 + 80 * intensity,
    intensity,
  };
}

function smooth01(x: number): number {
  const u = Math.max(0, Math.min(1, x));
  return u * u * (3 - 2 * u);
}

/** The volcano's state at shared time `t` (seconds). */
export function eruptionStateAt(t: number): EruptionState {
  const index = Math.floor(t / ERUPTION_CYCLE_S);
  const cycle = eruptionCycleAt(index);
  const tau = t - cycle.startS;
  const sinceOnsetS = tau - cycle.onsetS;
  const sinceEndS = sinceOnsetS - cycle.durationS;

  if (sinceOnsetS < 0) {
    const pressure = Math.pow(Math.max(0, tau / cycle.onsetS), 3);
    return {
      phase: pressure > 0.35 ? 'unrest' : 'quiet',
      pressure,
      level: -REST_DEPTH_M * (1 - pressure),
      effusion: 0,
      sinceOnsetS,
      sinceEndS,
      cycle,
    };
  }
  if (sinceEndS < 0) {
    // Exponentially waning effusion, e-folding over half the eruption.
    const effusion = Math.exp(-sinceOnsetS / (cycle.durationS * 0.5));
    return {
      phase: 'eruption',
      pressure: effusion,
      level: POND_LEVEL_M * smooth01(sinceOnsetS / FILL_S),
      effusion,
      sinceOnsetS,
      sinceEndS,
      cycle,
    };
  }
  const drained = smooth01(sinceEndS / DRAIN_S);
  return {
    phase: sinceEndS < DRAIN_S ? 'waning' : 'quiet',
    pressure: 0,
    level: POND_LEVEL_M - (POND_LEVEL_M + REST_DEPTH_M) * drained,
    effusion: 0,
    sinceOnsetS,
    sinceEndS,
    cycle,
  };
}

/**
 * Where the top of the magma column is (m, crater frame) at shared time
 * `t`: the cycle's level plus the slug swell and the tide at the vent.
 */
export function magmaLevelAt(organ: VolcanoOrgan, t: number): number {
  return eruptionStateAt(t).level + magmaHeadAt(organ, t);
}

/** How hot the vent looks, 0 (cold, deep) … 1 (erupting). Drives lights. */
export function ventGlowAt(t: number): number {
  const s = eruptionStateAt(t);
  // Radiant heat from the head falls off as it sinks down the conduit.
  const depth = Math.max(0, -s.level);
  const head = Math.exp(-depth / 14);
  return Math.max(0.04, Math.min(1, head * (0.55 + 0.45 * s.cycle.intensity) + 0.3 * s.effusion));
}

export interface VentEmissionState {
  /** Dark ash and tephra, 0 … 1. Only while erupting or venting slugs. */
  ash: number;
  /** White steam and fumarole gas, 0 … 1. */
  steam: number;
}

/**
 * What leaves the vent at shared time `t`: mostly faint white fumarole
 * steam; more steam as the column degasses under pressure; brief ash puffs
 * when a gas slug bursts near the surface during unrest; dark ash billows
 * only while erupting; heavy steam from the cooling flows afterwards.
 */
export function ventEmissionAt(t: number): VentEmissionState {
  const s = eruptionStateAt(t);
  if (s.phase === 'eruption') {
    return {
      ash: Math.min(1, (0.5 + 0.5 * s.effusion) * (0.7 + 0.3 * s.cycle.intensity)),
      steam: 0.25,
    };
  }
  if (s.sinceEndS >= 0) {
    return {
      ash: 0.8 * Math.exp(-s.sinceEndS / 25),
      steam: FUMAROLE_STEAM + 0.6 * Math.exp(-s.sinceEndS / 300),
    };
  }
  const p = s.pressure;
  const burstAge = slugPhaseAt(t) * STROMBOLIAN_PERIOD_S;
  // Slugs only throw ash once the head is close enough to the surface.
  const puff = smooth01((p - 0.7) / 0.3) * Math.exp(-burstAge / 6);
  return { ash: 0.55 * puff, steam: FUMAROLE_STEAM + 0.4 * p * p };
}
