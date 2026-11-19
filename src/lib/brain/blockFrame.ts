import * as THREE from 'three';
import { getEarthPose, getEarthLocalSiteFrame, earthLocalToWorld } from '@/lib/brain/earth';
import { blockWorldPos, type BuilderBlock } from '@/lib/brain/builderBlockEngine';

/**
 * World position + orientation (x = right, y = up, z = forward) of a
 * block for the current Earth pose — exactly the transform
 * `BuilderBlockView` draws the block with. Exposed so a renderer can put
 * one block's position into another block's local frame.
 */
export function blockWorldBasis(block: BuilderBlock): { worldPos: [number, number, number]; m: THREE.Matrix4 } {
  const pose = getEarthPose();
  const worldPos = blockWorldPos(block);
  const dx = worldPos[0] - pose.center[0];
  const dy = worldPos[1] - pose.center[1];
  const dz = worldPos[2] - pose.center[2];
  const r = Math.hypot(dx, dy, dz) || 1;
  const up: [number, number, number] = [dx / r, dy / r, dz / r];

  const lf = getEarthLocalSiteFrame(block.anchorPeerId);
  const fwdW = earthLocalToWorld(lf.forward, pose);
  let forward: [number, number, number] = [
    fwdW[0] - pose.center[0], fwdW[1] - pose.center[1], fwdW[2] - pose.center[2],
  ];
  const dot = forward[0] * up[0] + forward[1] * up[1] + forward[2] * up[2];
  forward = [forward[0] - up[0] * dot, forward[1] - up[1] * dot, forward[2] - up[2] * dot];
  const fl = Math.hypot(forward[0], forward[1], forward[2]) || 1;
  forward = [forward[0] / fl, forward[1] / fl, forward[2] / fl];
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
  return { worldPos, m };
}

/**
 * Position of `target`'s origin in `origin`'s local frame (metres,
 * x = right, y = up, z = forward). Both blocks ride the same rigid Earth,
 * so the answer does not change with the pose.
 */
export function blockOffsetInFrame(origin: BuilderBlock, target: BuilderBlock): [number, number, number] {
  const { worldPos: o, m } = blockWorldBasis(origin);
  const t = blockWorldPos(target);
  const v = new THREE.Vector3(t[0] - o[0], t[1] - o[1], t[2] - o[2]);
  v.applyMatrix4(new THREE.Matrix4().copy(m).transpose());
  return [v.x, v.y, v.z];
}
