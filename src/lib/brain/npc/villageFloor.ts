/**
 * villageFloor — keeps the local village from dwindling to a dead end.
 *
 * The NPC village is simulated and saved per device (IndexedDB
 * `swarm-npcs`), and NPCs age and die. Only a female × male pair can
 * have children, so once a device is down to one NPC (or only one sex)
 * the village can never recover, and that small roster is saved and
 * restored on every visit. When the village drops below VILLAGE_FLOOR or
 * loses its last breeding pair, this tops it back up with starter
 * newcomers whose names aren't taken.
 */
import { spawnNpc } from './npcEngine';
import { listNpcs } from './npcRegistry';
import { INITIAL_NPCS } from './seedCommunity';
import type { Npc } from './npcTypes';

/** Below this headcount the village is topped back up. */
export const VILLAGE_FLOOR = 4;

/** True when the village still has at least one female and one male. */
export function hasBreedingPair(roster: Npc[] = listNpcs()): boolean {
  let female = false;
  let male = false;
  for (const n of roster) {
    if (n.sex === 'female') female = true;
    else if (n.sex === 'male') male = true;
    if (female && male) return true;
  }
  return false;
}

/** True when the village is below the floor or has no breeding pair. */
export function needsTopUp(roster: Npc[] = listNpcs()): boolean {
  return roster.length < VILLAGE_FLOOR || !hasBreedingPair(roster);
}

/**
 * When the village is below VILLAGE_FLOOR or has no breeding pair, spawn
 * starter NPCs (skipping names already present) until it has at least
 * VILLAGE_FLOOR NPCs and a breeding pair. Returns how many were spawned.
 * Never throws.
 */
export function topUpVillage(anchorPeerId: string): number {
  let spawned = 0;
  try {
    const start = listNpcs();
    const taken = new Set(start.map((n) => n.name));
    // A missing sex comes first, so a lone survivor gets a partner before
    // the headcount fills up.
    const has = (sex: string) => start.some((n) => n.sex === sex);
    const ordered = [...INITIAL_NPCS].sort((a, b) => Number(has(a.sex)) - Number(has(b.sex)));
    for (const spec of ordered) {
      const roster = listNpcs();
      if (!needsTopUp(roster)) break;
      if (taken.has(spec.name)) continue;
      // Once the headcount is met, only add the missing sex.
      if (roster.length >= VILLAGE_FLOOR && roster.some((n) => n.sex === spec.sex)) continue;
      try {
        const res = spawnNpc({ name: spec.name, sex: spec.sex, anchorPeerId, seed: spec.baseString });
        if ('ok' in res && res.ok) {
          spawned += 1;
          taken.add(spec.name);
        }
      } catch (err) {
        console.warn('[npcVillage] top-up spawn failed', spec.name, err);
      }
    }
  } catch (err) {
    console.warn('[npcVillage] top-up failed', err);
  }
  return spawned;
}
