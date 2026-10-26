import { launchPayment } from './spaceshipRules';

export interface LaunchLedger {
  currentUserId(): string | undefined;
  swarmBalance(userId: string): Promise<number>;
  creditBalance(userId: string): Promise<number>;
  burn(params: { from: string; amount: number; reason: string }): Promise<unknown>;
  deduct(userId: string, amount: number, reason: string): Promise<unknown>;
}
export function createLaunchCharger(ledger: LaunchLedger) {
  const operations = new Map<string, Promise<string>>();
  return (userId: string, operation: string, stillActive: () => boolean = () => true): Promise<string> => {
    const id = `${userId}:${operation}`;
    const existing = operations.get(id); if (existing) return existing;
    const pay = (async () => {
      if (ledger.currentUserId() !== userId) throw new Error('Sign in to launch');
      const [swarm, credits] = await Promise.all([ledger.swarmBalance(userId), ledger.creditBalance(userId)]);
      const payment = launchPayment(swarm, credits);
      if (!payment) throw new Error('Launch needs 5 SWARM or 500 game credits');
      if (!stillActive() || ledger.currentUserId() !== userId) throw new Error('Launch cancelled');
      if (payment.asset === 'swarm') await ledger.burn({ from: userId, amount: payment.amount, reason: `Spaceship launch:${operation}` });
      else await ledger.deduct(userId, payment.amount, `Spaceship launch:${operation}`);
      return payment.asset === 'swarm' ? '5 SWARM' : '500 game credits';
    })();
    operations.set(id, pay);
    if (operations.size > 100) { const first = operations.keys().next().value; if (first) operations.delete(first); }
    return pay;
  };
}