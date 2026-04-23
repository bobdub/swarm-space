import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
 * BuilderBlockView — display-only renderer over a BuilderBlock.
 *
 * Contract:
 *   - The BuilderBlockEngine owns the block's world transform, derived
 *     each physics tick from its Earth-local anchor + offsets.
 *   - The engine writes a volumetric support basin into the UQRC field
 *     at that live world position. The basin (a co-moving region of
 *     local geometry) is what holds the block on the surface — there is
 *     no single-cell pin and no shell projection here.
 *   - This view subscribes by `bodyId`, reads `body.pos` every frame,
 *     and only computes an orthonormal basis for orientation. It must
 *     never mutate `field.axes`, `body.pos`, or pin templates.
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
  const [block, setBlock] = useState(() => engine.getBlock(bodyId) ?? null);

  useEffect(() => {
    setBlock(engine.getBlock(bodyId) ?? null);
    const unsub = engine.subscribe((evt) => {
      if (evt.block.bodyId !== bodyId) return;
      if (evt.type === 'remove') setBlock(null);
      else setBlock(evt.block);
    });
    return unsub;
  }, [engine, bodyId]);

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
    // Render is read-only. The block's volumetric support basin (written
    // and re-stamped by builderBlockEngine each tick at the live
    // Earth-derived world position) is what holds it on the surface.
    void FEET_SHELL_RADIUS;
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