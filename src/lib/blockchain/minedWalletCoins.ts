import { getAll, put } from '../store';
import { getSwarmChain } from './chain';
import { COIN_MAX_WEIGHT, type SwarmCoin } from './types';

const pending = new Map<string, Promise<number>>();

/** Back hollow containers with the verified wallet balance, whether SWARM was mined or received. */
export function hydrateMinedWalletCoins(userId: string, limit = 1): Promise<number> {
  const active = pending.get(userId);
  if (active) return active;
  const work = hydrate(userId, limit).finally(() => pending.delete(userId));
  pending.set(userId, work);
  return work;
}

async function hydrate(userId: string, limit: number): Promise<number> {
  if (!userId || limit <= 0) return 0;
  const chain = getSwarmChain();
  await chain.whenReady();
  const existing = await getAll<SwarmCoin>('swarmCoins');
  const ids = new Set(existing.map((coin) => coin.coinId));
  // Any verified wallet SWARM (mined or received) backs one hollow container per whole coin.
  const walletCount = existing.filter((coin) => coin.ownerId === userId && coin.status === 'wallet').length;
  const balance = chain.getBalance(userId);
  const available = Number.isFinite(balance) ? Math.max(0, Math.floor(balance) - walletCount) : 0;
  const count = Math.min(Math.floor(limit), available);
  if (count <= 0) return 0;
  const minedAt = new Date().toISOString();
  let index = 0;
  for (let created = 0; created < count; created += 1) {
    while (ids.has(`mined:${userId}:${index}`)) index += 1;
    const coinId = `mined:${userId}:${index++}`;
    ids.add(coinId);
    await put('swarmCoins', {
      coinId, ownerId: userId, status: 'wallet', weight: 0,
      maxWeight: COIN_MAX_WEIGHT, wrappedTokens: [],
      minedAt,
    } satisfies SwarmCoin);
  }
  void import('./contentPayload').then((m) => m.packLocalContent(userId));
  return count;
}