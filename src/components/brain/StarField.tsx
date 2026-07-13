import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getGalaxy } from '@/lib/brain/galaxy';

/**
 * Distant parallax starfield — purely visual, doesn't touch physics.
 * One draw call via THREE.Points + custom shader for per-star magnitude,
 * flicker, and HDR emissive so the composer's Bloom pass picks up only
 * the brightest stars (and gives them an anamorphic streak).
 */
export function StarField() {
  const galaxy = useMemo(() => getGalaxy(), []);
  const ref = useRef<THREE.Points>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);

  const { positions, sizes, magnitudes, phases } = useMemo(() => {
    const positions = new Float32Array(galaxy.bgStars.length * 3);
    const sizes = new Float32Array(galaxy.bgStars.length);
    const magnitudes = new Float32Array(galaxy.bgStars.length);
    const phases = new Float32Array(galaxy.bgStars.length);
    galaxy.bgStars.forEach((s, i) => {
      positions[i * 3] = s.pos[0];
      positions[i * 3 + 1] = s.pos[1];
      positions[i * 3 + 2] = s.pos[2];
      sizes[i] = s.size;
      magnitudes[i] = s.magnitude;
      // Phase = 0 means "steady" (no flicker); non-zero means twinkling.
      phases[i] = s.twinkle ? s.twinklePhase || 0.0001 : 0;
    });
    return { positions, sizes, magnitudes, phases };
  }, [galaxy]);

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uPixelRatio: { value: typeof window !== 'undefined' ? Math.min(window.devicePixelRatio, 2) : 1 },
    }),
    [],
  );

  useFrame(({ camera }) => {
    if (!ref.current) return;
    // Parallax centered on camera so the stars feel infinitely far.
    ref.current.position.set(camera.position.x, 0, camera.position.z);
    ref.current.rotation.y += 0.00005;
    if (matRef.current) {
      matRef.current.uniforms.uTime.value = performance.now() * 0.001;
    }
  });

  const vertexShader = /* glsl */ `
    attribute float size;
    attribute float magnitude;
    attribute float phase;
    uniform float uTime;
    uniform float uPixelRatio;
    varying float vMagnitude;
    varying float vFlicker;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float flicker = 1.0;
      if (phase > 0.0) {
        flicker = 0.55 + 0.45 * sin(uTime * 2.4 + phase * 7.13);
      }
      vFlicker = flicker;
      vMagnitude = magnitude;
      gl_PointSize = size * uPixelRatio * (0.6 + magnitude * 2.2) * (300.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
    }
  `;

  const fragmentShader = /* glsl */ `
    varying float vMagnitude;
    varying float vFlicker;
    void main() {
      vec2 uv = gl_PointCoord - 0.5;
      float d = length(uv);
      if (d > 0.5) discard;
      float disc = smoothstep(0.5, 0.05, d);
      float core = smoothstep(0.25, 0.0, d);
      // Cool blue-white for dim, warm-white for bright.
      vec3 cool = vec3(0.72, 0.82, 1.0);
      vec3 warm = vec3(1.0, 0.94, 0.82);
      vec3 col = mix(cool, warm, vMagnitude);
      // HDR boost on bright stars so Bloom (threshold ~0.85) selects them.
      float hdr = 1.0 + step(0.7, vMagnitude) * (vMagnitude - 0.7) * 8.0;
      float intensity = (disc * 0.6 + core * 1.4) * (0.25 + vMagnitude * 1.4) * vFlicker * hdr;
      gl_FragColor = vec4(col * intensity, disc);
    }
  `;

  return (
    <points ref={ref} renderOrder={-2}>
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
        <bufferAttribute
          attach="attributes-magnitude"
          args={[magnitudes, 1]}
          count={magnitudes.length}
          array={magnitudes}
          itemSize={1}
        />
        <bufferAttribute
          attach="attributes-phase"
          args={[phases, 1]}
          count={phases.length}
          array={phases}
          itemSize={1}
        />
      </bufferGeometry>
      <shaderMaterial
        ref={matRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}