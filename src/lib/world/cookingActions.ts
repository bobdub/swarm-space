/**
 * cookingActions — the player-facing side of the grill: put food on, and
 * hear when it comes off. The rules live in `cooking.ts`.
 */
import { toast } from 'sonner';
import { cookableFor, onGrillDone, resumeGrill, startCooking, GRILL_SLOTS, type StartCookingResult } from '@/lib/world/cooking';

const TOAST_ID = 'fire-grill';

let toastsAttached = false;

/** Toast when food comes off the grill. Idempotent. */
export function attachGrillToasts(): void {
  if (toastsAttached) return;
  toastsAttached = true;
  onGrillDone((results) => {
    const cooked = results.filter((r) => r.outcome === 'cooked');
    const cold = results.filter((r) => r.outcome === 'cold');
    if (cooked.length > 0) {
      const names = cooked.map((r) => {
        const f = cookableFor(r.job.raw);
        return f ? `${f.cookedIcon} ${f.label}` : r.job.raw;
      });
      toast.success('Off the grill', {
        id: `${TOAST_ID}-done`,
        description: `${names.join(', ')}. Cooked food keeps you rowing much longer than raw.`,
      });
    }
    if (cold.length > 0) {
      const names = cold.map((r) => cookableFor(r.job.raw)?.rawLabel ?? r.job.raw);
      toast.message('The fire went out', {
        id: `${TOAST_ID}-cold`,
        description: `${names.join(', ')} came back raw. Add wood and grill it again.`,
      });
    }
  });
  resumeGrill();
}

export function cookOnFire(pitId: string, raw: string, now = Date.now()): StartCookingResult {
  attachGrillToasts();
  const res = startCooking(pitId, raw, now);
  const food = cookableFor(raw);
  if (res.ok) {
    if (food) {
      toast.message('On the grill', {
        id: TOAST_ID,
        description: `${food.icon} ${food.rawLabel} will be ${food.label} in ${Math.round(food.cookMs / 1000)} s. Keep the fire burning.`,
      });
    }
    return res;
  }
  const description = res.reason === 'cold'
    ? 'Light the fire first. Food only cooks over flames.'
    : res.reason === 'full'
      ? `Your grill holds ${GRILL_SLOTS} at a time. Wait for something to finish.`
      : res.reason === 'none'
        ? `You have no raw ${food?.rawLabel ?? 'food'}. Catch some, or buy it at the Trading Stand.`
        : 'That cannot go on the grill.';
  toast.message('Grill', { id: TOAST_ID, description });
  return res;
}
