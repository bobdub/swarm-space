/**
 * PubGameLayer — the "walk up and play" glue.
 *
 * Watches the local avatar's proximity to registered pub anchors, shows
 * a single contextual prompt, and opens the matching game panel. The pub
 * is the interface: entry and exit are positional, the panel is only the
 * board readout.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNearbyInteractable } from '@/hooks/useNearbyInteractable';
import { DartsPanel } from '@/components/pub/DartsPanel';
import { CardTablePanel } from '@/components/pub/CardTablePanel';
import { isSeated, leaveSeat } from '@/lib/pub/seating';
import { leaveTable, setLocalPeerId } from '@/lib/pub/gameTableStore';
import { SeatDebugOverlay } from '@/components/pub/SeatDebugOverlay';
import {
  isOverheadView,
  isSeatDebugOn,
  subscribeSpectator,
  toggleOverheadView,
  toggleSeatDebug,
} from '@/lib/pub/spectatorCameraStore';

export function PubGameLayer({
  selfId,
  username,
  mobile,
}: {
  selfId: string;
  username: string;
  mobile?: boolean;
}) {
  const [openTableId, setOpenTableId] = useState<string | null>(null);
  // While playing, stay locked to the active game's anchor instead of
  // allowing neighbouring furniture to replace the proximity result.
  const near = useNearbyInteractable(selfId, openTableId);

  const nearTableId = near?.anchor.tableId ?? null;

  // Camera-only QA modes: overhead spectator view + seat debug read-out.
  const [, forceSpec] = useState(0);
  useEffect(() => subscribeSpectator(() => forceSpec((n) => (n + 1) & 0xfff)), []);
  const overhead = isOverheadView();
  const debugOn = isSeatDebugOn();

  // Let the mesh bridge know who we are so peer intents can be routed
  // to whichever table we happen to be hosting.
  useEffect(() => { setLocalPeerId(selfId); }, [selfId]);

  const open = useCallback(() => {
    if (nearTableId) setOpenTableId(nearTableId);
  }, [nearTableId]);

  const close = useCallback(() => {
    setOpenTableId((prev) => {
      if (prev) leaveTable(prev, selfId);
      leaveSeat();
      return null;
    });
  }, [selfId]);

  // Deliberately walking away closes the panel and frees the seat. Idle
  // physics drift can no longer switch this check to a neighbouring game.
  useEffect(() => {
    if (!openTableId) return;
    if (nearTableId === openTableId) return;
    // A pinned stool is stronger evidence than a sampled proximity result.
    // The next proximity update after deliberate movement sees the released
    // seat and starts the normal walk-away grace period.
    if (isSeated()) return;
    const timer = window.setTimeout(() => close(), 10_000);
    return () => window.clearTimeout(timer);
  }, [openTableId, nearTableId, close]);

  // Keyboard: E to join, Q to leave.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      if (e.key === 'e' || e.key === 'E') {
        if (!openTableId && nearTableId) open();
      } else if (e.key === 'q' || e.key === 'Q') {
        if (openTableId) close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openTableId, nearTableId, open, close]);

  if (!selfId) return null;

  return (
    <>
      {debugOn && <SeatDebugOverlay tableId={openTableId ?? nearTableId} />}

      <div className="pointer-events-auto fixed left-3 bottom-40 z-40 flex flex-col gap-1">
        <button
          type="button"
          onClick={toggleOverheadView}
          aria-pressed={overhead}
          className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-wide ${
            overhead
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-primary/50 bg-[hsla(265,70%,8%,0.85)] text-foreground'
          }`}
        >
          Overhead view
        </button>
        <button
          type="button"
          onClick={toggleSeatDebug}
          aria-pressed={debugOn}
          className={`rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-wide ${
            debugOn
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-primary/50 bg-[hsla(265,70%,8%,0.85)] text-foreground'
          }`}
        >
          Seat debug
        </button>
      </div>

      {!openTableId && near && (
        <div className="pointer-events-none fixed inset-x-0 bottom-40 z-40 flex justify-center px-3">
          <button
            type="button"
            onClick={open}
            className="pointer-events-auto rounded-full border border-primary/60 bg-[hsla(265,70%,8%,0.92)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-foreground shadow-[0_0_20px_hsla(265,70%,55%,0.4)]"
          >
            {mobile ? `Tap to ${near.interaction.label}` : `Press [E] to ${near.interaction.label}`}
          </button>
        </div>
      )}

      {openTableId && (
        <div className="pointer-events-none fixed right-3 top-20 z-[60] flex justify-end">
          {openTableId.startsWith('pub:cards:') ? (
            <CardTablePanel
              tableId={openTableId}
              selfId={selfId}
              username={username}
              onClose={close}
            />
          ) : (
            <DartsPanel
              tableId={openTableId}
              selfId={selfId}
              username={username}
              onClose={close}
            />
          )}
        </div>
      )}
    </>
  );
}
