import { useEffect, useMemo, useState } from 'react';
import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';
import { BODY_CENTER_HEIGHT, EARTH_RADIUS, getEarthPose, radiusFromEarth } from '@/lib/brain/earth';

/** Slow status sampling stays outside the component that owns the Canvas. */
export function BrainStatusReadout({ title, selfId, voiceCount }: { title?: string; selfId: string; voiceCount: number }) {
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
  return <>{title ? `${title} · ` : ''}|Ψ_Brain⟩ q={physics.getQScore().toFixed(4)} · alt={altitude} · voice:{voiceCount}</>;
}