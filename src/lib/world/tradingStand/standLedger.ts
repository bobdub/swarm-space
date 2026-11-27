/**
 * standLedger — a player's Trading Stand history, read straight off the
 * blockchain (mined blocks plus this device's unmined entries).
 *
 * Every stand trade is a set of ledger legs sharing one `operationId`
 * (`meta.tradingStand`): the goods leg in `GOOD:<id>`, and SWARM or Credits
 * legs for the payment, the owner's 15%, the community 5% and any payout.
 * This folds them back into one row per trade, for the Wallet's Labor tab.
 * Pure over the chain; nothing here writes.
 */
import type { SwarmBlock, SwarmTransaction } from '@/lib/blockchain/types';
import { getTradingGood, type TradingGood } from './pricing';

export type StandLedgerKind = 'bought' | 'sold' | 'donated' | 'owner-share';

export interface StandLedgerEntry {
  operationId: string;
  kind: StandLedgerKind;
  standKey: string;
  standId?: string;
  good?: TradingGood;
  qty: number;
  /** SWARM or Credits moved for the trade (paid, received, or the owner's share). */
  amount: number;
  currency: 'SWARM' | 'Credits' | string;
  at: string;
  /** In a mined block, rather than waiting in this device's pending pool. */
  mined: boolean;
}

interface LedgerSource {
  getChain(): SwarmBlock[];
  getPendingTransactions(): SwarmTransaction[];
}

const metaOf = (tx: SwarmTransaction) => (tx.meta ?? {}) as Record<string, unknown>;

function legCurrency(tx: SwarmTransaction): string {
  if (tx.type === 'token_transfer') return 'SWARM';
  const c = String(metaOf(tx).currency ?? '');
  if (c.toUpperCase() === 'CREDITS') return 'Credits';
  // A token leg shows its symbol when the trade carried one.
  const ticker = metaOf(tx).ticker;
  if (!c.startsWith('GOOD:') && typeof ticker === 'string' && ticker.trim()) return ticker.trim();
  return c;
}

/** One row per stand trade `userId` took part in, newest first. */
export function standLedgerFor(chain: LedgerSource, userId: string): StandLedgerEntry[] {
  if (!userId) return [];
  const legs = new Map<string, { tx: SwarmTransaction; mined: boolean }[]>();
  const add = (tx: SwarmTransaction, mined: boolean) => {
    const m = metaOf(tx);
    if (!m.tradingStand || typeof m.operationId !== 'string') return;
    const list = legs.get(m.operationId) ?? [];
    if (list.some((l) => l.tx.id === tx.id)) return;
    list.push({ tx, mined });
    legs.set(m.operationId, list);
  };
  for (const block of chain.getChain()) for (const tx of block.transactions ?? []) add(tx, true);
  for (const tx of chain.getPendingTransactions()) add(tx, false);

  const out: StandLedgerEntry[] = [];
  for (const [operationId, list] of legs) {
    const first = metaOf(list[0].tx);
    const direction = String(first.direction ?? '');
    const standKey = String(first.standKey ?? '');
    const standId = typeof first.standId === 'string' ? first.standId : undefined;
    const goodId = typeof first.good === 'string' && getTradingGood(first.good) ? (first.good as TradingGood) : undefined;
    const qty = Math.max(0, Number(first.goodQty ?? 0) || 0);
    const mined = list.every((l) => l.mined);
    const at = list.map((l) => l.tx.timestamp).sort()[0] ?? '';
    const base = { operationId, standKey, standId, good: goodId, qty, at, mined };

    if (direction === 'stand-sell') {
      const payout = list.find((l) => metaOf(l.tx).tradeLeg === 'payout' && l.tx.to === userId);
      if (!payout) continue;
      out.push({ ...base, kind: 'sold', amount: Number(payout.tx.amount) || 0, currency: legCurrency(payout.tx) });
    } else if (direction === 'stand-buy') {
      const paid = list.filter((l) => l.tx.from === userId && metaOf(l.tx).tradeLeg !== 'goods');
      if (paid.length) {
        const amount = paid.reduce((a, l) => a + (Number(l.tx.amount) || 0), 0);
        out.push({ ...base, kind: 'bought', amount: Math.round(amount * 1e6) / 1e6, currency: legCurrency(paid[0].tx) });
        continue;
      }
      // Someone bought at your stand: your 15% of the sale.
      const cut = list.find((l) => l.tx.to === userId && metaOf(l.tx).tradeLeg === 'owner-cut');
      if (cut) out.push({ ...base, kind: 'owner-share', amount: Number(cut.tx.amount) || 0, currency: legCurrency(cut.tx) });
    } else if (direction === 'donation') {
      const gift = list.find((l) => l.tx.from === userId);
      if (!gift) continue;
      const currency = legCurrency(gift.tx);
      const good = currency.startsWith('GOOD:') ? currency.slice(5) : undefined;
      out.push({
        ...base,
        good: good && getTradingGood(good) ? (good as TradingGood) : base.good,
        qty: good ? Number(gift.tx.amount) || 0 : base.qty,
        kind: 'donated',
        amount: good ? 0 : Number(gift.tx.amount) || 0,
        currency: good ? '' : currency,
      });
    }
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

export async function getStandLedger(userId: string): Promise<StandLedgerEntry[]> {
  const { getSwarmChain } = await import('@/lib/blockchain/chain');
  const chain = getSwarmChain();
  await chain.whenReady();
  return standLedgerFor(chain, userId);
}
