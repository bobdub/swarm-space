import { getCurrentUser } from '@/lib/auth';
import { getCreditBalance, deductCredits } from '@/lib/credits';
import { getSwarmBalance, burnSwarm } from '@/lib/blockchain/token';
import { launchPayment } from './spaceshipRules';

const operations = new Map<string, Promise<string>>();
// Game admission follows the existing land-plot fee path, not vault settlement.
export function chargeShipLaunch(userId: string, operation: string, stillActive: () => boolean = () => true): Promise<string> {
  const id = `${userId}:${operation}`;
  const existing = operations.get(id); if (existing) return existing;
  const pay = (async () => {
    const user = getCurrentUser();
    if (!user || user.id !== userId) throw new Error('Sign in to launch');
    const [swarm, credits] = await Promise.all([getSwarmBalance(userId), getCreditBalance(userId)]);
    const payment = launchPayment(swarm, credits);
    if (!payment) throw new Error('Launch needs 5 SWARM or 500 game credits');
    if (!stillActive() || getCurrentUser()?.id !== userId) throw new Error('Launch cancelled');
    if (payment.asset === 'swarm') await burnSwarm({ from: userId, amount: payment.amount, reason: `Spaceship launch:${operation}` });
    else await deductCredits(userId, payment.amount, `Spaceship launch:${operation}`);
    return payment.asset === 'swarm' ? '5 SWARM' : '500 game credits';
  })();
  operations.set(id, pay);
  // Bound session-only deduplication without persisting flight state.
  if (operations.size > 100) { const first = operations.keys().next().value; if (first) operations.delete(first); }
  return pay;
}