import { useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  FEET_SHELL_RADIUS,
  getEarthPose,
  getEarthLocalSiteFrame,
  earthLocalToWorld,
} from '@/lib/brain/earth';
import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';
import { getBuilderBlockEngine, type BuilderBlock } from '@/lib/brain/builderBlockEngine';

/**
 * BuilderBlockView — generic renderer for any block placed via the
 * BuilderBlockEngine. Subscribes by `bodyId`, reads physics state every
 * frame, reprojects onto the feet shell, and exposes a stable local
 * frame to its children (origin = block worldPos, +Y = local up).
 *
 * Mirrors the SurfaceApartment contract — render is a read-only consumer
 * of physics. Never mutates `field.axes`, `body.pos`, or pin templates;
 * the only writes go through the engine API.
 */
export function BuilderBlockView({
  bodyId,
  children,
}: {
  bodyId: string;
  children: (block: BuilderBlock) => ReactNode;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const engine = useMemo(() => getBuilderBlockEngine(), []);
  const block = engine.getBlock(bodyId);

  useFrame(() => {
    if (!groupRef.current || !block) return;
    const physics = getBrainPhysics();
    const body = physics.getBody(block.bodyId);
    if (!body) return;
    const pose = getEarthPose();
    const dx = body.pos[0] - pose.center[0];
    const dy = body.pos[1] - pose.center[1];
    const dz = body.pos[2] - pose.center[2];
    const r = Math.hypot(dx, dy, dz) || 1;
    // Re-pin to feet shell each tick so block co-moves with Earth's orbit.
    const k = FEET_SHELL_RADIUS / r;
    body.pos[0] = pose.center[0] + dx * k;
    body.pos[1] = pose.center[1] + dy * k;
    body.pos[2] = pose.center[2] + dz * k;
    const worldPos: [number, number, number] = [body.pos[0], body.pos[1], body.pos[2]];
    const up: [number, number, number] = [dx / r, dy / r, dz / r];
    const lf = getEarthLocalSiteFrame(block.anchorPeerId);
    const fwdW = earthLocalToWorld(lf.forward, pose);
    const rgtW = earthLocalToWorld(lf.right, pose);
    let forward: [number, number, number] = [
      fwdW[0] - pose.center[0], fwdW[1] - pose.center[1], fwdW[2] - pose.center[2],
    ];
    const dot = forward[0] * up[0] + forward[1] * up[1] + forward[2] * up[2];
    forward = [forward[0] - up[0] * dot, forward[1] - up[1] * dot, forward[2] - up[2] * dot];
    const fl = Math.hypot(forward[0], forward[1], forward[2]) || 1;
    forward = [forward[0] / fl, forward[1] / fl, forward[2] / fl];
    void rgtW;
    const right: [number, number, number] = [
      up[1] * forward[2] - up[2] * forward[1],
      up[2] * forward[0] - up[0] * forward[2],
      up[0] * forward[1] - up[1] * forward[0],
    ];
    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(right[0], right[1], right[2]),
      new THREE.Vector3(up[0], up[1], up[2]),
      new THREE.Vector3(forward[0], forward[1], forward[2]),
    );
    groupRef.current.position.set(worldPos[0], worldPos[1], worldPos[2]);
    groupRef.current.setRotationFromMatrix(m);
  });

  if (!block) return null;
  return <group ref={groupRef}>{children(block)}</group>;
}