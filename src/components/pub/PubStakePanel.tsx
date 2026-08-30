/**
 * PubStakePanel — the whole SWARM surface of a pub table.
 *
 * Free play is the default and always available. Stakes are opt-in: the
 * host names a number, every seated player ticks "agree", and each pays
 * their own buy-in into the table escrow. The host pays the pot out once
 * a winner appears. Drinks are a separate, tiny gesture.
 */

import { useCallback, useEffect, useState } from 'react';
import { Beer, Coins, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  allSeatsAgreed,
  allSeatsFunded,
  isTableHost,
  markSeatFunded,
  markTableSettled,
  setSeatAgreement,
  setTableStake,
  tablePot,
  type PubTable,
} from '@/lib/pub/gameTableStore';
import { canAfford, payBuyIn, settleEscrow } from '@/lib/pub/stakes';
import { buyDrink, DRINK_PRICE } from '@/lib/pub/drinks';
import { getSwarmBalance } from '@/lib/blockchain/token';

const STAKE_STEPS = [0, 1, 5, 25];

export function PubStakePanel({
  table,
  selfId,
  username,
}: {
  table: PubTable;
  selfId: string;
  username: string;
}) {
  const seated = table.seats.some((s) => s.peerId === selfId);
  const host = isTableHost(table, selfId);
  const agreed = table.agreed.includes(selfId);
  const funded = table.funded.includes(selfId);
  const pot = tablePot(table);
  const [balance, setBalance] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refreshBalance = useCallback(async () => {
    if (!selfId) return;
    try { setBalance(await getSwarmBalance(selfId)); } catch { /* offline is fine */ }
  }, [selfId]);

  useEffect(() => { void refreshBalance(); }, [refreshBalance]);

  // Host settles the pot exactly once, when a winner exists.
  const winner = table.state.winnerPeerId;
  useEffect(() => {
    if (!host || !winner || table.settled || table.stake <= 0 || pot <= 0) return;
    let cancelled = false;
    void (async () => {
      try {
        await settleEscrow({ tableId: table.tableId, winnerPeerId: winner, pot });
        if (cancelled) return;
        markTableSettled(table.tableId);
        toast.success(`Pot of ${pot} SWARM paid to ${winner === selfId ? 'you' : winner.slice(0, 8)}`);
        void refreshBalance();
      } catch (err) {
        console.warn('[pub] settle failed', err);
      }
    })();
    return () => { cancelled = true; };
  }, [host, winner, table.settled, table.stake, table.tableId, pot, selfId, refreshBalance]);

  const handleBuyIn = async () => {
    if (table.stake <= 0 || funded) return;
    setBusy('buyin');
    try {
      if (!(await canAfford(selfId, table.stake))) {
        toast.error('Not enough SWARM for this buy-in');
        return;
      }
      await payBuyIn({ tableId: table.tableId, peerId: selfId, amount: table.stake });
      markSeatFunded(table.tableId, selfId);
      void refreshBalance();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Buy-in failed');
    } finally {
      setBusy(null);
    }
  };

  const handleDrink = async (targets: string[], round: boolean) => {
    if (targets.length === 0) {
      toast.info('No one else at the table');
      return;
    }
    setBusy(round ? 'round' : targets[0]);
    try {
      await buyDrink({ fromPeerId: selfId, fromName: username, toPeerIds: targets, round });
      void refreshBalance();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The bar is closed');
    } finally {
      setBusy(null);
    }
  };

  const others = table.seats.filter((s) => s.peerId !== selfId).map((s) => s.peerId);

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-foreground/15 bg-foreground/5 p-2.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="inline-flex items-center gap-1 font-semibold uppercase tracking-wide text-muted-foreground">
          <Coins className="h-3.5 w-3.5" />
          {table.stake > 0 ? `${table.stake} SWARM stake` : 'Free play'}
        </span>
        <span className="font-mono tabular-nums text-muted-foreground">
          {balance === null ? '—' : `${balance} SWARM`}
        </span>
      </div>

      {host && (
        <div className="flex flex-wrap gap-1">
          {STAKE_STEPS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setTableStake(table.tableId, s)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                table.stake === s
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-foreground/25 text-foreground/75 hover:bg-foreground/10'
              }`}
            >
              {s === 0 ? 'Free' : `${s}`}
            </button>
          ))}
        </div>
      )}

      {table.stake > 0 && seated && (
        <div className="space-y-1.5">
          <label className="flex items-center gap-2 text-[11px] text-foreground/85">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setSeatAgreement(table.tableId, selfId, e.target.checked)}
              className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
            />
            I agree to a {table.stake} SWARM stake
          </label>
          <button
            type="button"
            disabled={!agreed || funded || busy === 'buyin'}
            onClick={() => void handleBuyIn()}
            className="w-full rounded-lg bg-primary px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-primary-foreground disabled:opacity-40"
          >
            {busy === 'buyin' && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}
            {funded ? 'Bought in' : `Buy in · ${table.stake} SWARM`}
          </button>
          <p className="text-[10px] text-muted-foreground">
            Pot {pot} SWARM ·{' '}
            {allSeatsAgreed(table)
              ? allSeatsFunded(table)
                ? 'all paid — play on'
                : 'waiting on buy-ins'
              : 'waiting on agreement'}
            . Friendly table — the host deals and settles.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1 border-t border-foreground/10 pt-2">
        <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          <Beer className="h-3.5 w-3.5" /> {DRINK_PRICE} SWARM
        </span>
        <button
          type="button"
          disabled={busy === 'round'}
          onClick={() => void handleDrink(others, true)}
          className="rounded-full border border-foreground/25 px-2.5 py-1 text-[11px] font-semibold hover:bg-foreground/10 disabled:opacity-40"
        >
          Buy a round
        </button>
        {table.seats
          .filter((s) => s.peerId !== selfId)
          .map((s) => (
            <button
              key={s.peerId}
              type="button"
              disabled={busy === s.peerId}
              onClick={() => void handleDrink([s.peerId], false)}
              className="rounded-full border border-foreground/25 px-2.5 py-1 text-[11px] hover:bg-foreground/10 disabled:opacity-40"
            >
              🍺 {s.username || s.peerId.slice(0, 6)}
            </button>
          ))}
      </div>
    </div>
  );
}
