/**
 * AssetCaster — unified in-Canvas placement surface.
 *
 * When a placement session is armed (see `assetCaster` registry), this
 * surface:
 *   1. Seeds the ghost at the camera-forward intersection with the Earth
 *      shell ("spawns in front of you").
 *   2. Lets the user drag the ghost across the planet to reposition it.
 *   3. Waits for an explicit Confirm/Cancel from the HUD — no tap-commit.
 *
 * Ghost shape comes from the session payload (box for prefabs, ring for
 * portals). Surface is invisible when no session is pending so default
 * planet interactions remain unaffected.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { EARTH_RADIUS, getEarthPose, type Vec3 } from '@/lib/brain/earth';
import {
  getPendingCast,
  subscribeCast,
  updateCastHit,
  type PendingCast,
} from '@/lib/world/assetCaster';

const SHELL_RADIUS = EARTH_RADIUS + 0.05;

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

export function AssetCaster() {
  const { camera } = useThree();
  const sphereRef = useRef<THREE.Mesh>(null);
  const ghostRef = useRef<THREE.Group>(null);
  const draggingRef = useRef(false);
  const [cast, setCast] = useState<PendingCast | null>(() => getPendingCast());

  useEffect(() => subscribeCast(setCast), []);

  // Seed the ghost in front of the camera when a new session arms.
  useEffect(() => {
    if (!cast || cast.hitPoint) return;
    const pose = getEarthPose();
    const center = new THREE.Vector3(pose.center[0], pose.center[1], pose.center[2]);
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
    const origin = new THREE.Vector3().copy(camera.position);
    let hit = intersectShell(origin, dir, center, SHELL_RADIUS);
    if (!hit) {
      // Fallback: project camera onto the shell.
      const fromCenter = new THREE.Vector3().subVectors(origin, center).normalize();
      hit = new THREE.Vector3().copy(center).addScaledVector(fromCenter, SHELL_RADIUS);
    }
    updateCastHit([hit.x, hit.y, hit.z]);
  }, [cast, camera]);

  // Keep the raycast shell + ghost glued to the live Earth pose, and
  // orient the ghost tangent to the surface so it sits flat.
  useFrame(() => {
    const pose = getEarthPose();
    if (sphereRef.current) {
      sphereRef.current.position.set(pose.center[0], pose.center[1], pose.center[2]);
      sphereRef.current.visible = !!cast;
    }
    if (ghostRef.current) {
      const hp = cast?.hitPoint;
      ghostRef.current.visible = !!hp;
      if (hp) {
        ghostRef.current.position.set(hp[0], hp[1], hp[2]);
        const up = new THREE.Vector3(
          hp[0] - pose.center[0],
          hp[1] - pose.center[1],
          hp[2] - pose.center[2],
        ).normalize();
        // Build a basis where +Y is the surface normal.
        const m = new THREE.Matrix4();
        const ref = Math.abs(up.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
        const right = new THREE.Vector3().crossVectors(ref, up).normalize();
        const fwd = new THREE.Vector3().crossVectors(up, right).normalize();
        m.makeBasis(right, up, fwd);
        ghostRef.current.quaternion.setFromRotationMatrix(m);
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

  const writeHit = (e: ThreeEvent<PointerEvent>) => {
    updateCastHit([e.point.x, e.point.y, e.point.z]);
  };
  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    draggingRef.current = true;
    writeHit(e);
    try { (e.target as Element | null)?.setPointerCapture?.(e.pointerId); } catch { /* noop */ }
  };
  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    // Mouse: hover updates. Touch: only while finger is down.
    if (e.pointerType !== 'mouse' && !draggingRef.current) return;
    e.stopPropagation();
    writeHit(e);
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
        <sphereGeometry args={[SHELL_RADIUS, 48, 32]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <group ref={ghostRef}>{ghostMesh}</group>
    </>
  );
}