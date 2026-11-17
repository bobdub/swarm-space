/**
 * PubLeaveHold — the small in-world "hold to leave" button drawn on the
 * card table and beside the dartboard while you are playing there.
 *
 * Same press-and-hold ring as sitting down and raising a build, just
 * smaller. Mouse and touch both work.
 */

import { usePressAndHold } from '@/hooks/usePressAndHold';
import { HoldProgressRing } from '@/components/ui/HoldProgressRing';
import { leaveActiveTable } from '@/lib/pub/activeTableStore';

const LEAVE_HOLD_MS = 700;

export function PubLeaveHold({ label = 'Leave' }: { label?: string }) {
  const hold = usePressAndHold(leaveActiveTable, { durationMs: LEAVE_HOLD_MS });
  return (
    <button
      type="button"
      {...hold.bind}
      data-testid="pub-leave-hold"
      aria-label={`Press and hold to ${label.toLowerCase()}`}
      title="Hold to leave"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        padding: '2px 7px 2px 2px',
        borderRadius: 999,
        background: 'hsla(265,70%,8%,0.85)',
        border: '1px solid hsla(265,80%,65%,0.6)',
        color: 'white',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
        userSelect: 'none',
        touchAction: 'none',
        WebkitTouchCallout: 'none',
      }}
    >
      <HoldProgressRing value={hold.progress} size={14} />
      <span>{hold.progress > 0 ? `${Math.round(hold.progress * 100)}%` : label}</span>
    </button>
  );
}
