/**
 * HoldProgressRing — the circular fill shown while a press-and-hold is in
 * progress. Matches the ring on the "Hold to build" prompt.
 */
export function HoldProgressRing({ value, size = 20 }: { value: number; size?: number }) {
  const R = 11;
  const C = 2 * Math.PI * R;
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <circle cx={14} cy={14} r={R} fill="none" stroke="hsla(0,0%,100%,0.18)" strokeWidth={3} />
      <circle
        cx={14}
        cy={14}
        r={R}
        fill="none"
        stroke="hsl(265,85%,70%)"
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={C}
        strokeDashoffset={C * (1 - value)}
        transform="rotate(-90 14 14)"
      />
    </svg>
  );
}
