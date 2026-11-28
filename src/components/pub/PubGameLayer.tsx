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

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNearbyInteractable } from '@/hooks/useNearbyInteractable';
import { usePressAndHold } from '@/hooks/usePressAndHold';
import { HoldProgressRing } from '@/components/ui/HoldProgressRing';
import { setActiveTable } from '@/lib/pub/activeTableStore';
import { DartsPanel } from '@/components/pub/DartsPanel';
import { CardTablePanel } from '@/components/pub/CardTablePanel';
import { BarMenuPanel } from '@/components/pub/BarMenuPanel';
import { isSeated, leaveSeat, takeSeatAt } from '@/lib/pub/seating';
import { getSeatPose, subscribeSeat } from '@/lib/pub/seatStore';
import { barTableForStool, isBarStoolTable } from '@/lib/pub/barStools';
import { leaveTable, setLocalPeerAliasResolver, setLocalPeerId } from '@/lib/pub/gameTableStore';
import { getLocalMeshPeerId } from '@/lib/streaming/webrtcSignalingBridge.standalone';
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
  // Seated on a counter stool, the only thing in reach is that bar's
  // drinks menu, so you can order without getting up.
  const atStool = isBarStoolTable(openTableId);
  const near = useNearbyInteractable(selfId, atStool ? barTableForStool(openTableId) : openTableId);
  // The stool you were on when you opened the menu from your seat.
  const orderedFromStool = useRef<string | null>(null);

  const nearTableId = near?.anchor.tableId ?? null;

  // Camera-only QA modes: overhead spectator view + seat debug read-out.
  const [, forceSpec] = useState(0);
  useEffect(() => subscribeSpectator(() => forceSpec((n) => (n + 1) & 0xfff)), []);
  const debugOn = isSeatDebugOn();

  // Let the mesh bridge know who we are so peer intents can be routed
  // to whichever table we happen to be hosting.
  useEffect(() => { setLocalPeerId(selfId); }, [selfId]);

  // Other players know us by our mesh peer id, not our account id. Stamp
  // it on the seat we take so they can find it and draw us on the stool.
  useEffect(() => {
    setLocalPeerAliasResolver(getLocalMeshPeerId);
    return () => setLocalPeerAliasResolver(null);
  }, []);

  const open = useCallback(() => {
    if (!nearTableId) return;
    // A counter stool has no game: sitting down IS the interaction.
    if (isBarStoolTable(nearTableId)) {
      if (!takeSeatAt(nearTableId, 0, selfId)) return;
    }
    orderedFromStool.current = atStool ? openTableId : null;
    setOpenTableId(nearTableId);
  }, [nearTableId, selfId, atStool, openTableId]);

  const close = useCallback(() => {
    setOpenTableId((prev) => {
      // Closing the menu you opened from a stool puts you back on the stool.
      const stool = orderedFromStool.current;
      orderedFromStool.current = null;
      if (stool && prev?.startsWith('pub:bar:') && isSeated()) return stool;
      // Neither the bar counter nor a counter stool is a game table.
      if (prev && !prev.startsWith('pub:bar:') && !isBarStoolTable(prev)) leaveTable(prev, selfId);
      leaveSeat();
      return null;
    });
  }, [selfId]);

  // Let the 3D bar draw the in-world "hold to leave" button.
  useEffect(() => {
    setActiveTable(openTableId, close);
  }, [openTableId, close]);
  useEffect(() => () => setActiveTable(null, null), []);

  // Leaving the Brain while perched must not strand the stool pin: the
  // card table releases its seat on unmount, counter stools do it here.
  const openTableRef = useRef(openTableId);
  openTableRef.current = openTableId;
  useEffect(() => () => {
    if (isBarStoolTable(openTableRef.current) || orderedFromStool.current) leaveSeat();
  }, []);

  // Standing up from a counter stool (moving, Q, or the button) ends the
  // perch straight away so the next stool along is immediately sittable.
  useEffect(() => {
    if (!atStool) return;
    return subscribeSeat(() => {
      if (getSeatPose().pitch !== null) return;
      // Deferred: standUp can fire from inside close()'s state updater.
      queueMicrotask(() => setOpenTableId((prev) => (isBarStoolTable(prev) ? null : prev)));
    });
  }, [atStool]);

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
    enabled: (!openTableId || atStool) && !!nearTableId,
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


      {(!openTableId && near) || atStool ? (
        <div className="pointer-events-none fixed inset-x-0 bottom-40 z-40 flex flex-wrap justify-center gap-2 px-3">
          {(!openTableId || atStool) && near && (
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
          )}
          {atStool && (
            <button
              type="button"
              onClick={close}
              data-testid="pub-stand-up"
              className="pointer-events-auto rounded-full border border-primary/60 bg-[hsla(265,70%,8%,0.92)] px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-foreground shadow-[0_0_20px_hsla(265,70%,55%,0.4)]"
            >
              Stand up{mobile ? '' : ' · Q'}
            </button>
          )}
        </div>
      ) : null}

      {openTableId && !atStool && (
        <div className="pointer-events-none fixed right-3 top-20 z-[60] flex justify-end">
          {openTableId.startsWith('pub:bar:') ? (
            <BarMenuPanel selfId={selfId} username={username} onClose={close} />
          ) : openTableId.startsWith('pub:cards:') ? (
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
