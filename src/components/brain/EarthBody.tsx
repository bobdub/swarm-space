import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Text } from '@react-three/drei';
import { EARTH_RADIUS, getEarthPose } from '@/lib/brain/earth';

/**
 * Procedural blue-green Earth — no textures, no day/night cycle. The
 * shader colours land/ocean from a low-frequency noise of the sphere's
 * unit-vector position so it looks alive without external assets.
 */
const earthVertex = /* glsl */ `
  varying vec3 vNormalLocal;
  varying vec3 vWorldPos;
  void main() {
    vNormalLocal = normalize(position);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const earthFragment = /* glsl */ `
  varying vec3 vNormalLocal;
  varying vec3 vWorldPos;
  uniform float uTime;

  // Cheap value noise — enough for a believable continents pattern.
  float hash(vec3 p) {
    p = fract(p * vec3(443.8975, 397.2973, 491.1871));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }
  float noise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), u.x),
          mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), u.x), u.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), u.x),
          mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), u.x), u.y),
      u.z);
  }

  void main() {
    vec3 n = normalize(vNormalLocal);
    float continents = noise(n * 3.5) * 0.6 + noise(n * 8.0) * 0.3 + noise(n * 16.0) * 0.1;
    vec3 ocean = vec3(0.05, 0.35, 0.55);
    vec3 land  = vec3(0.18, 0.55, 0.32);
    vec3 ice   = vec3(0.85, 0.95, 0.98);
    float landMask = smoothstep(0.48, 0.55, continents);
    vec3 col = mix(ocean, land, landMask);
    float polar = smoothstep(0.78, 0.92, abs(n.y));
    col = mix(col, ice, polar);

    // Soft directional light ("sun" toward galactic core)
    vec3 lightDir = normalize(vec3(-1.0, 0.4, -0.3));
    float diff = max(dot(n, lightDir), 0.0);
    float ambient = 0.35;
    col *= (ambient + diff * 0.85);

    // Atmosphere rim
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 2.5);
    col += vec3(0.3, 0.55, 0.95) * rim * 0.6;

    gl_FragColor = vec4(col, 1.0);
  }
`;

export function EarthBody() {
  const ref = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);

  useFrame((_, dt) => {
    if (matRef.current) {
      (matRef.current.uniforms.uTime.value as number) += dt;
    }
    // Follow the live Earth pose so the visible planet tracks the field
    // basin written by updateEarthPin(). Spin angle is sourced from the
    // pose so render and physics never disagree.
    const pose = getEarthPose();
    if (groupRef.current) {
      groupRef.current.position.set(pose.center[0], pose.center[1], pose.center[2]);
    }
    if (ref.current) ref.current.rotation.y = pose.spinAngle;
  });

  return (
    <group ref={groupRef}>
      <mesh ref={ref} castShadow receiveShadow>
        <sphereGeometry args={[EARTH_RADIUS, 48, 32]} />
        <shaderMaterial
          ref={matRef}
          vertexShader={earthVertex}
          fragmentShader={earthFragment}
          uniforms={uniforms}
        />
      </mesh>
      {/* Soft glow halo */}
      <mesh>
        <sphereGeometry args={[EARTH_RADIUS * 1.08, 32, 24]} />
        <meshBasicMaterial
          color="hsl(200, 90%, 70%)"
          transparent
          opacity={0.08}
          side={THREE.BackSide}
          depthWrite={false}
        />
      </mesh>
      <Text
        position={[0, EARTH_RADIUS + 0.6, 0]}
        fontSize={0.35}
        color="hsl(200, 90%, 90%)"
        anchorX="center"
        anchorY="middle"
      >
        Earth
      </Text>
    </group>
  );
}