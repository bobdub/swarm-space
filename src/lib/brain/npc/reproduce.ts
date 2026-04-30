/**
 * reproduce — pure gate combining harmony, social standards, and
 * resource availability. Returns either a child PersonalitySeed or a
 * typed reason. The engine is responsible for actually placing the
 * gestation block and (later) spawning the offspring.
 */
import { GESTATION_RESERVE, type Npc, type PersonalitySeed, type RelationalEdge } from './npcTypes';
import { harmonyOk } from './relations';
import { canBond, type StandardsContext } from './socialStandards';
import { mergeSeeds } from './personalitySeed';

export type ReproduceBlockedReason =
  | 'no-harmony'
  | 'standards-blocked'
  | 'insufficient-resources'
  | 'duplicate-seed';

export interface ReproduceArgs {
  parentA: Npc;
  parentB: Npc;
  edge: RelationalEdge;
  reservesA: number;
  reservesB: number;
  standardsCtx: StandardsContext;
  isSeedUnique: (seed: PersonalitySeed) => boolean;
  driftSeed: string;
}

export type ReproduceResult =
  | { allowed: true; childSeed: PersonalitySeed }
  | { allowed: false; reason: ReproduceBlockedReason };

export function tryReproduce(args: ReproduceArgs): ReproduceResult {
  if (!harmonyOk(args.edge)) return { allowed: false, reason: 'no-harmony' };
  const bond = canBond(args.parentA, args.parentB, args.standardsCtx);
  if (!bond.allowed) return { allowed: false, reason: 'standards-blocked' };
  if (args.reservesA < GESTATION_RESERVE || args.reservesB < GESTATION_RESERVE) {
    return { allowed: false, reason: 'insufficient-resources' };
  }
  const candidate = mergeSeeds(args.parentA.seed, args.parentB.seed, args.driftSeed);
  if (!args.isSeedUnique(candidate)) {
    return { allowed: false, reason: 'duplicate-seed' };
  }
  return { allowed: true, childSeed: candidate };
}