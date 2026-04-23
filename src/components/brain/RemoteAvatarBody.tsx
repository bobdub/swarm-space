import { useMemo } from 'react';
import * as THREE from 'three';
import { getAvatarById } from '@/lib/virtualHub/avatars';
import { getSurfaceFrame, getEarthPose, HUMAN_HEIGHT } from '@/lib/brain/earth';

interface Props {
  position: [number, number, number];
  trust: number;
  label?: string;
  avatarId?: string;
}

/**
 * Renders a remote peer's chosen avatar (dragon/rabbit/etc.) standing
 * upright on Earth's curved surface. Orientation is derived from the live
 * Earth pose so the avatar's "up" matches the surface normal at its
 * position rather than the world Y axis.
 */
export function RemoteAvatarBody({ position, trust, label, avatarId }: Props) {
  const def = useMemo(() => getAvatarById(avatarId), [avatarId]);
  const color = useMemo(() => `hsl(${Math.floor((trust * 200) % 360)}, 70%, 60%)`, [trust]);

  // Build a quaternion that maps world +Y onto the local surface up vector.
  const quaternion = useMemo(() => {
    const pose = getEarthPose();
    const { up } = getSurfaceFrame(position, pose);
    const q = new THREE.Quaternion();
    q.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(up[0], up[1], up[2]),
    );
    return q;
  }, [position]);

  // Spawn-coherence fix: physics anchors the body at its center of mass
  // (EARTH_RADIUS + HUMAN_HEIGHT/2 above the planet center). The avatar
  // meshes (rabbit/dragon/…) are authored with their *feet* at local
  // y = 0, so rendering them straight at the anchor leaves the mesh
  // floating ~HUMAN_HEIGHT/2 above the surface — which on a curved
  // planet reads as "the avatar lives inside Earth" once the camera
  // peeks past the horizon. Drop the mesh by HUMAN_HEIGHT/2 along the
  // local surface-up (post-rotation, that's local +Y) so feet land on
  // the dirt and the head sits ~1.7 m above it, like a person on land.
  const FEET_DROP = -HUMAN_HEIGHT / 2;

  return (
    <group position={position} quaternion={quaternion}>
      <group position={[0, FEET_DROP, 0]}>
        {def.render({ scale: 1, color })}
      </group>
      {label && (
        <mesh position={[0, FEET_DROP + 2.0, 0]}>
          <planeGeometry args={[1.5, 0.3]} />
          <meshBasicMaterial color="hsl(245, 70%, 12%)" transparent opacity={0.7} />
        </mesh>
      )}
    </group>
  );
}