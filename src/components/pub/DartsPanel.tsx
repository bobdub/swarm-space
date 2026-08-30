/**
 * DartsPanel — the DOM face of a darts table. Entry, seating and
 * spectating all happen in the 3D pub; this panel is only the board
 * readout plus the throw meter for whoever's turn it is.
 */

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  joinTable,
  leaveTable,
  submitIntent,
  tableHost,
  tableReadyToPlay,
  usePubTable,
} from '@/lib/pub/gameTableStore';
import { PubStakePanel } from '@/components/pub/PubStakePanel';
import { activeDartsSeat, DARTS_START_SCORE } from '@/lib/pub/darts';

// One full sweep (left→centre→right→centre→left) — slow enough to time by hand.
const METER_PERIOD_MS = 3600;

export function DartsPanel({
  tableId,
  selfId,
  username,
  onClose,
}: {
  tableId: string;
  selfId: string;
  username: string;
  onClose: () => void;
}) {
  const table = usePubTable(tableId, 'darts');
  const seatIds = table.seats.map((s) => s.peerId);
  const seated = seatIds.includes(selfId);
  const host = tableHost(table);
  const active = activeDartsSeat(table.state, seatIds);
  const ready = tableReadyToPlay(table);
  const myTurn = seated && active === selfId && ready;

  const [meter, setMeter] = useState(0);
  const rafRef = useRef<number | null>(null);
  const meterRef = useRef(0);

  useEffect(() => {
    if (!myTurn) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    const tick = () => {
      const t = (performance.now() % METER_PERIOD_MS) / METER_PERIOD_MS;
      // Sawtooth → triangle so the sweet spot sits in the middle.
      const v = t < 0.5 ? t * 2 : (1 - t) * 2;
      meterRef.current = v;
      setMeter(v);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [myTurn]);

  const handleThrow = () => {
    if (!myTurn) return;
    submitIntent(tableId, selfId, {
      type: 'throw',
      peerId: selfId,
      accuracy: meterRef.current,
      roll: Math.random(),
    });
  };

  const handleReset = () => {
    if (host !== selfId) return;
    submitIntent(tableId, selfId, { type: 'reset' });
  };

  return (
    <div className="pointer-events-auto w-[min(92vw,22rem)] rounded-2xl border border-primary/50 bg-[hsla(265,70%,8%,0.94)] p-4 text-foreground shadow-[0_0_28px_hsla(265,70%,55%,0.35)]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide">Darts · 501</h2>
          <p className="text-[11px] text-muted-foreground">
            {table.stake > 0 ? `${table.stake} SWARM stake` : 'Free play'}
            {host ? ` · host ${host === selfId ? 'you' : host.slice(0, 6)}` : ' · no host yet'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close darts panel"
          className="rounded-full border border-foreground/25 p-1.5 text-foreground/70 hover:bg-foreground/10"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <ul className="mb-3 space-y-1">
        {table.seats.length === 0 && (
          <li className="rounded-lg border border-dashed border-foreground/20 px-3 py-2 text-xs text-muted-foreground">
            No one at the oche yet.
          </li>
        )}
        {table.seats.map((s) => {
          const isActive = active === s.peerId;
          return (
            <li
              key={s.peerId}
              className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm ${
                isActive ? 'bg-primary/20 ring-1 ring-primary/60' : 'bg-foreground/5'
              }`}
            >
              <span className="truncate">
                {s.peerId === selfId ? 'You' : s.username || s.peerId.slice(0, 8)}
                {table.state.winnerPeerId === s.peerId && ' 🏆'}
              </span>
              <span className="font-mono tabular-nums">
                {table.state.scores[s.peerId] ?? DARTS_START_SCORE}
              </span>
            </li>
          );
        })}
      </ul>

      {table.state.recent.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {table.state.recent.map((r, i) => (
            <span
              key={`${r.peerId}-${i}-${r.label}`}
              className="rounded-full bg-foreground/10 px-2 py-0.5 text-[11px] font-mono"
            >
              {r.label}
            </span>
          ))}
        </div>
      )}

      {seated && myTurn && !table.state.winnerPeerId && (
        <div className="mb-3">
          <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
            <span>Release near the centre</span>
            <span>{table.state.throwsLeft} darts left</span>
          </div>
          <div className="relative h-3 overflow-hidden rounded-full bg-foreground/10">
            <div className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 bg-primary/70" />
            <div
              className="absolute inset-y-0 w-2 rounded-full bg-primary"
              style={{ left: `calc(${(meter * 100).toFixed(1)}% - 4px)` }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!seated ? (
          <button
            type="button"
            onClick={() => joinTable({ tableId, game: 'darts', peerId: selfId, username })}
            className="rounded-full bg-primary px-4 py-2 text-xs font-bold uppercase tracking-wide text-primary-foreground hover:bg-primary/90"
          >
            Take a seat
          </button>
        ) : (
          <button
            type="button"
            onClick={() => leaveTable(tableId, selfId)}
            className="rounded-full border border-foreground/30 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-foreground/80 hover:bg-foreground/10"
          >
            Leave table
          </button>
        )}
        {myTurn && !table.state.winnerPeerId && (
          <button
            type="button"
            onClick={handleThrow}
            className="rounded-full bg-primary px-5 py-2 text-xs font-bold uppercase tracking-wide text-primary-foreground hover:bg-primary/90"
          >
            Throw
          </button>
        )}
        {host === selfId && (
          <button
            type="button"
            onClick={handleReset}
            className="rounded-full border border-foreground/30 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-foreground/70 hover:bg-foreground/10"
          >
            New leg
          </button>
        )}
      </div>

      {!seated && (
        <p className="mt-2 text-[11px] text-muted-foreground">Watching — take a seat to throw.</p>
      )}

      {seated && !ready && (
        <p className="mt-2 text-[11px] text-amber-300">
          Stake agreed at {table.stake} SWARM — the leg starts once everyone has agreed and bought in.
        </p>
      )}

      <PubStakePanel table={table} selfId={selfId} username={username} />
    </div>
  );
}
