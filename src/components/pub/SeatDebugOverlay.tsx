/**
 * SeatDebugOverlay — live read-out of the seating geometry.
 *
 * Shows, at 5 Hz: every registered seat anchor with its stool-top world
 * height, and for each remote peer body its base height above the local
 * ground, whether it is seat-locked, and how far (if at all) it has sunk
 * through the floor. This is the visual twin of `seatMetrics`, which the
 * automated two-peer sync test asserts against.
 */

import { useEffect, useState } from 'react';
import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';
import { listSeatLocks, seatedTransform } from '@/lib/pub/seatLock';
import { listPubSeatAnchors, listPubAnchors, pubSeatWorldPos } from '@/lib/world/pubAnchors';
import { baseHeight, floorPenetration, tableTopHeight, seesTableTop } from '@/lib/pub/seatMetrics';

interface Row {
  id: string;
  base: number;
  sunk: number;
  locked: boolean;
  sees: boolean | null;
}

export function SeatDebugOverlay({ tableId }: { tableId?: string | null }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [seats, setSeats] = useState<{ label: string; height: number }[]>([]);
  const [top, setTop] = useState<number | null>(null);

  useEffect(() => {
    const sample = () => {
      try {
        const activeTable = tableId
          ?? listPubAnchors().find((a) => a.tableId?.startsWith('pub:cards:'))?.tableId
          ?? null;
        const topH = activeTable ? tableTopHeight(activeTable) : null;
        setTop(topH);

        if (activeTable) {
          setSeats(listPubSeatAnchors(activeTable).map((s) => {
            const wp = pubSeatWorldPos(s.tableId, s.index);
            return {
              label: `seat ${s.index}`,
              height: wp ? baseHeight(wp) : NaN,
            };
          }));
        } else {
          setSeats([]);
        }

        const locks = new Set(listSeatLocks().map((l) => l.peerId));
        const next: Row[] = [];
        for (const body of getBrainPhysics().getBodies()) {
          if (!body.id.startsWith('peer-')) continue;
          const peerId = body.id.slice(5);
          const seatPos = seatedTransform(peerId) ?? seatedTransform(body.id);
          const world = (seatPos ?? body.pos) as [number, number, number];
          next.push({
            id: peerId.slice(0, 8),
            base: baseHeight(world),
            sunk: floorPenetration(world),
            locked: !!seatPos || locks.has(peerId),
            sees: topH == null ? null : seesTableTop(world, topH, seatPos ? 0.45 : 0),
          });
        }
        setRows(next);
      } catch { /* physics not ready */ }
    };
    sample();
    const id = window.setInterval(sample, 200);
    return () => window.clearInterval(id);
  }, [tableId]);

  return (
    <div className="pointer-events-none fixed left-3 top-24 z-[60] w-56 rounded-lg border border-primary/40 bg-[hsla(265,70%,7%,0.92)] p-2 font-mono text-[10px] leading-tight text-foreground">
      <div className="mb-1 uppercase tracking-wide text-primary">Seat debug</div>
      <div className="text-muted-foreground">
        table top: {top == null ? '—' : `${top.toFixed(2)} m`}
      </div>
      {seats.map((s) => (
        <div key={s.label} className="text-muted-foreground">
          {s.label}: {Number.isFinite(s.height) ? `${s.height.toFixed(2)} m` : 'unregistered'}
        </div>
      ))}
      <div className="mt-1 border-t border-primary/20 pt-1">
        {rows.length === 0 && <div className="text-muted-foreground">no remote peers</div>}
        {rows.map((r) => (
          <div key={r.id} className={r.sunk > 0.05 ? 'text-destructive' : ''}>
            {r.id} · base {r.base.toFixed(2)} · {r.locked ? 'seat' : 'free'}
            {r.sunk > 0.05 ? ` · sunk ${r.sunk.toFixed(2)}` : ''}
            {r.sees === false ? ' · no table view' : ''}
          </div>
        ))}
      </div>
    </div>
  );
}
