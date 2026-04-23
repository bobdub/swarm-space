import { useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import { STRUCTURE_SHELL_RADIUS, getEarthPose, anchorOnEarth } from '@/lib/brain/earth';

/**
 * Scatters tall landmark pillars on the planet surface near the local
 * player's spawn so walking has unmistakable visual references. Pure
 * presentation: no physics, no field interaction.
 */
export function SurfaceLandmarks({ anchorPeerId }: { anchorPeerId: string }) {
  const groupRef = useRef<THREE.Group>(null);
  const itemRefs = useRef<(THREE.Mesh | null)[]>([]);

  // Stable per-pillar metadata (tangent offsets, height, hue) — Earth-local.
  const slots = useMemo(() => {
    const items: { tx: number; tz: number; height: number; hue: number }[] = [];
    const placeRing = (count: number, radius: number, heightBase: number) => {
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + (radius * 0.13);
        items.push({
          tx: Math.cos(angle) * radius,
          tz: Math.sin(angle) * radius,
          height: heightBase + ((items.length * 37) % 7) * 0.8,
          hue: (items.length * 47) % 360,
        });
      }
    };
    placeRing(8, 6, 3);
    placeRing(12, 18, 6);
    placeRing(16, 40, 9);
    return items;
  }, []);

  // Initial world transforms for first paint (overwritten by useFrame).
  const initial = useMemo(() => {
    return slots.map((s) => {
      const { worldPos, up } = anchorOnEarth(
        anchorPeerId,
        s.tx,
        s.tz,
        STRUCTURE_SHELL_RADIUS,
      );
      return { worldPos, up };
    });
  }, [anchorPeerId, slots]);

  useFrame(() => {
    if (!groupRef.current) return;
    const pose = getEarthPose();
    slots.forEach((s, i) => {
      const mesh = itemRefs.current[i];
      if (!mesh) return;
      const { worldPos, up } = anchorOnEarth(
        anchorPeerId,
        s.tx,
        s.tz,
        STRUCTURE_SHELL_RADIUS,
        pose,
      );
      const upVec = new THREE.Vector3(up[0], up[1], up[2]);
      const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), upVec);
      mesh.position.set(
        worldPos[0] + up[0] * (s.height / 2),
        worldPos[1] + up[1] * (s.height / 2),
        worldPos[2] + up[2] * (s.height / 2),
      );
      mesh.quaternion.copy(quat);
    });
  });

  return (
    <group ref={groupRef}>
      {slots.map((s, i) => {
        const init = initial[i];
        const upVec = new THREE.Vector3(init.up[0], init.up[1], init.up[2]);
        const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), upVec);
        const euler = new THREE.Euler().setFromQuaternion(quat);
        const basePos: [number, number, number] = [
          init.worldPos[0] + init.up[0] * (s.height / 2),
          init.worldPos[1] + init.up[1] * (s.height / 2),
          init.worldPos[2] + init.up[2] * (s.height / 2),
        ];
        return (
          <mesh
            key={i}
            ref={(node) => {
              itemRefs.current[i] = node;
            }}
            position={basePos}
            rotation={[euler.x, euler.y, euler.z]}
            castShadow
          >
            <cylinderGeometry args={[0.4, 0.6, s.height, 8]} />
            <meshStandardMaterial
              color={`hsl(${s.hue}, 60%, 55%)`}
              emissive={`hsl(${s.hue}, 80%, 35%)`}
              emissiveIntensity={0.4}
              roughness={0.7}
            />
          </mesh>
        );
      })}
    </group>
  );
}