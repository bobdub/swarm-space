import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getEarthPose, quatRotate } from '@/lib/brain/earth';
import {
  getStreet,
  STREET_LENGTH,
  STREET_WIDTH,
  LAND_RADIUS,
} from '@/lib/brain/street';

/**
 * Renders the street + land patch on Earth's INNER shell. Geometry lives
 * in Earth-LOCAL coords and is repositioned each frame using the live
 * Earth pose, so the patch tracks the planet's spin and orbit exactly
 * like the body integrator does for interior avatars.
 */
export function StreetMesh() {
  const groupRef = useRef<THREE.Group>(null);
  const street = useMemo(() => getStreet(), []);

  // Build the orientation quaternion: map world (+Y up, +X forward) onto
  // the street's local frame (normal = up, tangent = forward).
  const localQuat = useMemo(() => {
    const m = new THREE.Matrix4();
    const tangent = new THREE.Vector3(...street.tangentLocal);
    const normal = new THREE.Vector3(...street.normalLocal);
    const bitangent = new THREE.Vector3(...street.bitangentLocal);
    // Columns: X = tangent (length), Y = normal (up), Z = bitangent (width)
    m.makeBasis(tangent, normal, bitangent);
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }, [street]);

  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    const pose = getEarthPose();
    // World position of the street center.
    const w = quatRotate(pose.spinQuat, street.centerLocal);
    g.position.set(
      pose.center[0] + w[0],
      pose.center[1] + w[1],
      pose.center[2] + w[2],
    );
    // Compose pose spin with the local frame quaternion.
    const spin = new THREE.Quaternion(
      pose.spinQuat[0], pose.spinQuat[1], pose.spinQuat[2], pose.spinQuat[3],
    );
    g.quaternion.copy(spin).multiply(localQuat);
  });

  return (
    <group ref={groupRef}>
      {/* Land disc — soft green, slightly recessed below the road. */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <circleGeometry args={[LAND_RADIUS, 48]} />
        <meshStandardMaterial
          color="hsl(120, 35%, 35%)"
          side={THREE.DoubleSide}
          roughness={0.9}
        />
      </mesh>
      {/* Street strip — flat grey rectangle along the tangent axis. */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[STREET_LENGTH, STREET_WIDTH]} />
        <meshStandardMaterial
          color="hsl(0, 0%, 28%)"
          side={THREE.DoubleSide}
          roughness={0.7}
        />
      </mesh>
      {/* Centre lane markings — thin yellow dashes. */}
      {Array.from({ length: 5 }).map((_, i) => {
        const x = -STREET_LENGTH / 2 + (i + 0.5) * (STREET_LENGTH / 5);
        return (
          <mesh key={i} rotation={[Math.PI / 2, 0, 0]} position={[x, 0.01, 0]}>
            <planeGeometry args={[STREET_LENGTH / 12, 0.18]} />
            <meshBasicMaterial color="hsl(48, 90%, 55%)" side={THREE.DoubleSide} />
          </mesh>
        );
      })}
    </group>
  );
}
