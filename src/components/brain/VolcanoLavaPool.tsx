/**
 * VolcanoLavaPool — the molten floor inside the crater.
 *
 * A shader disc whose crust cracks brighten with live mantle pressure
 * (`getMantlePressure`). Rendered by `VolcanoOverlay` in the crater
 * frame, so it inherits the volcano's world pose.
 */
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getMantlePressure } from '@/lib/brain/lavaMantle';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uPressure;

  // Cheap value noise — no textures, no dependencies.
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  void main() {
    vec2 uv = (vUv - 0.5) * 2.0;
    float r = length(uv);
    if (r > 1.0) discard;

    // Slow convective flow of the crust.
    float flow = noise(uv * 3.2 + vec2(uTime * 0.05, -uTime * 0.04));
    flow += 0.5 * noise(uv * 7.0 - vec2(uTime * 0.09, uTime * 0.06));

    // Crust plates (dark) separated by glowing cracks.
    float crack = smoothstep(0.52, 0.46, abs(flow - 0.62));
    float heat = clamp(crack + uPressure * 0.35, 0.0, 1.0);

    vec3 crust = vec3(0.10, 0.05, 0.05);
    vec3 molten = mix(vec3(0.95, 0.28, 0.05), vec3(1.0, 0.85, 0.35), heat * 0.6);
    vec3 color = mix(crust, molten, heat);

    // Hotter toward the vent centre, cooler at the rim.
    color += molten * (1.0 - smoothstep(0.0, 0.9, r)) * 0.35;
    float alpha = 1.0 - smoothstep(0.94, 1.0, r);
    gl_FragColor = vec4(color, alpha);
  }
`;

export function VolcanoLavaPool({ radius }: { radius: number }) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const uniforms = useMemo(
    () => ({ uTime: { value: 0 }, uPressure: { value: 0 } }),
    [],
  );

  useFrame(({ clock }) => {
    if (matRef.current) {
      matRef.current.uniforms.uTime.value = clock.elapsedTime;
      const pressure = Math.max(0, Math.min(1, getMantlePressure()));
      matRef.current.uniforms.uPressure.value = pressure;
      if (lightRef.current) {
        lightRef.current.intensity = 6 + pressure * 14 + Math.sin(clock.elapsedTime * 1.7) * 1.2;
      }
    }
  });

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.6, 0]}>
        <circleGeometry args={[radius, 48]} />
        <shaderMaterial
          ref={matRef}
          uniforms={uniforms}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          transparent
          side={THREE.DoubleSide}
        />
      </mesh>
      <pointLight
        ref={lightRef}
        position={[0, 1.4, 0]}
        color="hsl(20, 100%, 58%)"
        intensity={8}
        distance={radius * 12}
        decay={2}
      />
    </group>
  );
}

export default VolcanoLavaPool;
