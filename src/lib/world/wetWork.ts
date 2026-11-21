/**
 * wetWork — the single point of contact between NPCs and the world.
 *
 * Called from npcTickScheduler when an NPC actually reaches a resource
 * site. Mutates inventory, depletes the site, and emits both a
 * `world.mutation` (so labour ledger / scaffold health react) and an
 * `npc.decision` is left to the scheduler.
 *
 * NPC yield goes into the NPC's own stores only. It used to be added to
 * the local player's harvested inventory too, which made the player's
 * Gathered counts climb on their own (and differently on every device
 * running the village), so they never matched what the player harvested.
 *
 * Tools an NPC picked up (see npc/npcTools) make the same work go
 * further: an axe fells 2 wood, a knife dresses 2 food from every
 * catch, a bucket carries 2 water. Only the NPC's own stores grow; the
 * labour weight sent to the ledger is unchanged, so payouts stay as they
 * were.
 *
 * No direct field writes; no Math.random in branching (deterministic
 * skill gate via npcSkills).
 */
import { emitWorldMutation } from './world.bus';
import { harvestSite, type ResourceSite } from './baseResources';
import { deposit, consume } from '@/lib/brain/npc/npcChemistry';
import type { Npc, NpcDrive } from '@/lib/brain/npc/npcTypes';
import type { NpcToolKind } from '@/lib/brain/npc/npcTools';

export interface WetWorkOutcome {
  ok: boolean;
  /** Verb that actually fired (may differ from intent on failure). */
  verb: NpcDrive;
  /** Yield collected this tick, if any. */
  gained?: { kind: 'water' | 'food' | 'wood'; qty: number };
  /** The owned tool kind that did the work, if one did. */
  usedTool?: NpcToolKind;
}

const NO_TOOLS: ReadonlySet<NpcToolKind> = new Set();

/**
 * Apply one interaction between `npc` and `site` for the chosen drive.
 * Returns ok=true only when the interaction landed (yield was available
 * and the verb made sense for the site kind).
 */
export function interact(
  npc: Npc,
  drive: NpcDrive,
  site: ResourceSite,
  tools: ReadonlySet<NpcToolKind> = NO_TOOLS,
): WetWorkOutcome {
  const huntSkill = npc.skills?.['hunt'] ?? 0.5;

  // Eat is a consumption verb — site is irrelevant beyond proximity.
  if (drive === 'eat') {
    const ok = consume(npc.id, 'food', 1);
    return { ok, verb: 'eat' };
  }

  if (site.kind === 'water' && (drive === 'drink' || drive === 'fish')) {
    if (!harvestSite(site.id)) return { ok: false, verb: drive };
    if (drive === 'drink') {
      const bucket = tools.has('carry');
      const qty = bucket ? 2 : 1;
      deposit(npc.id, 'water', qty);
      emit(npc.id, site, 0.4, 0.2, 1.0);
      return { ok: true, verb: 'drink', gained: { kind: 'water', qty }, ...(bucket ? { usedTool: 'carry' as const } : {}) };
    }
    deposit(npc.id, 'food', 1);
    emit(npc.id, site, 0.5, 0.5, 1.2);
    return { ok: true, verb: 'fish', gained: { kind: 'food', qty: 1 } };
  }

  if (site.kind === 'wood' && (drive === 'gather' || drive === 'craft')) {
    if (!harvestSite(site.id)) return { ok: false, verb: drive };
    const axe = tools.has('chop');
    const qty = axe ? 2 : 1;
    deposit(npc.id, 'wood', qty);
    emit(npc.id, site, 0.8, 0.6, 1.4);
    return { ok: true, verb: drive, gained: { kind: 'wood', qty }, ...(axe ? { usedTool: 'chop' as const } : {}) };
  }

  if (site.kind === 'animal' && drive === 'hunt') {
    // Skill gate — low-skill hunters miss occasionally, but deterministically:
    // we still attempt the harvest, but yield is halved at skill < 0.4.
    if (!harvestSite(site.id)) return { ok: false, verb: 'hunt' };
    const knife = tools.has('whittle');
    const skilledQty = huntSkill < 0.4 ? 1 : 2;
    // A knife dresses the full catch even for a clumsy hunter. Labour
    // follows the skill-based catch, so the knife never changes payouts.
    const qty = knife ? 2 : skilledQty;
    deposit(npc.id, 'food', qty);
    emit(npc.id, site, 1.0, 0.9, 1.6 * skilledQty);
    return { ok: true, verb: 'hunt', gained: { kind: 'food', qty }, ...(knife ? { usedTool: 'whittle' as const } : {}) };
  }

  return { ok: false, verb: drive };
}

function emit(
  actorId: string,
  site: ResourceSite,
  cut: number,
  resistance: number,
  laborWeight: number,
): void {
  emitWorldMutation({
    actorId,
    targetKey: site.id,
    effectiveCut: cut,
    resistance,
    laborWeight,
  });
}
