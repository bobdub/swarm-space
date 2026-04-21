import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getGalaxy } from '@/lib/brain/galaxy';

/**
 * Distant parallax starfield — purely visual, doesn't touch physics.
 * One draw call via THREE.Points + per-vertex sizes.
 */
export function StarField() {
  const galaxy = useMemo(() => getGalaxy(), []);
  const ref = useRef<THREE.Points>(null);

  const { positions, sizes } = useMemo(() => {
    const positions = new Float32Array(galaxy.bgStars.length * 3);
    const sizes = new Float32Array(galaxy.bgStars.length);
    galaxy.bgStars.forEach((s, i) => {
      positions[i * 3] = s.pos[0];
      positions[i * 3 + 1] = s.pos[1];
      positions[i * 3 + 2] = s.pos[2];
      sizes[i] = s.size;
    });
    return { positions, sizes };
  }, [galaxy]);

  useFrame(({ camera }) => {
    if (!ref.current) return;
    // Parallax centered on camera so the stars feel infinitely far.
    ref.current.position.set(camera.position.x, 0, camera.position.z);
    ref.current.rotation.y += 0.00005;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
          count={positions.length / 3}
          array={positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-size"
          args={[sizes, 1]}
          count={sizes.length}
          array={sizes}
          itemSize={1}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.18}
        color="hsl(220, 80%, 92%)"
        transparent
        opacity={0.85}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}