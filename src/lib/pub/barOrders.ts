/**
 * barOrders — ordering a drink for yourself at the bar counter.
 *
 * The SWARM goes into the Market Vault as a signed pool donation, exactly
 * like Support the Vault, but marked for the bar tab so it lands on the
 * patron's own drinking record and never on the Donor Leaderboard. Once paid,
 * the glass is poured: the floating pint and the chat line everyone sees.
 */

import { getCurrentUser } from '@/lib/auth';
import { isGuestUser } from '@/lib/preview/guestAccess';
import {
  barTabMeta,
  findDrink,
  MAX_DRINKS_PER_ORDER,
  orderCost,
  type BarDrink,
} from '@/lib/blockchain/infinity/barTab';
import { serveDrink, type DrinkEvent } from './drinks';

let ordering = false;

/** Why `userId` can't order right now, or null when they can. */
export function barOrderProblem(user: ReturnType<typeof getCurrentUser>): string | null {
  if (!user) return 'Sign in to order at the bar.';
  if (isGuestUser(user)) return 'Guests can look at the menu. Sign in as a member to order.';
  return null;
}

export async function orderAtBar(params: {
  drinkId: string;
  qty: number;
  /** Who to show the glass beside: the local avatar's body id(s). */
  bodyIds: string[];
  fromName: string;
}): Promise<{ drink: BarDrink; qty: number; cost: number }> {
  if (ordering) throw new Error('The barkeep is still pouring your last order.');
  const drink = findDrink(params.drinkId);
  if (!drink) throw new Error("That's not on the menu.");
  const qty = Math.floor(params.qty);
  if (!Number.isSafeInteger(qty) || qty < 1 || qty > MAX_DRINKS_PER_ORDER) {
    throw new Error(`Order between 1 and ${MAX_DRINKS_PER_ORDER} at a time.`);
  }
  const user = getCurrentUser();
  const problem = barOrderProblem(user);
  if (problem || !user) throw new Error(problem ?? 'Sign in to order at the bar.');
  const cost = orderCost(drink, qty);
  ordering = true;
  try {
    // Same vault, same signed record as a donation; the bar tab marker keeps it off the board.
    const { donateToRewardPool } = await import('@/lib/blockchain/creditWrapping');
    await donateToRewardPool(user.id, cost, barTabMeta(drink, qty));
  } finally {
    ordering = false;
  }
  const evt: DrinkEvent = {
    id: `bar-${user.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    fromPeerId: user.id,
    fromName: params.fromName,
    toPeerIds: [...new Set(params.bodyIds.filter(Boolean))],
    round: false,
    solo: true,
    drinkName: drink.name,
    qty,
    ts: Date.now(),
  };
  serveDrink(evt);
  return { drink, qty, cost };
}
