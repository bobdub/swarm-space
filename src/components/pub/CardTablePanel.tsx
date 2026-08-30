/**
 * CardTablePanel — the DOM face of the pub card table.
 *
 * Phase 2 scope: walk up, take a seat (which lifts and tilts your view
 * so the felt is readable), see who else is at the table, and leave.
 * The Hold'em reducer lands in the next phase; the seating, host and
 * gossip plumbing it needs is already exercised here.
 */

import { useEffect } from 'react';
import { X } from 'lucide-react';
import {
  joinTable,
  leaveTable,
  tableHost,
  usePubTable,
} from '@/lib/pub/gameTableStore';
import { takeSeatAt, leaveSeat } from '@/lib/pub/seating';
import { PubStakePanel } from '@/components/pub/PubStakePanel';

export function CardTablePanel({
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
  const table = usePubTable(tableId, 'holdem');
  const seated = table.seats.some((s) => s.peerId === selfId);
  const host = tableHost(table);

  // Standing back up is guaranteed even if the panel unmounts abruptly.
  useEffect(() => () => { leaveSeat(); }, []);

  const takeSeat = () => {
    joinTable({ tableId, game: 'holdem', peerId: selfId, username });
    // Seat index = position in the (deterministic, shared) seat list, so
    // every peer places every player on the same stool.
    const next = table.seats.length;
    takeSeatAt(tableId, next, selfId);
  };

  const stand = () => {
    leaveTable(tableId, selfId);
    leaveSeat();
  };

  return (
    <div className="pointer-events-auto w-[16rem] rounded-xl border border-primary/40 bg-[hsla(265,70%,7%,0.94)] p-3 text-foreground shadow-[0_0_24px_hsla(265,70%,55%,0.35)]">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-primary">
          Card table
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close card table"
          className="rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mb-2 space-y-1">
        {table.seats.length === 0 && (
          <p className="text-[11px] text-muted-foreground">No one at the table yet.</p>
        )}
        {table.seats.map((s) => (
          <div key={s.peerId} className="flex items-center justify-between text-[11px]">
            <span className={s.peerId === selfId ? 'font-semibold text-primary' : ''}>
              {s.username || s.peerId.slice(0, 8)}
            </span>
            {s.peerId === host && (
              <span className="text-[9px] uppercase tracking-wide text-muted-foreground">dealer</span>
            )}
          </div>
        ))}
      </div>

      {seated ? (
        <button
          type="button"
          onClick={stand}
          className="w-full rounded-lg border border-primary/50 px-3 py-1.5 text-xs font-semibold"
        >
          Stand up
        </button>
      ) : (
        <button
          type="button"
          onClick={takeSeat}
          className="w-full rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
        >
          Take a seat
        </button>
      )}

      <PubStakePanel table={table} selfId={selfId} username={username} />

      <p className="mt-2 text-[10px] leading-snug text-muted-foreground">
        Free play by default. Texas Hold'em dealing arrives next phase — seats, dealer and
        table sync are live now. Press [Q] or walk away to leave.
      </p>
    </div>
  );
}
