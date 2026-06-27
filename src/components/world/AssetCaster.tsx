/**
 * AssetCaster — unified in-Canvas placement surface.
 *
 * When a placement session is armed (see `assetCaster` registry), this
 * surface:
 *   1. Arms an invisible placement surface; no confirmable object exists yet.
 *   2. First click/tap drops the ghost exactly onto the visible grid.
 *   3. Requires an explicit click/tap drop before Confirm appears.
 *
 * Ghost shape comes from the session payload (box for prefabs, ring for
 * portals). Surface is invisible when no session is pending so default
 * planet interactions remain unaffected.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import {
  EARTH_RADIUS,
  STRUCTURE_SHELL_RADIUS,
  getEarthPose,
  getEarthLocalSiteFrame,
  quatRotate,
  worldDisplacementToEarthLocal,
  type Vec3,
} from '@/lib/brain/earth';
import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';
import { sampleSurfaceLift } from '@/lib/brain/surfaceProfile';
import { CELL, WORLD_GRID_ORIGIN_ANCHOR } from '@/lib/world/buildGrid';
import { BUILDER_MODE_EVENT, type BuilderModeEventDetail } from '@/lib/brain/useBrainBuilder';
import {
  getPendingCast,
  subscribeCast,
  setCastHitSilent,
  updateCastHit,
  rotateCast,
  confirmCast,
  clearPendingCast,
  type PendingCast,
} from '@/lib/world/assetCaster';

const RAYCAST_RADIUS = EARTH_RADIUS + 1.2;
const SURFACE_CLEARANCE = 0.03;
/** Distance (m) in front of the avatar to seed the ghost. Two grid
 *  cells keeps the prefab on the first visible grid line ahead of the
 *  player instead of half-way to the horizon. */
const SPAWN_FORWARD_M = CELL * 2;

/** Intersect a ray (origin, dir) with a sphere; return the near hit or null. */
function intersectShell(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  center: THREE.Vector3,
  radius: number,
): THREE.Vector3 | null {
  const oc = new THREE.Vector3().subVectors(origin, center);
  const b = oc.dot(dir);
  const c = oc.lengthSq() - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t <= 0) return null;
  return new THREE.Vector3().copy(dir).multiplyScalar(t).add(origin);
}

interface AssetCasterProps {
  /** Local peer id — used to find the player body for ghost seeding. */
  selfId?: string;
}

