/**
 * npcIdentity — the cross-device id of a villager.
 *
 * Names are unique inside a village and the same on every device (the
 * starters come from `seedCommunity`, children are named from their
 * parents and birth slot), so the id is a hash of the name. Aria on your
 * device and Aria on mine are then the same NPC: same id, same field keys
 * (`npc:<id>:…`), same schedule.
 */

function fnv1a(input: string): number {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Stable id for the villager called `name`. */
export function npcIdForName(name: string): string {
  return `npc-${fnv1a(`swarm-village/npc/${name}`).toString(36)}`;
}

/** Unit-interval hash of a string (pure, cross-device). */
export function hash01(input: string): number {
  // Murmur3 finaliser: inputs that differ only in their last character
  // (day or block numbers) still land far apart.
  let h = fnv1a(input);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}
