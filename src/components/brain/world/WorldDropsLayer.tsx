/**
 * WorldDropsLayer — loose pieces on the ground after something is felled.
 *
 * A drop bobs on the surface until the player walks within reach, then it
 * flies to them and folds into the element bag via `recordHarvestForResource`
 * — which is exactly what the plain-words material totals read from, so
 * the Wood counter ticks up without a second source of truth.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import {
  STRUCTURE_SHELL_RADIUS,
  getEarthPose,
  quatRotate,
  type Vec3,
} from '@/lib/brain/earth';
import { sampleSurfaceLift } from '@/lib/brain/surfaceProfile';
import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';
import { recordHarvestForResource } from '@/lib/remix/harvestedInventory';
import {
  claimDrop,
  listDrops,
  removeDrop,
  subscribeDrops,
  type WorldDrop,
} from '@/lib/world/worldDropsStore';

/** Walk this close and the piece flies to you. */
const PICKUP_RANGE_M = 2.4;
/** How long the fly-to-player animation lasts. */
const FLY_MS = 420;

const DROP_COLOR: Record<string, string> = {
  wood: 'hsl(28, 45%, 42%)',
  stone: 'hsl(210, 8%, 58%)',
  fibre: 'hsl(48, 55%, 58%)',
  food: 'hsl(348, 60%, 55%)',
};

export function WorldDropsLayer({ selfId }: { selfId?: string }) {
  const [drops, setDrops] = useState<WorldDrop[]>([]);
  useEffect(() => {
    setDrops(listDrops());
    return subscribeDrops(setDrops);
  }, []);

  if (!drops.length) return null;
  return (
    <>
      {drops.map((d) => (
        <DropPiece key={d.id} drop={d} selfId={selfId} />
      ))}
    </>
  );
}

function DropPiece({ drop, selfId }: { drop: WorldDrop; selfId?: string }) {
  const meshRef = useRef<THREE.Group>(null);
  const collectedRef = useRef(false);
  const color = useMemo(() => DROP_COLOR[drop.kind] ?? '#a1a1aa', [drop.kind]);

  useFrame(() => {
    const group = meshRef.current;
    if (!group) return;
    const pose = getEarthPose();
    const wd = quatRotate(pose.spinQuat, drop.localDir);
    const radius =
      STRUCTURE_SHELL_RADIUS + sampleSurfaceLift(drop.localDir) + 0.25 + (drop.upOffset ?? 0);
    const rest: Vec3 = [
      pose.center[0] + wd[0] * radius,
      pose.center[1] + wd[1] * radius,
      pose.center[2] + wd[2] * radius,
    ];

    const physics = getBrainPhysics();
    const body = selfId ? physics.getBody(selfId) : undefined;
    const bp = (selfId ? physics.getBodyRenderPos(selfId) : undefined) ?? body?.pos;

    if (drop.claimedAt && bp) {
      // Flying home — ease from the resting spot to the player, then bank it.
      const t = Math.min(1, (Date.now() - drop.claimedAt) / FLY_MS);
      const e = t * t * (3 - 2 * t);
      group.position.set(
        rest[0] + (bp[0] - rest[0]) * e,
        rest[1] + (bp[1] + 0.9 - rest[1]) * e,
        rest[2] + (bp[2] - rest[2]) * e,
      );
      group.scale.setScalar(Math.max(0.05, 1 - e * 0.8));
      if (t >= 1 && !collectedRef.current) {
        collectedRef.current = true;
        recordHarvestForResource(drop.kind, drop.qty);
        removeDrop(drop.id);
      }
      return;
    }

    group.position.set(rest[0], rest[1], rest[2]);
    const up = new THREE.Vector3(wd[0], wd[1], wd[2]).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
    group.quaternion.copy(q);
    group.rotateY((Date.now() % 6000) / 6000 * Math.PI * 2);

    if (bp && !drop.claimedAt) {
      const dist = Math.hypot(bp[0] - rest[0], bp[1] - rest[1], bp[2] - rest[2]);
      if (dist <= PICKUP_RANGE_M) claimDrop(drop.id);
    }
  });

  return (
    <group ref={meshRef}>
      <mesh castShadow>
        <boxGeometry args={[0.55, 0.22, 0.22]} />
        <meshStandardMaterial color={color} roughness={0.85} emissive={color} emissiveIntensity={0.15} />
      </mesh>
    </group>
  );
}
