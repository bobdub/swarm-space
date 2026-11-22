/**
 * BoatControls — the on-screen pieces for getting on and off the boat.
 *
 * - The hold button appears when you can board: on the jetty beside the
 *   boat ("Hold to board"), or swimming by the stern ladder or a gate
 *   ("Hold to climb aboard"). When one more person would push the boat's
 *   freeboard under 0.2 m it reads "Boat is full" instead.
 * - On deck, beside the wheel, the rowing bench or a rod holder, the same
 *   ring takes the wheel, the oars or a rod. While you hold a station the
 *   ring to let go sits at the lower right, out of your view.
 * - Jump: Space on a keyboard, or the round button beside the run bolt.
 *   It works anywhere you stand, which is how you leave the boat for a swim.
 */

import { useEffect, useRef, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { toast } from 'sonner';
import { usePressAndHold } from '@/hooks/usePressAndHold';
import { HoldProgressRing } from '@/components/ui/HoldProgressRing';
import { Button } from '@/components/ui/button';
import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';
import { teleportBody } from '@/lib/pub/seating';
import { leaveRole, takeRole } from '@/lib/brain/sea/crew';
import {
  HOLD_SLACK_M,
  boardingSpot,
  boatActionFor,
  deckWorldPos,
  type BoatAction,
} from '@/lib/brain/sea/villageBoat';

const HOLD_MS = 800;

function sameAction(a: BoatAction | null, b: BoatAction | null): boolean {
  if (!a || !b) return a === b;
  if (a.kind !== b.kind) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** How long (ms) an offer stays up after the body drifts out of reach, so
 *  a swimmer bobbing at the edge doesn't lose a hold half way. */
const OFFER_GRACE_MS = 700;

function useBoatAction(selfId: string): BoatAction | null {
  const [action, setAction] = useState<BoatAction | null>(null);
  const last = useRef<BoatAction | null>(null);
  const lostAt = useRef<number | null>(null);
  useEffect(() => {
    const poll = () => {
      const body = getBrainPhysics().getBody(selfId);
      let next = body ? boatActionFor(body.pos) : null;
      // Keep an approach or station offer briefly when it lapses (not a
      // leave offer: that follows the crew state exactly).
      const approach = last.current && (last.current.kind === 'climb' || last.current.kind === 'board' || last.current.kind === 'take');
      const nearby = body && approach ? boatActionFor(body.pos, HOLD_SLACK_M) : null;
      if (!next && approach && body && sameAction(nearby, last.current)) {
        const now = performance.now();
        if (lostAt.current === null) lostAt.current = now;
        if (now - lostAt.current < OFFER_GRACE_MS) next = last.current;
      } else {
        lostAt.current = null;
      }
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
      if (!a || a.kind === 'full' || a.kind === 'busy') return;
      // Re-check at the moment of boarding: the boat may have filled up.
      // Reaches get a little slack, so drifting while holding still works.
      const body = getBrainPhysics().getBody(selfId);
      const now = body ? boatActionFor(body.pos, HOLD_SLACK_M) : null;
      // A station hold only takes the station it offered.
      const swapped = a.kind === 'take' && now?.kind === 'take' && (now.role !== a.role || now.boatKey !== a.boatKey);
      if (!now || swapped) {
        if (a.kind === 'take') toast.message(`Step closer to the ${a.role === 'helm' ? 'wheel' : a.role === 'oars' ? 'oars' : 'rod'} and hold again`, { id: 'boat-hold' });
        else toast.message('Too far from the boat', { description: 'Swim to the ladder or a side of the boat and hold again.', id: 'boat-hold' });
        return;
      }
      if (now.kind === 'full') { toast.message('Boat is full', { id: 'boat-hold' }); return; }
      if (now.kind === 'busy') return;
      if (now.kind === 'take') { takeRole(now.role, selfId, now.boatKey, now.spot); return; }
      if (now.kind === 'leave') { leaveRole(); return; }
      const spot = boardingSpot(now);
      const world = spot ? deckWorldPos(spot[0], spot[1], now.boatKey) : null;
      if (world) teleportBody(selfId, world);
    },
    { durationMs: HOLD_MS, enabled: !!action && action.kind !== 'full' && action.kind !== 'busy' },
  );
  if (!action) return null;
  const full = action.kind === 'full' || action.kind === 'busy';
  const leaving = action.kind === 'leave';
  const label = action.kind === 'full'
    ? 'Boat is full'
    : action.kind === 'busy'
      ? 'Your boat is out with people aboard'
      : action.kind === 'board'
      ? 'Hold to board'
      : action.kind === 'climb'
        ? 'Hold to climb aboard'
        : action.kind === 'take'
          ? action.role === 'helm' ? 'Hold to take the wheel' : action.role === 'oars' ? 'Hold to take the oars' : 'Hold to take a rod'
          : action.role === 'helm' ? 'Hold to let go of the wheel' : action.role === 'oars' ? 'Hold to let go of the oars' : 'Hold to put the rod down';
  const displayLabel = leaving ? 'Let go' : action.kind === 'board' ? 'Board' : action.kind === 'climb' ? 'Climb aboard' : action.kind === 'take' ? action.role === 'helm' ? 'Take wheel' : action.role === 'oars' ? 'Take oars' : 'Take rod' : label;
  return (
    <Button
      type="button"
      variant="ghost"
      {...(full ? {} : hold.bind)}
      disabled={full}
      data-testid="boat-hold"
      aria-label={full ? label : `Press and hold: ${label.replace(/^Hold to /, '')}`}
      className={`absolute right-4 z-[70] flex min-h-9 max-w-[calc(100%-2rem)] items-center rounded-full border bg-background/80 text-foreground select-none touch-none gap-1 px-2 py-1 text-[11px] font-semibold tracking-normal [&_span]:tracking-normal ${full ? 'border-destructive/60' : 'border-accent/50'} ${leaving ? 'h-9 w-28' : ''}`}
      style={{
        // Approach and station prompts share the release slot, away from
        // the look-drag area and below the actions and compass.
        // Letting go sits at the lower right; approach and station prompts
        // stay on the right but above the joystick and jump controls.
        bottom: leaving
          ? 'calc(env(safe-area-inset-bottom, 0px) + 0.5rem)'
          : mobile ? 'calc(env(safe-area-inset-bottom, 0px) + 13rem)' : 'calc(env(safe-area-inset-bottom, 0px) + 7rem)',
        opacity: full ? 0.8 : 1,
        touchAction: 'none',
        WebkitTouchCallout: 'none',
        cursor: full ? 'default' : 'pointer',
      }}
    >
      {!full && <HoldProgressRing value={hold.progress} size={16} />}
      {/* The label stays put while the ring fills: a button that shrank
          under a held finger could slip out from under it. */}
      <span>{displayLabel}</span>
    </Button>
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
