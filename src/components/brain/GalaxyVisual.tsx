import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getGalaxy } from '@/lib/brain/galaxy';

/**
 * Renders the 120 named stars as a single instanced mesh + a glowing
 * galactic core. Slow rotation gives the spiral a sense of life; the
 * physics field is unaffected (stars are anchored as field pins).
 */
export function GalaxyVisual() {
  const galaxy = useMemo(() => getGalaxy(), []);
  const ref = useRef<THREE.InstancedMesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    if (!ref.current) return;
    galaxy.stars.forEach((star, i) => {
      dummy.position.set(star.pos[0], star.pos[1], star.pos[2]);
      const s = 0.2 + star.brightness * 0.35;
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      ref.current!.setMatrixAt(i, dummy.matrix);
      ref.current!.setColorAt(
        i,
        new THREE.Color().setHSL(
          0.55 + (star.arm / 8) * 0.15,
          0.7,
          0.55 + star.brightness * 0.25,
        ),
      );
    });
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [galaxy, dummy]);

  useFrame((_, dt) => {
    if (groupRef.current) groupRef.current.rotation.y += dt * 0.015;
  });

  return (
    <group ref={groupRef}>
      {/* Galactic core — soft glowing basin */}
      <mesh position={galaxy.core}>
        <sphereGeometry args={[1.2, 24, 24]} />
        <meshBasicMaterial
          color="hsl(48, 95%, 75%)"
          transparent
          opacity={0.55}
        />
      </mesh>
      <pointLight
        position={galaxy.core}
        color="hsl(40, 95%, 75%)"
        intensity={2.5}
        distance={30}
      />

      {/* 120 named stars */}
      <instancedMesh
        ref={ref}
        args={[undefined, undefined, galaxy.stars.length]}
        castShadow={false}
      >
        <sphereGeometry args={[1, 8, 8]} />
        <meshStandardMaterial
          emissive="hsl(50, 90%, 70%)"
          emissiveIntensity={1.4}
          color="hsl(50, 90%, 80%)"
        />
      </instancedMesh>
    </group>
  );
}