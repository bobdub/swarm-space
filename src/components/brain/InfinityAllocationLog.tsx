import { useEffect, useState } from 'react';
import { formatUnits } from 'ethers';
import type { SwarmTransaction } from '@/lib/blockchain/types';
import {
  ALLOCATION_DAY_CAP_BPS, ALLOCATION_MIN_YES, ALLOCATION_ROUND_CAP_BPS, INFINITY_POOL_ALLOCATION_ENABLED,
} from '@/lib/blockchain/infinity/poolAllocation';

interface Row { id: string; round: number; date: string; amount: string; yes: number; total: number }

function rows(transactions: readonly SwarmTransaction[]): Row[] {
  const out: Row[] = [];
  for (const tx of transactions) {
    if (tx.type !== 'infinity_vault_allocation') continue;
    const votes = Array.isArray(tx.meta?.votes) ? (tx.meta!.votes as Array<{ agree?: boolean }>) : [];
    const units = typeof tx.meta?.units === 'string' ? tx.meta.units : '0';
    out.push({
      id: tx.id,
      round: Number(tx.meta?.round ?? 0),
      date: new Date(Number(tx.meta?.day ?? 0) * 86_400_000).toLocaleDateString(),
      amount: Number(formatUnits(BigInt(units), 18)).toLocaleString(undefined, { maximumFractionDigits: 4 }),
      yes: votes.filter((v) => v?.agree === true).length,
      total: votes.length,
    });
  }
  return out.sort((a, b) => b.round - a.round).slice(0, 20);
}

/** Every allocation Infinity's peers settled, with the rules it runs under. */
export function InfinityAllocationLog(): JSX.Element {
  const [list, setList] = useState<Row[]>([]);
  useEffect(() => {
    let cancelled = false;
    const read = () => void import('@/lib/blockchain/chain').then(({ getSwarmChain }) => {
      const chain = getSwarmChain();
      const txs = [...chain.getChain().flatMap((b) => b.transactions ?? []), ...chain.getPendingTransactions()];
      if (!cancelled) setList(rows(txs));
    }).catch(() => {});
    read();
    const id = setInterval(read, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return <div>
    <h2 className="font-semibold text-foreground">Vault allocations</h2>
    <p className="mt-1 text-muted-foreground">
      {INFINITY_POOL_ALLOCATION_ENABLED
        ? `After 2 hours connected, Infinity proposes moving MINTME gifted to its donations vault into its market vault. At most ${Number(ALLOCATION_ROUND_CAP_BPS) / 100}% per round and ${Number(ALLOCATION_DAY_CAP_BPS) / 100}% per day; ${ALLOCATION_MIN_YES}+ members connected 2 hours must agree, and yes must be a majority.`
        : 'Allocations are switched off.'}
    </p>
    {list.length ? <ul className="mt-3 space-y-1">
      {list.map((r) => <li key={r.id} className="flex items-center justify-between gap-3 border-b border-border/60 py-1.5">
        <span className="min-w-0 truncate">Round {r.round + 1} · {r.date} · donations → market</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{r.amount} MINTME · {r.yes}/{r.total} yes</span>
      </li>)}
    </ul> : <p className="mt-3 text-muted-foreground">No allocations yet.</p>}
  </div>;
}

export default InfinityAllocationLog;
