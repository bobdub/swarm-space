import { useMemo } from 'react';
import * as THREE from 'three';
import { getAvatarById } from '@/lib/virtualHub/avatars';
import { getSurfaceFrame, getInteriorSurfaceFrame, getEarthPose } from '@/lib/brain/earth';

interface Props {
  position: [number, number, number];
  trust: number;
  label?: string;
  avatarId?: string;
  interior?: boolean;
}

/**
 * Renders a remote peer's chosen avatar (dragon/rabbit/etc.) standing
 * upright on Earth's curved surface. Orientation is derived from the live
 * Earth pose so the avatar's "up" matches the surface normal at its
 * position rather than the world Y axis.
 *
 * When `interior` is true the avatar is on Earth's INNER shell — its
 * "up" flips to the inward radial so feet stay on the cavity wall and
 * head points toward the hollow core.
 */
export function RemoteAvatarBody({ position, trust, label, avatarId, interior }: Props) {
  const def = useMemo(() => getAvatarById(avatarId), [avatarId]);
  const color = useMemo(() => `hsl(${Math.floor((trust * 200) % 360)}, 70%, 60%)`, [trust]);

  // Build a quaternion that maps world +Y onto the local surface up vector.
  const quaternion = useMemo(() => {
    const pose = getEarthPose();
    const { up } = interior
      ? getInteriorSurfaceFrame(position, pose)
      : getSurfaceFrame(position, pose);
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(up[0], up[1], up[2]),
    );
    return q;
  }, [position, interior]);

  return (
    <group position={position} quaternion={quaternion}>
      {def.render({ scale: 1, color })}
      {label && (
        <mesh position={[0, 2.0, 0]}>
          <planeGeometry args={[1.5, 0.3]} />
          <meshBasicMaterial color="hsl(245, 70%, 12%)" transparent opacity={0.7} />
        </mesh>
      )}
    </group>
  );
}