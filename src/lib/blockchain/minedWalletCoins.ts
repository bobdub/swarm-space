import { getAll, put } from '../store';
import { getSwarmChain } from './chain';
import { COIN_MAX_WEIGHT, type SwarmCoin } from './types';

const pending = new Map<string, Promise<number>>();

/** Recover containers from mining ledger evidence, never from an arbitrary balance. */
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
  const records = [
    ...chain.getChain().flatMap((block) => block.transactions.map((tx) => ({ tx, height: block.index }))),
    ...chain.getPendingTransactions().map((tx) => ({ tx, height: undefined as number | undefined })),
  ];
  const seen = new Set<string>();
  const proofs = records.filter(({ tx }) => {
    if (seen.has(tx.id)) return false;
    seen.add(tx.id);
    if (tx.to !== userId) return false;
    const reason = String(tx.meta?.reason ?? '').toLowerCase();
    return tx.type === 'mining_reward' || (tx.type === 'token_mint' &&
      (reason.includes('confirmed mesh work') || reason.includes('network service unit')));
  });
  const earned = Math.floor(proofs.reduce((sum, { tx }) => {
    const amount = Number(tx.amount ?? 0);
    return sum + (Number.isFinite(amount) && amount > 0 ? amount : 0);
  }, 0));
  // Historical containers count even when spent/vaulted/transferred: never recreate them.
  const represented = existing.filter((coin) => coin.coinId.startsWith(`mined:${userId}:`) ||
    (coin.ownerId === userId && coin.status === 'wallet')).length;
  const walletCount = existing.filter((coin) => coin.ownerId === userId && coin.status === 'wallet').length;
  const balance = chain.getBalance(userId);
  const available = Number.isFinite(balance) ? Math.max(0, Math.floor(balance) - walletCount) : 0;
  const count = Math.min(Math.floor(limit), Math.max(0, earned - represented), available);
  const latest = proofs.at(-1);
  if (!latest || count <= 0) return 0;
  let index = 0;
  for (let created = 0; created < count; created += 1) {
    while (ids.has(`mined:${userId}:${index}`)) index += 1;
    const coinId = `mined:${userId}:${index++}`;
    ids.add(coinId);
    await put('swarmCoins', {
      coinId, ownerId: userId, status: 'wallet', weight: 0,
      maxWeight: COIN_MAX_WEIGHT, wrappedTokens: [],
      minedAt: latest.tx.timestamp, minedInBlock: latest.height,
    } satisfies SwarmCoin);
  }
  return count;
}