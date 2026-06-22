/**
 * BrainPreviewBackdrop — the layered radial gradient used as the
 * brain-area backdrop in live-post surfaces. Extracted so the inline
 * preview card and the floating dock body share the exact same
 * visual without duplicating markup.
 */
export function BrainPreviewBackdrop(): JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-0 opacity-60">
      <div className="absolute left-1/2 top-1/2 h-[120%] w-[120%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_center,hsla(180,80%,60%,0.18),transparent_60%)]" />
      <div className="absolute left-1/3 top-1/2 h-[60%] w-[60%] -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_center,hsla(326,71%,62%,0.12),transparent_70%)]" />
      <div className="absolute right-1/4 bottom-1/4 h-[40%] w-[40%] rounded-full bg-[radial-gradient(circle_at_center,hsla(265,70%,55%,0.18),transparent_70%)]" />
    </div>
  );
}

export default BrainPreviewBackdrop;