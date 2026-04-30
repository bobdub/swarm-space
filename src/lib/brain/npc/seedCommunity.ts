/**
 * seedCommunity — initial 8-NPC seed roster (5 females + 3 males).
 *
 * Pure data. Consumed by a future boot wiring patch:
 *   for (const s of INITIAL_NPCS) await npcEngine.spawnNpc(s);
 * Uniqueness is handled by npcRegistry; if drift / hash collision
 * causes a duplicate, the registry returns `duplicate-personality`
 * and the boot loop reseeds with `reseedUntilUnique`.
 */
import { INITIAL_FEMALES, INITIAL_MALES, type NpcSex } from './npcTypes';

export interface SeedSpec {
  name: string;
  sex: NpcSex;
  /** String fed into seedFromString → PersonalitySeed. */
  baseString: string;
}

const FEMALE_NAMES = ['Aria', 'Beth', 'Cleo', 'Dawn', 'Eve'];
const MALE_NAMES = ['Ash', 'Bren', 'Cai'];

function check(): void {
  if (FEMALE_NAMES.length !== INITIAL_FEMALES) {
    throw new Error(`[seedCommunity] expected ${INITIAL_FEMALES} female names`);
  }
  if (MALE_NAMES.length !== INITIAL_MALES) {
    throw new Error(`[seedCommunity] expected ${INITIAL_MALES} male names`);
  }
}
check();

export const INITIAL_NPCS: SeedSpec[] = [
  ...FEMALE_NAMES.map<SeedSpec>((name) => ({ name, sex: 'female', baseString: `npc:${name}` })),
  ...MALE_NAMES.map<SeedSpec>((name) => ({ name, sex: 'male',   baseString: `npc:${name}` })),
];