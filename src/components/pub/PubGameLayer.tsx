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
import { leaveSeat } from '@/lib/pub/seating';
import { leaveTable, setLocalPeerId } from '@/lib/pub/gameTableStore';

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