export function AssetCaster({ selfId }: AssetCasterProps = {}) {
  const { camera } = useThree();
  const sphereRef = useRef<THREE.Mesh>(null);
  const ghostRef = useRef<THREE.Group>(null);
  const draggingRef = useRef(false);
  // Earth-local unit direction of the ghost. Stored so the ghost sticks
  // to the rotating surface instead of drifting in world space.
  const localDirRef = useRef<Vec3 | null>(null);
  const [cast, setCast] = useState<PendingCast | null>(() => getPendingCast());
  const freeBuildRef = useRef<boolean>(false);

  useEffect(() => {
    const onMode = (e: Event) => {
      const d = (e as CustomEvent<BuilderModeEventDetail>).detail;
      freeBuildRef.current = !!d?.freeBuild;
    };
    window.addEventListener(BUILDER_MODE_EVENT, onMode as EventListener);
    return () => window.removeEventListener(BUILDER_MODE_EVENT, onMode as EventListener);
  }, []);

  useEffect(() => subscribeCast((next) => {
    setCast(next);
    if (!next) localDirRef.current = null;
  }), []);

  // Convert a world-space hit on the shell into an Earth-local unit dir.
  const worldHitToLocalDir = (hit: Vec3): Vec3 => {
    const pose = getEarthPose();
    const dx = hit[0] - pose.center[0];
    const dy = hit[1] - pose.center[1];
    const dz = hit[2] - pose.center[2];
    const r = Math.hypot(dx, dy, dz) || 1;
    return quatRotate(pose.invSpinQuat, [dx / r, dy / r, dz / r]);
  };

  const surfaceRadiusFor = (localDir: Vec3): number =>
    STRUCTURE_SHELL_RADIUS + sampleSurfaceLift(localDir) + SURFACE_CLEARANCE;

  const localDirToWorldHit = (localDir: Vec3): Vec3 => {
    const pose = getEarthPose();
    const radius = surfaceRadiusFor(localDir);
    const wd = quatRotate(pose.spinQuat, localDir);
    return [
      pose.center[0] + wd[0] * radius,
      pose.center[1] + wd[1] * radius,
      pose.center[2] + wd[2] * radius,
    ];
  };

  const localBodyNormal = (): Vec3 | null => {
    const pose = getEarthPose();
    const physics = getBrainPhysics();
    const body = selfId ? physics.getBody(selfId) : undefined;
    if (!body) return null;
    const disp: [number, number, number] = [
      body.pos[0] - pose.center[0],
      body.pos[1] - pose.center[1],
      body.pos[2] - pose.center[2],
    ];
    const local = worldDisplacementToEarthLocal(disp, pose);
    const rN = Math.hypot(local[0], local[1], local[2]) || 1;
    return [local[0] / rN, local[1] / rN, local[2] / rN];
  };

  /** Snap an Earth-local unit dir to the visible player-following grid.
   *  This keeps the ghost near the avatar; the old global-tangent
   *  reconstruction could jump the asset back toward the grid origin. */
  const snapLocalDirToGrid = (localDir: Vec3): Vec3 => {
    if (freeBuildRef.current) return localDir;
    const pose = getEarthPose();
    const centerN = localBodyNormal() ?? localDir;
    const centerR = surfaceRadiusFor(centerN);
    const pointR = surfaceRadiusFor(localDir);
    const centerPos: Vec3 = [centerN[0] * centerR, centerN[1] * centerR, centerN[2] * centerR];
    const pointPos: Vec3 = [localDir[0] * pointR, localDir[1] * pointR, localDir[2] * pointR];

    // Match BuildGridOverlay's visible basis exactly: it builds the local
    // disk axes from the WORLD-space up vector and global [0,1,0] ref.
    // The earlier snap math used Earth-local [0,1,0], so after planet spin
    // the ghost could quantize to a different set of lines than the ones
    // the user was seeing under their feet.
    const upW = quatRotate(pose.spinQuat, centerN);
    const refW: Vec3 = Math.abs(upW[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
    let rx = refW[1] * upW[2] - refW[2] * upW[1];
    let ry = refW[2] * upW[0] - refW[0] * upW[2];
    let rz = refW[0] * upW[1] - refW[1] * upW[0];
    const rn = Math.hypot(rx, ry, rz) || 1;
    rx /= rn; ry /= rn; rz /= rn;
    const fx = upW[1] * rz - upW[2] * ry;
    const fy = upW[2] * rx - upW[0] * rz;
    const fz = upW[0] * ry - upW[1] * rx;

    const centerWD = quatRotate(pose.spinQuat, centerPos);
    const pointWD = quatRotate(pose.spinQuat, pointPos);
    const dx = pointWD[0] - centerWD[0];
    const dy = pointWD[1] - centerWD[1];
    const dz = pointWD[2] - centerWD[2];
    const x = dx * rx + dy * ry + dz * rz;
    const z = dx * fx + dy * fy + dz * fz;
    let offX = 0;
    let offZ = 0;
    try {
      const ref = getEarthLocalSiteFrame(WORLD_GRID_ORIGIN_ANCHOR);
      offX = centerPos[0] * ref.right[0] + centerPos[1] * ref.right[1] + centerPos[2] * ref.right[2];
      offZ = centerPos[0] * ref.forward[0] + centerPos[1] * ref.forward[1] + centerPos[2] * ref.forward[2];
    } catch { /* fall back to local centred grid */ }
    const qx = Math.round((x + offX) / CELL) * CELL - offX;
    const qz = Math.round((z + offZ) / CELL) * CELL - offZ;
    const targetWorld: Vec3 = [
      pose.center[0] + centerWD[0] + rx * qx + fx * qz,
      pose.center[1] + centerWD[1] + ry * qx + fy * qz,
      pose.center[2] + centerWD[2] + rz * qx + fz * qz,
    ];
    return worldHitToLocalDir(targetWorld);
  };

  // Seed the ghost when a new session arms. If a hitPoint was supplied
  // (e.g. wall edit/move starting from the existing wall position) we
  // still need to seed `localDirRef` so the ghost actually renders —
  // otherwise `useFrame` keeps it invisible and the user sees no ghost
  // and no in-world confirm button.
  useEffect(() => {
    if (!cast) return;
    if (cast.hitPoint) {
      localDirRef.current = worldHitToLocalDir(cast.hitPoint);
      return;
    }
    // Existing edits/moves seed from their current hitPoint above. Brand-new
    // placement must NOT auto-seed a ghost: that was why users saw an item
    // floating before they clicked and why Confirm appeared too early.
    // The invisible sphere remains armed; the first pointer-down writes the
    // actual grid/snapped hit and flips isPositioned=true.
    if (!cast.isPositioned) return;
    // Defensive fallback for any legacy cast that claims to be positioned
    // without a hitPoint: seed near the avatar rather than the horizon.
    const pose = getEarthPose();
    const center = new THREE.Vector3(pose.center[0], pose.center[1], pose.center[2]);
    let worldHit: Vec3 | null = null;
    const physics = getBrainPhysics();
    const body = selfId ? physics.getBody(selfId) : undefined;
    if (body) {
      // 1. Avatar's Earth-local unit normal.
      const disp: [number, number, number] = [
        body.pos[0] - pose.center[0],
        body.pos[1] - pose.center[1],
        body.pos[2] - pose.center[2],
      ];
      const local = worldDisplacementToEarthLocal(disp, pose);
      const rN = Math.hypot(local[0], local[1], local[2]) || 1;
      const n: Vec3 = [local[0] / rN, local[1] / rN, local[2] / rN];
      // 2. Camera-forward projected onto the avatar tangent plane.
      const camFwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
      // Express camFwd in Earth-local frame too so we can subtract the
      // surface-normal component.
      const camLocal = quatRotate(pose.invSpinQuat, [camFwd.x, camFwd.y, camFwd.z]);
      const dot = camLocal[0] * n[0] + camLocal[1] * n[1] + camLocal[2] * n[2];
      let tfx = camLocal[0] - n[0] * dot;
      let tfy = camLocal[1] - n[1] * dot;
      let tfz = camLocal[2] - n[2] * dot;
      const tfn = Math.hypot(tfx, tfy, tfz);
      if (tfn > 1e-4) {
        tfx /= tfn; tfy /= tfn; tfz /= tfn;
      } else {
        tfx = 1; tfy = 0; tfz = 0;
      }
      // 3. Walk SPAWN_FORWARD_M along the tangent and re-normalise.
      const baseRadius = surfaceRadiusFor(n);
      const ax = n[0] * baseRadius + tfx * SPAWN_FORWARD_M;
      const ay = n[1] * baseRadius + tfy * SPAWN_FORWARD_M;
      const az = n[2] * baseRadius + tfz * SPAWN_FORWARD_M;
      const ar = Math.hypot(ax, ay, az) || 1;
      const localDir: Vec3 = [ax / ar, ay / ar, az / ar];
      const snapped = snapLocalDirToGrid(localDir);
      localDirRef.current = snapped;
      worldHit = localDirToWorldHit(snapped);
    } else {
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
      const origin = new THREE.Vector3().copy(camera.position);
      let hit = intersectShell(origin, dir, center, RAYCAST_RADIUS);
      if (!hit) {
        const fromCenter = new THREE.Vector3().subVectors(origin, center).normalize();
        hit = new THREE.Vector3().copy(center).addScaledVector(fromCenter, RAYCAST_RADIUS);
      }
      const snapped = snapLocalDirToGrid(worldHitToLocalDir([hit.x, hit.y, hit.z]));
      localDirRef.current = snapped;
      worldHit = localDirToWorldHit(snapped);
    }
    setCastHitSilent(worldHit, !!cast.isPositioned);
    // Trigger one re-render so the ghost becomes visible.
    setCast((c) => (c ? { ...c, hitPoint: worldHit, isPositioned: !!c.isPositioned } : c));
  }, [cast, camera, selfId]);

  // Keep the raycast shell + ghost glued to the live Earth pose, and
  // orient the ghost tangent to the surface so it sits flat.
  useFrame(() => {
    const pose = getEarthPose();
    if (sphereRef.current) {
      sphereRef.current.position.set(pose.center[0], pose.center[1], pose.center[2]);
      sphereRef.current.visible = !!cast;
    }
    if (ghostRef.current) {
      const ld = localDirRef.current;
      ghostRef.current.visible = !!ld && !!cast;
      if (ld && cast) {
        // Re-apply current spin to keep ghost glued to the surface.
        const wd = quatRotate(pose.spinQuat, ld);
        const radius = surfaceRadiusFor(ld);
        const wx = pose.center[0] + wd[0] * radius;
        const wy = pose.center[1] + wd[1] * radius;
        const wz = pose.center[2] + wd[2] * radius;
        ghostRef.current.position.set(wx, wy, wz);
        // Keep the registry's hitPoint in sync so Confirm commits at the
        // visible location (silent — no React re-render storm).
        setCastHitSilent([wx, wy, wz], !!cast.isPositioned);
        const up = new THREE.Vector3(wd[0], wd[1], wd[2]).normalize();
        // Build a basis where +Y is the surface normal.
        const m = new THREE.Matrix4();
        const ref = Math.abs(up.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        const right = new THREE.Vector3().crossVectors(ref, up).normalize();
        const fwd = new THREE.Vector3().crossVectors(up, right).normalize();
        m.makeBasis(right, up, fwd);
        const base = new THREE.Quaternion().setFromRotationMatrix(m);
        const yawQ = new THREE.Quaternion().setFromAxisAngle(up, cast.yaw ?? 0);
        ghostRef.current.quaternion.copy(yawQ).multiply(base);
      }
    }
  });

  const ghostMesh = useMemo(() => {
    if (!cast) return null;
    if (cast.ghost.kind === 'box') {
      const { w, h, d, color } = cast.ghost;
      return (
        <mesh position={[0, h / 2, 0]} castShadow>
          <boxGeometry args={[w, h, d]} />
          <meshStandardMaterial
            color={color}
            transparent
            opacity={0.55}
            emissive={color}
            emissiveIntensity={0.35}
          />
        </mesh>
      );
    }
    // ring
    return (
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.4, 0.6, 32]} />
        <meshBasicMaterial
          color={cast.ghost.color}
          transparent
          opacity={0.65}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    );
  }, [cast]);

  if (!cast) return null;

  const writeHit = (e: ThreeEvent<PointerEvent>, isPositioned: boolean) => {
    const rawHit: Vec3 = [e.point.x, e.point.y, e.point.z];
    const snapped = snapLocalDirToGrid(worldHitToLocalDir(rawHit));
    const worldHit = localDirToWorldHit(snapped);
    localDirRef.current = snapped;
    updateCastHit(worldHit, isPositioned);
  };
  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    draggingRef.current = true;
    writeHit(e, true);
    try { (e.target as Element | null)?.setPointerCapture?.(e.pointerId); } catch { /* noop */ }
  };
  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    // Before the first drop, only pointer-down may create the ghost. After
    // that, mouse hover or touch drag may refine it along the grid.
    if (!cast.isPositioned && !draggingRef.current) return;
    if (e.pointerType !== 'mouse' && !draggingRef.current) return;
    e.stopPropagation();
    writeHit(e, draggingRef.current);
  };
  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    draggingRef.current = false;
    try { (e.target as Element | null)?.releasePointerCapture?.(e.pointerId); } catch { /* noop */ }
  };

  return (
    <>
      <mesh
        ref={sphereRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <sphereGeometry args={[RAYCAST_RADIUS, 48, 32]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <group ref={ghostRef} visible={!!cast.hitPoint}>
        {ghostMesh}
        {cast.isPositioned && <Html
          position={[0, cast.ghost.kind === 'box' ? cast.ghost.h + 0.6 : 1.2, 0]}
          center
          distanceFactor={8}
          zIndexRange={[100, 0]}
          style={{ pointerEvents: 'auto', userSelect: 'none' }}
        >
          <div
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              display: 'flex',
              gap: 6,
              padding: '8px 10px',
              borderRadius: 999,
              background: 'hsla(265,70%,8%,0.92)',
              border: '2px solid hsla(265,80%,65%,0.7)',
              boxShadow: '0 0 16px hsla(265,80%,65%,0.45)',
              fontFamily: 'system-ui, sans-serif',
              fontSize: 14,
              color: 'white',
              whiteSpace: 'nowrap',
            }}
          >
            <button type="button" onClick={() => rotateCast(-Math.PI / 12)} style={btnStyle}>⟲</button>
            <button type="button" onClick={() => rotateCast(Math.PI / 12)} style={btnStyle}>⟳</button>
            <button type="button" onClick={() => clearPendingCast()} style={{ ...btnStyle, color: '#fda4af' }}>✕</button>
            <button type="button" onClick={() => confirmCast()} style={{ ...btnStyle, background: 'hsl(265,80%,55%)', color: 'white' }}>✓</button>
          </div>
        </Html>}
      </group>
    </>
  );
}

const btnStyle: React.CSSProperties = {
  appearance: 'none',
  border: 'none',
  background: 'hsla(0,0%,100%,0.08)',
  color: 'white',
  borderRadius: 999,
  padding: '8px 12px',
  fontWeight: 700,
  cursor: 'pointer',
  minWidth: 40,
  minHeight: 40,
};