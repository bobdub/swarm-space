import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getGalaxy } from '@/lib/brain/galaxy';
import { WORLD_SCALE } from '@/lib/brain/earth';
import { COSMO_COMPOUNDS, starTint } from '@/lib/brain/cosmoChemistry';

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
    // Per-star tint blends the Fe-line "dim" compound and the H/He
    // "main sequence" compound by brightness. Hot ⇒ whiter H/He;
    // dim ⇒ redder iron-line. Source of truth: cosmoChemistry.
    galaxy.stars.forEach((star, i) => {
      dummy.position.set(star.pos[0], star.pos[1], star.pos[2]);
      const s = (0.2 + star.brightness * 0.35) * WORLD_SCALE;
      // Stars are visually distant pinpricks. We scale by ~0.05 × WORLD_SCALE
      // (≈ 2–6 m radius) so they read as bright dots from kilometres away
      // without becoming house-sized boulders if the camera drifts close.
      const visS = s * 0.05;
      dummy.scale.set(visS, visS, visS);
      dummy.updateMatrix();
      ref.current!.setMatrixAt(i, dummy.matrix);
      const [r, g, b] = starTint(star.brightness);
      ref.current!.setColorAt(i, new THREE.Color(r, g, b));
    });
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
  }, [galaxy, dummy]);

  useFrame((_, dt) => {
    if (groupRef.current) groupRef.current.rotation.y += dt * 0.015;
  });

  // Galactic core colour: iron-peak compound. Slightly lifted toward
  // amber via the emissive material defaults so it still glows hot.
  const coreColor = COSMO_COMPOUNDS.galactic_core.color;
  const msColor = COSMO_COMPOUNDS.star_main_sequence.color;
  return (
    <group ref={groupRef}>
      {/* Galactic core — soft glowing basin (Fe-peak compound colour) */}
      <mesh position={galaxy.core}>
        <sphereGeometry args={[1.2 * WORLD_SCALE, 24, 24]} />
        <meshBasicMaterial color={coreColor} transparent opacity={0.55} />
      </mesh>
      <pointLight
        position={galaxy.core}
        color={coreColor}
        intensity={2.5}
        distance={30 * WORLD_SCALE}
      />

      {/* 120 named stars — instance colour overridden per-star above */}
      <instancedMesh
        ref={ref}
        args={[undefined, undefined, galaxy.stars.length]}
        castShadow={false}
      >
        <sphereGeometry args={[1, 8, 8]} />
        <meshStandardMaterial
          emissive={msColor}
          emissiveIntensity={1.4}
          color={msColor}
        />
      </instancedMesh>
    </group>
  );
}