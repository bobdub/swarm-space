/**
 * PubDrinkProps — a pint glass floats beside anyone who has just been
 * bought a drink. Purely cosmetic, TTL-bounded, no physics bodies.
 */

import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import type { Group } from 'three';
import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';
import { getEarthPose } from '@/lib/brain/earth';
import { activeDrinkHolders, useDrinks } from '@/lib/pub/drinks';

function Glass({ peerId }: { peerId: string }) {
  const ref = useRef<Group>(null);

  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const physics = getBrainPhysics();
    const body = physics.getBody(peerId);
    if (!body) { g.visible = false; return; }
    const p = physics.getBodyRenderPos(peerId, performance.now()) ?? body.pos;
    const pose = getEarthPose();
    const ux = p[0] - pose.center[0];
    const uy = p[1] - pose.center[1];
    const uz = p[2] - pose.center[2];
    const len = Math.hypot(ux, uy, uz) || 1;
    // Hover just above shoulder height, offset along local up.
    g.position.set(p[0] + (ux / len) * 1.1, p[1] + (uy / len) * 1.1, p[2] + (uz / len) * 1.1);
    g.up.set(ux / len, uy / len, uz / len);
    g.visible = true;
  });

  return (
    <group ref={ref}>
      <mesh>
        <cylinderGeometry args={[0.09, 0.07, 0.22, 12, 1, true]} />
        <meshStandardMaterial color="#cfe8ff" transparent opacity={0.35} />
      </mesh>
      <mesh position={[0, -0.02, 0]}>
        <cylinderGeometry args={[0.08, 0.065, 0.16, 12]} />
        <meshStandardMaterial color="#d98a1f" emissive="#7a4a08" emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[0, 0.09, 0]}>
        <cylinderGeometry args={[0.085, 0.085, 0.04, 12]} />
        <meshStandardMaterial color="#fff6e6" />
      </mesh>
    </group>
  );
}

export function PubDrinkProps() {
  // Re-renders whenever a drink lands; the list itself is TTL-pruned.
  useDrinks();
  const holders = useMemo(() => activeDrinkHolders(), []);
  return (
    <>
      {holders.map((h) => (
        <Glass key={`${h.peerId}-${h.since}`} peerId={h.peerId} />
      ))}
    </>
  );
}
