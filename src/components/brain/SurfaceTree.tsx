import { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  FEET_SHELL_RADIUS,
  getEarthPose,
  getEarthLocalSiteFrame,
  earthLocalToWorld,
  EARTH_RADIUS,
} from '@/lib/brain/earth';
import { COMPOUND_TABLE, blendColor } from '@/lib/virtualHub/compoundCatalog';
import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';

/**
 * SurfaceTree — first Building-Blocks-Engine test piece.
 *
 * A simple UQRC tree placed beside the SurfaceApartment to validate the
 * gameBuilder bridge end-to-end:
 *   - Pose stored in Earth-local lat/lon-ish coords (anchor + tangent
 *     offset), so it co-rotates with the planet.
 *   - Registers a real `'piece'` body in UqrcPhysics + pins a small
 *     curvature basin via `physics.pinPiece` (basin scaled by mass).
 *   - Render reads body pose every frame and reprojects onto the feet
 *     shell (mirrors SurfaceApartment contract verbatim).
 *
 * Trunk = cellulose (oak/door_single compound, real C₆H₁₀O₅).
 * Leaves = live blend of C+H+O+N from the shared element palette, so the
 * canopy color is derived from real periodic-table data, not a magic hex.
 *
 * Inherits the SurfaceApartment known bugs (no collider; uncalibrated
 * scale) — fix once globally in earth.ts when ready.
 */
