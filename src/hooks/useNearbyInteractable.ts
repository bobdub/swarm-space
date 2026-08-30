/**
 * useNearbyInteractable — proximity scan for pub furniture.
 *
 * Polls (not per-frame) the local avatar's interpolated render position
 * against the registered pub anchors and returns the closest one inside
 * its radius. 5 Hz is plenty for a "Press E" prompt and costs nothing.
 */

import { useEffect, useState } from 'react';
import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';
import { findNearbyAnchor, type NearbyAnchor } from '@/lib/world/pubAnchors';

const POLL_MS = 200;

export function useNearbyInteractable(
  selfId: string | null,
  tableId?: string | null,
): NearbyAnchor | null {
  const [near, setNear] = useState<NearbyAnchor | null>(null);

  useEffect(() => {
    if (!selfId) {
      setNear(null);
      return;
    }
    let cancelled = false;

    const scan = () => {
      if (cancelled) return;
      try {
        const physics = getBrainPhysics();
        const body = physics.getBody(selfId);
        if (!body) {
          setNear((prev) => (prev ? null : prev));
          return;
        }
        const pos = (physics.getBodyRenderPos(selfId, performance.now()) ?? body.pos) as
          [number, number, number];
        const hit = findNearbyAnchor(pos, tableId);
        setNear((prev) => {
          if (!hit && !prev) return prev;
          if (hit && prev && prev.anchor.key === hit.anchor.key) return prev;
          return hit;
        });
      } catch {
        /* physics not ready yet */
      }
    };

    scan();
    const timer = window.setInterval(scan, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [selfId, tableId]);

  return near;
}
