import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getAvatarById } from '@/lib/virtualHub/avatars';
import { getSurfaceFrame, getEarthPose, HUMAN_HEIGHT } from '@/lib/brain/earth';
import { STRUCTURE_SHELL_RADIUS } from '@/lib/brain/earth';
import { BRAIN_PHYSICS_VERSION } from '@/lib/brain/brainPersistence';
import { Text } from '@react-three/drei';

interface Props {
  position: [number, number, number];
  trust: number;
  label?: string;
  avatarId?: string;
  /** Brain physics version reported by the remote peer. Undefined = pre-versioning (v0). */
  peerPv?: number;
}

/**
 * Renders a remote peer's chosen avatar (dragon/rabbit/etc.) standing
 * upright on Earth's curved surface. Orientation is derived from the live
 * Earth pose so the avatar's "up" matches the surface normal at its
 * position rather than the world Y axis.
 */
export function RemoteAvatarBody({ position, trust, label, avatarId, peerPv }: Props) {
  const def = useMemo(() => getAvatarById(avatarId), [avatarId]);
  const color = useMemo(() => `hsl(${Math.floor((trust * 200) % 360)}, 70%, 60%)`, [trust]);
  // Version gate: a peer running an older physics protocol may report an
  // altitude our integrator no longer trusts (e.g. they fall through the
  // updated mantle clamp). Pin them to the structural shell so they
  // *visually* stand on the planet skin instead of beneath it.
  const isStale = typeof peerPv === 'number' ? peerPv < BRAIN_PHYSICS_VERSION : true;

  // Smoothed position + orientation. Presence updates land at ~1 Hz which
  // looks like teleport hops if applied directly; we lerp toward the latest
  // sample every frame so motion reads continuous.
  const groupRef = useRef<THREE.Group>(null);
  const targetPos = useRef(new THREE.Vector3(position[0], position[1], position[2]));
  const targetQuat = useRef(new THREE.Quaternion());
  const seeded = useRef(false);

  // Refresh target whenever the prop changes.
  useMemo(() => {
    const pose = getEarthPose();
    if (isStale) {
      // Reproject onto the structural shell (skin radius from Earth centre).
      const dx = position[0] - pose.center[0];
      const dy = position[1] - pose.center[1];
      const dz = position[2] - pose.center[2];
      const len = Math.hypot(dx, dy, dz) || 1;
      const k = STRUCTURE_SHELL_RADIUS / len;
      targetPos.current.set(
        pose.center[0] + dx * k,
        pose.center[1] + dy * k,
        pose.center[2] + dz * k,
      );
    } else {
      targetPos.current.set(position[0], position[1], position[2]);
    }
    const { up } = getSurfaceFrame(
      [targetPos.current.x, targetPos.current.y, targetPos.current.z],
      pose,
    );
    targetQuat.current.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(up[0], up[1], up[2]),
    );
  }, [position, isStale]);

  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    if (!seeded.current) {
      g.position.copy(targetPos.current);
      g.quaternion.copy(targetQuat.current);
      seeded.current = true;
      return;
    }
    g.position.lerp(targetPos.current, 0.18);
    g.quaternion.slerp(targetQuat.current, 0.18);
  });

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
    <group ref={groupRef}>
      <group position={[0, FEET_DROP, 0]}>
        {def.render({ scale: 1, color })}
      </group>
      {label && (
        <mesh position={[0, FEET_DROP + 2.0, 0]}>
          <planeGeometry args={[1.5, 0.3]} />
          <meshBasicMaterial color="hsl(245, 70%, 12%)" transparent opacity={0.7} />
        </mesh>
      )}
      {isStale && (
        <Text
          position={[0, FEET_DROP + 2.4, 0]}
          fontSize={0.18}
          color="hsl(38, 95%, 65%)"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.012}
          outlineColor="hsl(245, 70%, 8%)"
        >
          needs reload
        </Text>
      )}
    </group>
  );
}