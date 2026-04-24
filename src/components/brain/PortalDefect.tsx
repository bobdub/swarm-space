import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Text } from '@react-three/drei';
import { getEarthPose, quatRotate, EARTH_RADIUS } from '@/lib/brain/earth';

interface Props {
  /** Earth-local (co-rotating) position. The portal travels with the spinning planet. */
  localPos?: [number, number, number];
  /** World-space fallback for legacy portals stored before localPos existed. */
  worldPos?: [number, number, number];
  label: string;
}

/**
 * Upright doorway portal. Stands tangent to the Earth surface so the player
 * sees a vertical ring at eye level instead of a horizontal disc on the floor.
 * Re-orients every frame against the live Earth pose so the portal travels
 * with the rotating planet (the player rides the same co-rotating frame).
 */
export function PortalDefect({ localPos, worldPos, label }: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const tmpPos = useRef(new THREE.Vector3());
  const tmpQuat = useRef(new THREE.Quaternion());
  const tmpUp = useRef(new THREE.Vector3());
  useFrame(({ clock }) => {
    if (ringRef.current) ringRef.current.rotation.y = clock.elapsedTime * 0.6;
    const g = groupRef.current;
    if (!g) return;
    const pose = getEarthPose();
    // Resolve world position: prefer live local→world transform, else fallback.
    if (localPos) {
      const w = quatRotate(pose.spinQuat, localPos);
      tmpPos.current.set(
        pose.center[0] + w[0],
        pose.center[1] + w[1],
        pose.center[2] + w[2],
      );
    } else if (worldPos) {
      tmpPos.current.set(worldPos[0], worldPos[1], worldPos[2]);
    } else {
      return;
    }
    g.position.copy(tmpPos.current);
    // Orient: doorway's local +Y aligned with the surface normal at this point.
    tmpUp.current.set(
      tmpPos.current.x - pose.center[0],
      tmpPos.current.y - pose.center[1],
      tmpPos.current.z - pose.center[2],
    ).normalize();
    tmpQuat.current.setFromUnitVectors(new THREE.Vector3(0, 1, 0), tmpUp.current);
    g.quaternion.copy(tmpQuat.current);
  });

  // Geometry: vertical doorway 2 m tall, 1.4 m wide. Local +Y == surface normal,
  // so we lift the door so its base sits on the surface (group origin = base).
  return (
    <group ref={groupRef}>
      {/* Ring frame, vertical: rotated so the torus stands like a doorway */}
      <mesh ref={ringRef} position={[0, 1.0, 0]}>
        <torusGeometry args={[0.95, 0.08, 12, 48]} />
        <meshStandardMaterial
          color="hsl(180, 90%, 60%)"
          emissive="hsl(180, 90%, 60%)"
          emissiveIntensity={1.8}
        />
      </mesh>
      {/* Membrane — vertical disc inside the ring */}
      <mesh position={[0, 1.0, 0]}>
        <circleGeometry args={[0.9, 48]} />
        <meshBasicMaterial
          color="hsl(265, 90%, 45%)"
          transparent
          opacity={0.55}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Glow so it reads from a distance even on a 360px viewport */}
      <pointLight color="hsl(180, 100%, 60%)" intensity={3} distance={12} position={[0, 1.0, 0]} />
      <Text
        position={[0, 2.3, 0]}
        fontSize={0.32}
        color="hsl(180, 90%, 85%)"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.02}
        outlineColor="hsl(220, 50%, 10%)"
      >
        {label}
      </Text>
    </group>
  );
}

// Silence unused-import warning if EARTH_RADIUS isn't referenced (kept for clarity).
void EARTH_RADIUS;