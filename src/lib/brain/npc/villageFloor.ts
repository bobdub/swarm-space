/**
 * villageFloor — keeps the local village from dwindling to a dead end.
 *
 * The NPC village is simulated and saved per device (IndexedDB
 * `swarm-npcs`), and NPCs age and die. Only a female × male pair can
 * have children, so once a device is down to one NPC (or only one sex)
 * the village can never recover, and that small roster is saved and
 * restored on every visit. This tops the village back up with starter
 * newcomers whose names aren't taken.
 */
import { spawnNpc } from './npcEngine';
import { listNpcs } from './npcRegistry';
import { INITIAL_NPCS } from './seedCommunity';
import type { Npc } from './npcTypes';

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

/**
 * Spawn starter NPCs (skipping names already present) until the village
 * has at least the starter headcount and a breeding pair. Returns how
 * many were spawned. Never throws.
 */
export function topUpVillage(anchorPeerId: string): number {
  let spawned = 0;
  try {
    const taken = new Set(listNpcs().map((n) => n.name));
    for (const spec of INITIAL_NPCS) {
      const roster = listNpcs();
      if (roster.length >= INITIAL_NPCS.length && hasBreedingPair(roster)) break;
      if (taken.has(spec.name)) continue;
      // Once the headcount is met, only add the missing sex.
      if (roster.length >= INITIAL_NPCS.length && roster.some((n) => n.sex === spec.sex)) continue;
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
