/**
 * AssetCaster — shared in-Canvas raycast surface for "cast an asset to
 * the planet" interactions (portals, prefabs, future tools).
 *
 * When a cast is pending (see assetCaster registry), a faint cyan
 * highlight sphere co-locates with Earth and converts pointer events
 * into a world-space hit point that's forwarded to the cast's `onHit`
 * handler. A small ghost ring previews the impact location.
 *
 * Invariants:
 *  - Honors the scaffoldBus model via existing earth pose only.
 *  - No `<form>`, no global Math.random in placement (the cast payload
 *    decides what to do with the hit point).
 *  - Surface is invisible when no cast is pending so default planet
 *    interactions remain unaffected.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { EARTH_RADIUS, getEarthPose, type Vec3 } from '@/lib/brain/earth';
import {
  getPendingCast,
  subscribeCast,
  clearPendingCast,
  type PendingCast,
} from '@/lib/world/assetCaster';

export function AssetCaster() {
  const sphereRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const [cast, setCast] = useState<PendingCast | null>(() => getPendingCast());
  const [hover, setHover] = useState<Vec3 | null>(null);

  useEffect(() => subscribeCast(setCast), []);

  // Keep the raycast shell + ghost ring glued to the live Earth pose.
  useFrame(() => {
    const pose = getEarthPose();
    if (sphereRef.current) {
      sphereRef.current.position.set(pose.center[0], pose.center[1], pose.center[2]);
      sphereRef.current.visible = !!cast;
    }
    if (ringRef.current) {
      ringRef.current.visible = !!cast && hover !== null;
      if (hover) {
        ringRef.current.position.set(hover[0], hover[1], hover[2]);
        // Orient ring tangent to planet surface.
        const n = new THREE.Vector3(
          hover[0] - pose.center[0],
          hover[1] - pose.center[1],
          hover[2] - pose.center[2],
        ).normalize();
        ringRef.current.lookAt(
          hover[0] + n.x,
          hover[1] + n.y,
          hover[2] + n.z,
        );
      }
    }
  });

  const tint = useMemo(() => {
    switch (cast?.kind) {
      case 'portal': return '#a78bfa';
      case 'prefab': return '#7ad3ff';
      default: return '#ffffff';
    }
  }, [cast?.kind]);

  if (!cast) return null;

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHover([e.point.x, e.point.y, e.point.z]);
  };
  const handleOut = () => setHover(null);
  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const hit: Vec3 = [e.point.x, e.point.y, e.point.z];
    const consume = cast.onHit(hit, cast.payload);
    if (consume !== false) clearPendingCast();
  };

  return (
    <>
      <mesh
        ref={sphereRef}
        onPointerMove={handleMove}
        onPointerOut={handleOut}
        onClick={handleClick}
      >
        <sphereGeometry args={[EARTH_RADIUS + 0.05, 48, 32]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh ref={ringRef}>
        <ringGeometry args={[0.4, 0.6, 32]} />
        <meshBasicMaterial color={tint} transparent opacity={0.55} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </>
  );
}
