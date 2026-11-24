import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getGalaxy } from '@/lib/brain/galaxy';
import { getEarthPose, WORLD_SCALE } from '@/lib/brain/earth';
import { skyCadenceAt } from '@/lib/brain/skyCadence';

const vertexShader = /* glsl */ `
  attribute float size;
  uniform float uSizeScale;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    // Stars are distant light sources, not metre-sized particles that vanish
    // under perspective. Keep a stable, softly rounded pixel footprint.
    gl_PointSize = clamp(size * uSizeScale, 1.0, 2.6);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uOpacity;
  uniform vec3 uTint;
  void main() {
    float radius = length(gl_PointCoord - vec2(0.5));
    // Dimmed so the constellation stars (Constellations.tsx) stand out.
    float alpha = (1.0 - smoothstep(0.15, 0.5, radius)) * uOpacity * 0.6;
    if (alpha <= 0.001) discard;
    gl_FragColor = vec4(uTint, alpha);
  }
`;

/**
 * Distant parallax starfield — purely visual, doesn't touch physics.
 * One draw call via THREE.Points + per-vertex sizes.
 */
export function StarField() {
  const galaxy = useMemo(() => getGalaxy(), []);
  const ref = useRef<THREE.Points>(null);
  const uniforms = useMemo(() => ({
    uOpacity: { value: 0 },
    uTint: { value: new THREE.Color('hsl(220, 80%, 92%)') },
    uSizeScale: { value: 30 / WORLD_SCALE },
  }), []);

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
    ref.current.position.copy(camera.position);
    // Fixed celestial directions: Earth turns beneath them on the pose clock.
    // No frame-count rotation, so different refresh rates see the same stars.
    uniforms.uOpacity.value = skyCadenceAt(
      [camera.position.x, camera.position.y, camera.position.z], getEarthPose(),
    ).starOpacity;
  });

  return (
    <points ref={ref} renderOrder={-2} frustumCulled={false}>
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
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
      />
    </points>
  );
}