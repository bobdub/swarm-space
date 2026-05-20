/**
 * resourceTargeting — read-only adapter from NPC drives → resource sites.
 *
 * Pure: never mutates economy, never touches the field, never writes
 * builderBlockEngine. The NpcSwarmLayer uses this to drift NPCs toward
 * a sensible target site for their current drive.
 */
import type { NpcDrive } from '@/lib/brain/npc/npcTypes';
import {
  listResourceSites,
  type ResourceKind,
  type ResourceSite,
} from './baseResources';

/** Shared with NpcSwarmLayer — inside this radius the NPC is "at" the site. */
export const ARRIVE_RADIUS = 1.5;

/** Map an NPC drive to the resource kind it should head for, if any. */
export function driveToResourceKind(drive: NpcDrive | undefined): ResourceKind | null {
  switch (drive) {
    case 'drink':            return 'water';
    case 'fish':             return 'water';
    case 'gather':           return 'wood';
    case 'craft':            return 'wood';
    case 'hunt':             return 'animal';
    case 'eat':              return 'animal';
    default:                 return null;
  }
}

/** Nearest site of `kind` to `(tx, tz)`, or null if none. */
export function nearestSite(
  tx: number,
  tz: number,
  kind: ResourceKind,
): ResourceSite | null {
  let best: ResourceSite | null = null;
  let bestD = Infinity;
  for (const s of listResourceSites()) {
    if (s.kind !== kind) continue;
    if (s.yieldLeft <= 0) continue;
    const dx = s.tx - tx;
    const dz = s.tz - tz;
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}