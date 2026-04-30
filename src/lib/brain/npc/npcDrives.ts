/**
 * npcDrives — pure utility-table choosing one drive per tick.
 *
 * No Field access here. The engine samples the field through the same
 * bridge pattern used by chainHealthBridge and feeds scalars in. This
 * keeps drives deterministic, unit-testable, and free of side effects.
 */
import type { Npc, NpcDrive, PersonalitySeed } from './npcTypes';

/** Scalar inputs the engine samples around an NPC. All in [0, 1] except deficits. */
export interface DriveSignals {
  hydrationDeficit: number;        // 0 = fully hydrated, 1 = critical
  energyDeficit: number;           // same
  preyGradient: number;            // ∇ toward huntable bodies
  fishGradient: number;            // ∇ toward fishable water bodies
  resourceGradient: number;        // ∇ toward gather-able clusters
  cropNeglectTimer: number;        // 0 = just tended, 1 = overdue
  craftReadiness: number;          // inventory + workbench proximity
  socialAlignment: number;         // best-neighbour relational alignment
  fatigue: number;                 // accumulated curvature exposure
  hasTool: boolean;                // tool-ownership flag
}

function score(signal: number, weight: number): number {
  return Math.max(0, Math.min(1, signal)) * weight;
}

/** Choose one drive — argmax of personality-weighted utilities. */
export function chooseIntent(seed: PersonalitySeed, sig: DriveSignals): NpcDrive {
  const utils: Array<[NpcDrive, number]> = [
    ['drink', score(sig.hydrationDeficit, 1.20)],
    ['eat',   score(sig.energyDeficit,    1.15)],
    ['hunt',  score(sig.preyGradient,     0.6 + 0.4 * Math.max(0, seed.riskTolerance)) * (sig.hasTool ? 1 : 0.5)],
    ['fish',  score(sig.fishGradient,     0.55 + 0.3 * Math.max(0, seed.curiosity))    * (sig.hasTool ? 1 : 0.7)],
    ['gather',score(sig.resourceGradient, 0.6 + 0.3 * Math.max(0, seed.empathy))],
    ['grow',  score(sig.cropNeglectTimer, 0.5 + 0.4 * Math.max(0, seed.empathy))],
    ['craft', score(sig.craftReadiness,   0.5 + 0.5 * Math.max(0, seed.inventiveHarmony))],
    ['socialise', score(sig.socialAlignment, 0.4 + 0.6 * Math.max(0, seed.relationalWarmth))],
    ['rest',  score(sig.fatigue,          0.95)],
  ];
  let bestDrive: NpcDrive = 'rest';
  let bestScore = -Infinity;
  for (const [d, s] of utils) {
    if (s > bestScore) { bestScore = s; bestDrive = d; }
  }
  return bestDrive;
}

/** Convenience overload for an Npc record. */
export function chooseDriveForNpc(npc: Npc, sig: DriveSignals): NpcDrive {
  return chooseIntent(npc.seed, sig);
}