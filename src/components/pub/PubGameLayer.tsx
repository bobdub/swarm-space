/**
 * PubGameLayer — the "walk up and play" glue.
 *
 * Watches the local avatar's proximity to registered pub anchors, shows
 * a single contextual prompt, and opens the matching game panel. The pub
 * is the interface: entry and exit are positional, the panel is only the
 * board readout.
 *
 * Sitting at the card table or stepping up to the darts board uses the
 * same press-and-hold as raising a staged build: hold the prompt until
 * the ring fills. Pointer events make this work with mouse and touch.
 */

import { useCallback, useEffect, useState } from 'react';
import { useNearbyInteractable } from '@/hooks/useNearbyInteractable';
import { usePressAndHold } from '@/hooks/usePressAndHold';
import { HoldProgressRing } from '@/components/ui/HoldProgressRing';
import { setActiveTable } from '@/lib/pub/activeTableStore';
import { DartsPanel } from '@/components/pub/DartsPanel';
import { CardTablePanel } from '@/components/pub/CardTablePanel';
import { isSeated, leaveSeat } from '@/lib/pub/seating';
import { leaveTable, setLocalPeerId } from '@/lib/pub/gameTableStore';
import { SeatDebugOverlay } from '@/components/pub/SeatDebugOverlay';
import {
  isSeatDebugOn,
  subscribeSpectator,
} from '@/lib/pub/spectatorCameraStore';

/** How long to hold the prompt before you sit down or step up to play. */
const SIT_HOLD_MS = 900;

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

  // Let the 3D bar draw the in-world "hold to leave" button.
  useEffect(() => {
    setActiveTable(openTableId, close);
  }, [openTableId, close]);
  useEffect(() => () => setActiveTable(null, null), []);

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

  // Press-and-hold to sit or play, the same gesture as raising a build.
  const hold = usePressAndHold(open, {
    durationMs: SIT_HOLD_MS,
    enabled: !openTableId && !!nearTableId,
  });

  // Keyboard: Q still leaves. Joining is press-and-hold only.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName)) return;
      if (target?.isContentEditable) return;
      if (e.key === 'q' || e.key === 'Q') {
        if (openTableId) close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openTableId, close]);

  if (!selfId) return null;

  return (
    <>
      {debugOn && <SeatDebugOverlay tableId={openTableId ?? nearTableId} />}

      {/* Overhead view + seat debug now live in the builder Options tab. */}


      {!openTableId && near && (
        <div className="pointer-events-none fixed inset-x-0 bottom-40 z-40 flex justify-center px-3">
          <button
            type="button"
            {...hold.bind}
            data-testid="pub-hold-prompt"
            aria-label={`Press and hold to ${near.interaction.label}`}
            style={{ touchAction: 'none', WebkitTouchCallout: 'none' }}
            className="pointer-events-auto flex select-none items-center gap-2 rounded-full border border-primary/60 bg-[hsla(265,70%,8%,0.92)] py-1.5 pl-1.5 pr-4 text-xs font-semibold uppercase tracking-wide text-foreground shadow-[0_0_20px_hsla(265,70%,55%,0.4)]"
          >
            <HoldProgressRing value={hold.progress} size={24} />
            <span>
              {hold.progress > 0
                ? `${near.interaction.label} · ${Math.round(hold.progress * 100)}%`
                : `${mobile ? 'Touch' : 'Press'} and hold to ${near.interaction.label}`}
            </span>
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