export function SurfaceTree({
  anchorPeerId,
  // Tangent-plane offset from the village anchor, in metres. Defaults
 // place the tree ~12 m to the player's right and 18 m forward, so it
 // sits next to the apartment (which is at +25 m forward, 0 right).
  rightOffset = 12,
  forwardOffset = 18,
  id = 'tree-01',
}: {
  anchorPeerId: string;
  rightOffset?: number;
  forwardOffset?: number;
  id?: string;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const bodyId = useMemo(() => `${id}:${anchorPeerId}`, [id, anchorPeerId]);
  const ANCHOR_RADIUS = FEET_SHELL_RADIUS;

  // Trunk compound: oak / cellulose (already in catalog).
  const trunkColor = COMPOUND_TABLE.door_single.color;
  // Leaf "compound": chlorophyll-ish blend from real periodic-table elements.
  const leafColor = useMemo(
    () =>
      blendColor([
        { symbol: 'C', count: 55 },
        { symbol: 'H', count: 72 },
        { symbol: 'O', count: 5 },
        { symbol: 'N', count: 4 },
      ]),
    [],
  );

  // Build the tree pose in the SHARED spawn site frame, then reproject
  // to the feet shell so the trunk base sits exactly on the visible ground.
  const buildPose = (poseArg?: ReturnType<typeof getEarthPose>) => {
    const pose = poseArg ?? getEarthPose();
    const lf = getEarthLocalSiteFrame(anchorPeerId);
    const localPos: [number, number, number] = [
      lf.normal[0] * EARTH_RADIUS + lf.forward[0] * forwardOffset + lf.right[0] * rightOffset,
      lf.normal[1] * EARTH_RADIUS + lf.forward[1] * forwardOffset + lf.right[1] * rightOffset,
      lf.normal[2] * EARTH_RADIUS + lf.forward[2] * forwardOffset + lf.right[2] * rightOffset,
    ];
    const worldRaw = earthLocalToWorld(localPos, pose);
    const dxR = worldRaw[0] - pose.center[0];
    const dyR = worldRaw[1] - pose.center[1];
    const dzR = worldRaw[2] - pose.center[2];
    const rR = Math.hypot(dxR, dyR, dzR) || 1;
    const k = ANCHOR_RADIUS / rR;
    const worldPos: [number, number, number] = [
      pose.center[0] + dxR * k,
      pose.center[1] + dyR * k,
      pose.center[2] + dzR * k,
    ];
    // Use the shared spawn frame for orientation (matches apartment).
    const up = earthLocalToWorld(lf.normal, pose);
    const fwd = earthLocalToWorld(lf.forward, pose);
    const rgt = earthLocalToWorld(lf.right, pose);
    const upV: [number, number, number] = [up[0] - pose.center[0], up[1] - pose.center[1], up[2] - pose.center[2]];
    const fwdV: [number, number, number] = [fwd[0] - pose.center[0], fwd[1] - pose.center[1], fwd[2] - pose.center[2]];
    const rgtV: [number, number, number] = [rgt[0] - pose.center[0], rgt[1] - pose.center[1], rgt[2] - pose.center[2]];
    return { worldPos, up: upV, forward: fwdV, right: rgtV, pose };
  };

  // Register as a real UQRC `'piece'` body + pin a small curvature basin.
  useEffect(() => {
    const physics = getBrainPhysics();
    const { worldPos } = buildPose();
    physics.addBody({
      id: bodyId,
      kind: 'piece',
      pos: [...worldPos] as [number, number, number],
      vel: [0, 0, 0],
      mass: 8,
      trust: 1,
      meta: { attachedTo: 'earth-surface', structure: 'tree', anchorPeerId },
    });
    // Trees are lighter than the apartment → smaller basin.
    const pin = physics.pinPiece(worldPos, 0.25);
    return () => {
      try { physics.unpin(pin); } catch { /* ignore */ }
      physics.removeBody(bodyId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyId]);

  const initial = useMemo(() => {
    const { worldPos, up, forward, right } = buildPose();
    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(right[0], right[1], right[2]),
      new THREE.Vector3(up[0], up[1], up[2]),
      new THREE.Vector3(forward[0], forward[1], forward[2]),
    );
    const euler = new THREE.Euler().setFromRotationMatrix(m);
    return { worldPos, euler };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorPeerId, ANCHOR_RADIUS, rightOffset, forwardOffset]);

  useFrame(() => {
    if (!groupRef.current) return;
    const physics = getBrainPhysics();
    const body = physics.getBody(bodyId);
    const pose = getEarthPose();
    let worldPos: [number, number, number];
    let up: [number, number, number];
    let forward: [number, number, number];
    let right: [number, number, number];
    if (body) {
      const dx = body.pos[0] - pose.center[0];
      const dy = body.pos[1] - pose.center[1];
      const dz = body.pos[2] - pose.center[2];
      const r = Math.hypot(dx, dy, dz) || 1;
      const k = ANCHOR_RADIUS / r;
      body.pos[0] = pose.center[0] + dx * k;
      body.pos[1] = pose.center[1] + dy * k;
      body.pos[2] = pose.center[2] + dz * k;
      worldPos = [body.pos[0], body.pos[1], body.pos[2]];
      up = [dx / r, dy / r, dz / r];
      const lf = getEarthLocalSiteFrame(anchorPeerId);
      const fwdW = earthLocalToWorld(lf.forward, pose);
      const rgtW = earthLocalToWorld(lf.right, pose);
      forward = [fwdW[0] - pose.center[0], fwdW[1] - pose.center[1], fwdW[2] - pose.center[2]];
      right = [rgtW[0] - pose.center[0], rgtW[1] - pose.center[1], rgtW[2] - pose.center[2]];
      const dot = forward[0] * up[0] + forward[1] * up[1] + forward[2] * up[2];
      forward = [forward[0] - up[0] * dot, forward[1] - up[1] * dot, forward[2] - up[2] * dot];
      const fl = Math.hypot(forward[0], forward[1], forward[2]) || 1;
      forward = [forward[0] / fl, forward[1] / fl, forward[2] / fl];
      right = [
        up[1] * forward[2] - up[2] * forward[1],
        up[2] * forward[0] - up[0] * forward[2],
        up[0] * forward[1] - up[1] * forward[0],
      ];
    } else {
      const built = buildPose(pose);
      worldPos = built.worldPos;
      up = built.up;
      forward = built.forward;
      right = built.right;
    }
    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(right[0], right[1], right[2]),
      new THREE.Vector3(up[0], up[1], up[2]),
      new THREE.Vector3(forward[0], forward[1], forward[2]),
    );
    groupRef.current.position.set(worldPos[0], worldPos[1], worldPos[2]);
    groupRef.current.setRotationFromMatrix(m);
  });

  // Geometry — local frame: +Y is "up" (radial), -Z is forward.
  // Trunk: 0.4 m radius, 4 m tall. Canopy: stacked cones for a simple
  // pine-like silhouette so the test piece is unmistakable on Earth.
  const TRUNK_R = 0.4;
  const TRUNK_H = 4.0;
  return (
    <group
      ref={groupRef}
      position={initial.worldPos}
      rotation={[initial.euler.x, initial.euler.y, initial.euler.z]}
    >
      {/* Trunk — cellulose (oak) */}
      <mesh position={[0, TRUNK_H / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[TRUNK_R * 0.85, TRUNK_R, TRUNK_H, 12]} />
        <meshStandardMaterial color={trunkColor} roughness={0.92} />
      </mesh>
      {/* Canopy — three stacked cones, leaf-blend color */}
      <mesh position={[0, TRUNK_H + 0.6, 0]} castShadow>
        <coneGeometry args={[2.4, 2.4, 14]} />
        <meshStandardMaterial color={leafColor} roughness={0.8} />
      </mesh>
      <mesh position={[0, TRUNK_H + 1.9, 0]} castShadow>
        <coneGeometry args={[1.9, 2.0, 14]} />
        <meshStandardMaterial color={leafColor} roughness={0.8} />
      </mesh>
      <mesh position={[0, TRUNK_H + 3.0, 0]} castShadow>
        <coneGeometry args={[1.3, 1.6, 14]} />
        <meshStandardMaterial color={leafColor} roughness={0.8} />
      </mesh>
    </group>
  );
}