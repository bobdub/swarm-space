/**
 * playerHarvest — the one place a harvest by the local player lands.
 *
 * Every player gather (water, fruit, honey, loose stone and sticks, felled
 * tree drops, hens, fish) goes through `recordPlayerHarvest`, which:
 *   1. adds the atoms to the player's harvested inventory (Gathered tally),
 *   2. credits a `labour:<userId>` coin.fill so the player earns labour
 *      for harvesting just as NPCs do for their work, and
 *   3. journals the harvest so the coin engraving writer can engrave it
 *      onto the player's open coin.
 *
 * NPC harvests do not come through here: NPC yield goes to the NPC's own
 * stores and is credited to `labour:<npcId>` by coin.bus.
 */
import { recordHarvestForResource } from '@/lib/remix/harvestedInventory';
import { journalHarvest } from '@/lib/remix/harvestJournal';
import { emitScaffold } from '@/lib/uqrc/scaffoldBus';
import { getCurrentUser } from '@/lib/auth';

/** Labour credited per unit harvested; on the same scale as NPC verbs in coin.bus. */
export const HARVEST_LABOUR_PER_UNIT: Record<string, number> = {
  wood: 0.04,
  stone: 0.05,
  water: 0.01,
  fibre: 0.03,
  food: 0.04,
  animal: 0.05,
};

function localUserId(): string | null {
  try { return getCurrentUser()?.id ?? null; } catch { return null; }
}

export function recordPlayerHarvest(kind: string, qty: number, userId: string | null = localUserId()): void {
  if (!Number.isFinite(qty) || qty <= 0) return;
  recordHarvestForResource(kind, qty);
  if (!userId) return;
  const perUnit = HARVEST_LABOUR_PER_UNIT[kind];
  if (perUnit) {
    try {
      emitScaffold({
        domain: 'coin',
        type: 'fill',
        coinId: `labour:${userId}`,
        ownerId: userId,
        delta: Math.min(1, perUnit * qty),
      });
    } catch (err) { console.warn('[playerHarvest] labour credit failed', err); }
  }
  void journalHarvest(userId, kind, qty).catch(() => { /* engraving catches up next harvest */ });
}
