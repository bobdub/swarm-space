/**
 * BoatControls — the on-screen pieces for getting on and off the boat.
 *
 * - The hold button appears when you can board: on the jetty beside the
 *   boat ("Hold to board"), or swimming by the stern ladder or a gate
 *   ("Hold to climb aboard"). When one more person would push the boat's
 *   freeboard under 0.2 m it reads "Boat is full" instead.
 * - Jump: Space on a keyboard, or the round button beside the run bolt.
 *   It works anywhere you stand, which is how you leave the boat for a swim.
 */

import { useEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { usePressAndHold } from '@/hooks/usePressAndHold';
import { HoldProgressRing } from '@/components/ui/HoldProgressRing';
import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';
import { teleportBody } from '@/lib/pub/seating';
import {
  boardingSpot,
  boatActionFor,
  deckWorldPos,
  type BoatAction,
} from '@/lib/brain/sea/villageBoat';

const HOLD_MS = 800;

function sameAction(a: BoatAction | null, b: BoatAction | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  return a.kind !== 'climb' || (b.kind === 'climb' && a.from === b.from);
}

function useBoatAction(selfId: string): BoatAction | null {
  const [action, setAction] = useState<BoatAction | null>(null);
  const last = useRef<BoatAction | null>(null);
  useEffect(() => {
    const poll = () => {
      const body = getBrainPhysics().getBody(selfId);
      const next = body ? boatActionFor(body.pos) : null;
      if (!sameAction(next, last.current)) {
        last.current = next;
        setAction(next);
      }
    };
    poll();
    const id = setInterval(poll, 200);
    return () => clearInterval(id);
  }, [selfId]);
  return action;
}

export function BoatHoldButton({ selfId, mobile }: { selfId: string; mobile: boolean }) {
  const action = useBoatAction(selfId);
  const actionRef = useRef(action);
  actionRef.current = action;
  const hold = usePressAndHold(
    () => {
      const a = actionRef.current;
      if (!a || a.kind === 'full') return;
      // Re-check at the moment of boarding: the boat may have filled up.
      const body = getBrainPhysics().getBody(selfId);
      const now = body ? boatActionFor(body.pos) : null;
      if (!now || now.kind === 'full') return;
      const spot = boardingSpot(now);
      const world = spot ? deckWorldPos(spot[0], spot[1]) : null;
      if (world) teleportBody(selfId, world);
    },
    { durationMs: HOLD_MS, enabled: !!action && action.kind !== 'full' },
  );
  if (!action) return null;
  const full = action.kind === 'full';
  const label = full ? 'Boat is full' : action.kind === 'board' ? 'Hold to board' : 'Hold to climb aboard';
  return (
    <button
      type="button"
      {...(full ? {} : hold.bind)}
      disabled={full}
      data-testid="boat-hold"
      aria-label={full ? 'The boat is full' : `Press and hold to ${action.kind === 'board' ? 'board the boat' : 'climb aboard'}`}
      className="absolute z-[70] left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold text-white select-none"
      style={{
        bottom: mobile ? 'calc(env(safe-area-inset-bottom, 0px) + 13rem)' : 'calc(env(safe-area-inset-bottom, 0px) + 7rem)',
        background: 'hsla(265,70%,8%,0.85)',
        borderColor: full ? 'hsla(0,70%,60%,0.6)' : 'hsla(180,80%,60%,0.55)',
        opacity: full ? 0.8 : 1,
        touchAction: 'none',
        WebkitTouchCallout: 'none',
        cursor: full ? 'default' : 'pointer',
      }}
    >
      {!full && <HoldProgressRing value={hold.progress} size={20} />}
      <span>{hold.progress > 0 && !full ? `${Math.round(hold.progress * 100)}%` : label}</span>
    </button>
  );
}

export function JumpButton({ selfId, mobile }: { selfId: string; mobile: boolean }) {
  // Space jumps too.
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      // A just-pressed on-screen button keeps focus; Space would click it
      // again. In the world, Space means jump.
      if (t && t.tagName === 'BUTTON') t.blur();
      e.preventDefault();
      getBrainPhysics().jump(selfId);
    };
    window.addEventListener('keydown', onDown);
    return () => window.removeEventListener('keydown', onDown);
  }, [selfId]);
  return (
    <button
      type="button"
      data-testid="jump-button"
      aria-label="Jump (Space)"
      title="Jump (Space)"
      onPointerDown={(e) => { e.preventDefault(); getBrainPhysics().jump(selfId); }}
      className="absolute z-[70] flex h-14 w-14 items-center justify-center rounded-full border-2 text-white"
      style={{
        background: 'hsla(265,70%,8%,0.7)',
        borderColor: 'hsla(180,80%,60%,0.4)',
        touchAction: 'none',
        ...(mobile
          ? { bottom: 'calc(env(safe-area-inset-bottom, 0px) + 8rem)', left: '5rem' }
          : { bottom: 'calc(env(safe-area-inset-bottom, 0px) + 14rem)', right: '5rem' }),
      }}
    >
      <ArrowUp className="h-5 w-5" />
    </button>
  );
}
