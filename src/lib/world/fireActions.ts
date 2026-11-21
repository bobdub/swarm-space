/**
 * fireActions — putting gathered Wood on a fire pit.
 *
 * Lighting a cold pit and feeding a burning one are the same act: spend
 * one Wood from this player's bag, then record the fact in `fireStore`,
 * which every peer folds into the same burn time.
 */
import { toast } from 'sonner';
import { spendMaterials, materialTotals } from '@/lib/world/materials';
import {
  WOOD_PER_FUEL,
  BURN_MS_PER_WOOD,
  isFireLit,
  isFireFull,
  recordFuel,
} from '@/lib/world/fireStore';

export type AddWoodResult = 'lit' | 'fed' | 'full' | 'no-wood';

const TOAST_ID = 'fire-pit';

export function addWoodToFire(pitId: string, actorId: string, now = Date.now()): AddWoodResult {
  if (isFireFull(pitId, now)) {
    toast.message('Fire Pit', { id: TOAST_ID, description: 'The pit is full of wood. Let it burn down a little first.' });
    return 'full';
  }
  if ((materialTotals().wood ?? 0) < WOOD_PER_FUEL || !spendMaterials({ wood: WOOD_PER_FUEL })) {
    toast.message('Fire Pit', { id: TOAST_ID, description: 'You need Wood. Chop a tree with the Stone Axe and pick up the logs.' });
    return 'no-wood';
  }
  const wasLit = isFireLit(pitId, now);
  recordFuel(pitId, actorId, WOOD_PER_FUEL, now);
  const minutes = Math.round(BURN_MS_PER_WOOD / 60_000);
  toast.success(wasLit ? 'More wood on the fire' : 'Fire lit', {
    id: TOAST_ID,
    description: `1 Wood burns about ${minutes} minutes.`,
  });
  return wasLit ? 'fed' : 'lit';
}
