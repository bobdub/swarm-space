import { useEffect, useMemo, useState } from 'react';
import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';
import { BODY_CENTER_HEIGHT, EARTH_RADIUS, getEarthPose, radiusFromEarth } from '@/lib/brain/earth';

/** Slow status sampling stays outside the component that owns the Canvas. */
export function BrainStatusReadout({ title, selfId, voiceCount, compact = false }: { title?: string; selfId: string; voiceCount: number; compact?: boolean }) {
  const physics = useMemo(() => getBrainPhysics(), []);
  const [, refresh] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => refresh((tick) => tick + 1), 500);
    return () => clearInterval(timer);
  }, []);
  const body = physics.getBody(selfId);
  const altitude = body
    ? `${(radiusFromEarth(body.pos, getEarthPose()) - EARTH_RADIUS - BODY_CENTER_HEIGHT).toFixed(2)}m`
    : '—';
  const q = physics.getQScore();
  if (compact) return <>
    <span>{title || 'Brain'}</span>
    <span>q={q.toFixed(3)}</span>
    <span>alt={altitude}</span>
    <span>voice:{voiceCount}</span>
  </>;
  return <>{title ? `${title} · ` : ''}|Ψ_Brain⟩ q={q.toFixed(4)} · alt={altitude} · voice:{voiceCount}</>;
}