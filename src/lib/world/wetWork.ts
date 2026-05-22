/**
 * wetWork — the single point of contact between NPCs and the world.
 *
 * Called from npcTickScheduler when an NPC actually reaches a resource
 * site. Mutates inventory, depletes the site, and emits both a
 * `world.mutation` (so labour ledger / scaffold health react) and an
 * `npc.decision` is left to the scheduler.
 *
 * No direct field writes; no Math.random in branching (deterministic
 * skill gate via npcSkills).
 */
import { emitWorldMutation } from './world.bus';
import { harvestSite, type ResourceSite } from './baseResources';
import { deposit, consume } from '@/lib/brain/npc/npcChemistry';
import { recordHarvestForResource } from '@/lib/remix/harvestedInventory';
import type { Npc, NpcDrive } from '@/lib/brain/npc/npcTypes';

export interface WetWorkOutcome {
  ok: boolean;
  /** Verb that actually fired (may differ from intent on failure). */
  verb: NpcDrive;
  /** Yield collected this tick, if any. */
  gained?: { kind: 'water' | 'food' | 'wood'; qty: number };
}

/**
 * Apply one interaction between `npc` and `site` for the chosen drive.
 * Returns ok=true only when the interaction landed (yield was available
 * and the verb made sense for the site kind).
 */
export function interact(
  npc: Npc,
  drive: NpcDrive,
  site: ResourceSite,
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
      deposit(npc.id, 'water', 1);
      emit(npc.id, site, 0.4, 0.2, 1.0);
      try { recordHarvestForResource('water', 1); } catch { /* noop */ }
      return { ok: true, verb: 'drink', gained: { kind: 'water', qty: 1 } };
    }
    deposit(npc.id, 'food', 1);
    emit(npc.id, site, 0.5, 0.5, 1.2);
    try { recordHarvestForResource('food', 1); } catch { /* noop */ }
    return { ok: true, verb: 'fish', gained: { kind: 'food', qty: 1 } };
  }

  if (site.kind === 'wood' && (drive === 'gather' || drive === 'craft')) {
    if (!harvestSite(site.id)) return { ok: false, verb: drive };
    deposit(npc.id, 'wood', 1);
    emit(npc.id, site, 0.8, 0.6, 1.4);
    try { recordHarvestForResource('wood', 1); } catch { /* noop */ }
    return { ok: true, verb: drive, gained: { kind: 'wood', qty: 1 } };
  }

  if (site.kind === 'animal' && drive === 'hunt') {
    // Skill gate — low-skill hunters miss occasionally, but deterministically:
    // we still attempt the harvest, but yield is halved at skill < 0.4.
    if (!harvestSite(site.id)) return { ok: false, verb: 'hunt' };
    const qty = huntSkill < 0.4 ? 1 : 2;
    deposit(npc.id, 'food', qty);
    emit(npc.id, site, 1.0, 0.9, 1.6 * qty);
    try { recordHarvestForResource('animal', qty); } catch { /* noop */ }
    return { ok: true, verb: 'hunt', gained: { kind: 'food', qty } };
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
