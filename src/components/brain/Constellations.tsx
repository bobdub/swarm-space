import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getEarthPose, getEarthPoseTime, WORLD_SCALE } from '@/lib/brain/earth';
import { skyCadenceAt } from '@/lib/brain/skyCadence';
import { buildConstellationBuffers, twinkleTime } from '@/lib/brain/constellations';

/** Same shell as the background stars (galaxy.ts puts them at 70–90 units). */
const SKY_RADIUS = 75 * WORLD_SCALE;
/** Figure lines are guides, kept well below the stars' own brightness. */
const LINE_OPACITY = 0.32;

const starVertexShader = /* glsl */ `
  attribute float mag;
  attribute float phase;
  uniform float uTime;
  varying float vMag;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    // Shared-clock twinkle: uTime is the pose clock folded into one period,
    // so every peer's stars brighten and dim together.
    float twinkle = 0.85 + 0.15 * sin(uTime * 1.7 + phase) * sin(uTime * 0.6 + phase * 2.3);
    vMag = mag * twinkle;
    gl_PointSize = mix(4.0, 8.0, mag) * twinkle;
  }
`;

const starFragmentShader = /* glsl */ `
  uniform float uOpacity;
  uniform vec3 uTint;
  varying float vMag;
  void main() {
    float radius = length(gl_PointCoord - vec2(0.5));
    float core = (1.0 - smoothstep(0.0, 0.22, radius)) + 0.35 * (1.0 - smoothstep(0.22, 0.5, radius));
    float alpha = core * uOpacity * (0.55 + 0.45 * vMag);
    if (alpha <= 0.001) discard;
    gl_FragColor = vec4(uTint, alpha);
  }
`;

/**
 * The Cat, the Dragon, the Pirate Ship and the Flask.
 *
 * Two draw calls (one Points, one LineSegments) baked once at mount. Each
 * frame only follows the camera and writes two uniforms, exactly like
 * StarField: the figures keep fixed celestial directions and Earth turns
 * under them on the shared pose clock, so every peer sees the same sky.
 */
export function Constellations() {
  const groupRef = useRef<THREE.Group>(null);
  const buffers = useMemo(() => buildConstellationBuffers(SKY_RADIUS), []);
  const starUniforms = useMemo(() => ({
    uOpacity: { value: 0 },
    uTime: { value: 0 },
    uTint: { value: new THREE.Color('hsl(45, 90%, 92%)') },
  }), []);
  const lineMaterial = useMemo(() => new THREE.LineBasicMaterial({
    color: new THREE.Color('hsl(205, 70%, 78%)'),
    transparent: true,
    opacity: 0,
    depthWrite: false,
  }), []);

  useFrame(({ camera }) => {
    const group = groupRef.current;
    if (!group) return;
    group.position.copy(camera.position);
    const starOpacity = skyCadenceAt(
      [camera.position.x, camera.position.y, camera.position.z], getEarthPose(),
    ).starOpacity;
    group.visible = starOpacity > 0.002;
    if (!group.visible) return;
    starUniforms.uOpacity.value = Math.min(1, starOpacity * 1.15);
    starUniforms.uTime.value = twinkleTime(getEarthPoseTime());
    // Lines come out only once the sky is properly dark.
    lineMaterial.opacity = LINE_OPACITY * starOpacity * starOpacity;
  });

  return (
    <group ref={groupRef} visible={false}>
      <lineSegments renderOrder={-2} frustumCulled={false} material={lineMaterial}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[buffers.linePositions, 3]}
            count={buffers.linePositions.length / 3}
            array={buffers.linePositions}
            itemSize={3}
          />
        </bufferGeometry>
      </lineSegments>
      <points renderOrder={-2} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[buffers.starPositions, 3]}
            count={buffers.starPositions.length / 3}
            array={buffers.starPositions}
            itemSize={3}
          />
          <bufferAttribute
            attach="attributes-mag"
            args={[buffers.starMags, 1]}
            count={buffers.starMags.length}
            array={buffers.starMags}
            itemSize={1}
          />
          <bufferAttribute
            attach="attributes-phase"
            args={[buffers.starPhases, 1]}
            count={buffers.starPhases.length}
            array={buffers.starPhases}
            itemSize={1}
          />
        </bufferGeometry>
        <shaderMaterial
          vertexShader={starVertexShader}
          fragmentShader={starFragmentShader}
          uniforms={starUniforms}
          transparent
          depthWrite={false}
        />
      </points>
    </group>
  );
}
