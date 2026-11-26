import { useEffect } from 'react';
import { toast } from 'sonner';
import { CONSTELLATIONS } from '@/lib/brain/constellations';
import { onStarFound, useStarHunt } from '@/lib/brain/starHuntStore';

/**
 * Star hunt overlay: a small ring in the middle of the screen while you hold
 * your gaze on tonight's figure (it only appears once you are already on
 * it), and a toast when the find is logged.
 */
export function StarHuntHud() {
  const { progress, log } = useStarHunt();

  useEffect(() => onStarFound((id, entry) => {
    const chart = CONSTELLATIONS.find((c) => c.id === id);
    const name = chart?.name ?? 'a constellation';
    const logged = CONSTELLATIONS.filter((c) => c.id === id || log[c.id]).length;
    const all = logged === CONSTELLATIONS.length;
    toast.success(`★ You found ${name}!`, {
      description: all
        ? 'Every figure is in your star log. You are a Star Navigator.'
        : entry.count > 1
          ? `Found ${entry.count} times now. Check the bar for tomorrow's chart.`
          : `${logged} of ${CONSTELLATIONS.length} in your star log. A new chart goes up in the bar tomorrow.`,
    });
  }), [log]);

  if (progress <= 0) return null;
  const r = 22;
  const c = 2 * Math.PI * r;
  return (
    <div className="pointer-events-none fixed left-1/2 top-1/2 z-30 -translate-x-1/2 -translate-y-1/2" aria-hidden>
      <svg width="64" height="64" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={r} fill="none" stroke="hsla(220,80%,92%,0.15)" strokeWidth="3" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke="hsl(45,90%,70%)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${c * progress} ${c}`}
          transform="rotate(-90 32 32)"
        />
        <text x="32" y="37" textAnchor="middle" fontSize="16" fill="hsl(45,90%,80%)">✶</text>
      </svg>
    </div>
  );
}
