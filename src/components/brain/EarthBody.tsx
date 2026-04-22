import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Text } from '@react-three/drei';
import { EARTH_RADIUS, getEarthPose, SUN_POSITION } from '@/lib/brain/earth';

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
  uniform vec3 uSunPos;

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

    // Near-camera ground detail: a high-frequency noise octave that only
    // contributes when the viewer is close. From orbit you see continents;
    // standing on the surface you see grass/dirt variation under your feet.
    float dist = length(cameraPosition - vWorldPos);
    float nearMix = 1.0 - smoothstep(2.0, 20.0, dist);
    if (nearMix > 0.001) {
      float micro = noise(vWorldPos * 80.0);
      col *= mix(1.0, 0.75 + micro * 0.5, nearMix);
    }

    // Sun direction derived from the real scene Sun's world position —
    // no abstract sky box, no painted sun. The lit hemisphere of Earth
    // matches wherever the <pointLight> actually is.
    vec3 lightDir = normalize(uSunPos - vWorldPos);
    float diff = max(dot(n, lightDir), 0.0);
    float ambient = 0.25;
    col *= (ambient + diff * 1.1);

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
  const moonGroupRef = useRef<THREE.Group>(null);
  const moonMatRef = useRef<THREE.ShaderMaterial>(null);
  const matRef = useRef<THREE.ShaderMaterial>(null);
  // Spawn Coherence: capture the live pose ONCE at mount so the first
  // painted frame already places Earth at its live center / spin angle.
  // Without this, EarthBody renders at world origin until useFrame's
  // first tick — which is the "spawn in space" flash.
  const initialPose = useMemo(() => getEarthPose(), []);
  const MOON_RADIUS = EARTH_RADIUS * 0.27;
  const MOON_ORBIT_RADIUS = EARTH_RADIUS * 4.5;
  const MOON_ORBIT_PERIOD = 40; // seconds per revolution (sim time)
  const initialMoonPos = useMemo<[number, number, number]>(() => {
    // Mirror the moon orbit math used in useFrame so frame 0 matches.
    const t = 0; // mount-time t — pose clock starts at 0 too
    const theta = (t / MOON_ORBIT_PERIOD) * Math.PI * 2;
    const mx = Math.cos(theta) * MOON_ORBIT_RADIUS;
    const mz = Math.sin(theta) * MOON_ORBIT_RADIUS;
    const my = Math.sin(theta * 0.5) * MOON_ORBIT_RADIUS * 0.18;
    return [mx, my, mz];
  }, [MOON_ORBIT_RADIUS]);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      // Sourced from the shared SUN_POSITION so shader, scene light, and
      // daylight-biased spawn can never disagree.
      uSunPos: { value: new THREE.Vector3(...SUN_POSITION) },
    }),
    [],
  );
  // Moon shader: cratered grey lit by the same Sun. Direction recomputed
  // each frame against the moon's live world position.
  const moonUniforms = useMemo(
    () => ({
      uSunPos: { value: new THREE.Vector3(...SUN_POSITION) },
    }),
    [],
  );

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

    // Moon orbit — slight inclination so it doesn't always eclipse the Sun.
    if (moonGroupRef.current) {
      const t = (matRef.current?.uniforms.uTime.value as number) ?? 0;
      const theta = (t / MOON_ORBIT_PERIOD) * Math.PI * 2;
      const mx = Math.cos(theta) * MOON_ORBIT_RADIUS;
      const mz = Math.sin(theta) * MOON_ORBIT_RADIUS;
      const my = Math.sin(theta * 0.5) * MOON_ORBIT_RADIUS * 0.18;
      moonGroupRef.current.position.set(mx, my, mz);
    }
  });

  return (
    <group
      ref={groupRef}
      position={initialPose.center}
    >
      <mesh ref={ref} castShadow receiveShadow>
        {/* Initial spin angle so frame 0 matches the live pose */}
        <sphereGeometry args={[EARTH_RADIUS, 48, 32]} />
        <shaderMaterial
          ref={matRef}
          vertexShader={earthVertex}
          fragmentShader={earthFragment}
          uniforms={uniforms}
          side={THREE.DoubleSide}
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
      {/* Moon — orbits Earth, lit by the same Sun, gives the dark side
          of Earth a celestial reference + faint reflected fill light */}
      <group ref={moonGroupRef} position={initialMoonPos}>
        <mesh castShadow receiveShadow>
          <sphereGeometry args={[MOON_RADIUS, 32, 24]} />
          <shaderMaterial
            ref={moonMatRef}
            uniforms={moonUniforms}
            vertexShader={earthVertex}
            fragmentShader={/* glsl */ `
              varying vec3 vNormalLocal;
              varying vec3 vWorldPos;
              uniform vec3 uSunPos;
              float hash(vec3 p) {
                p = fract(p * vec3(443.8975, 397.2973, 491.1871));
                p += dot(p, p.yzx + 19.19);
                return fract((p.x + p.y) * p.z);
              }
              float noise(vec3 x) {
                vec3 i = floor(x); vec3 f = fract(x);
                vec3 u = f * f * (3.0 - 2.0 * f);
                return mix(
                  mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),u.x),
                      mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),u.x),u.y),
                  mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),u.x),
                      mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),u.x),u.y),u.z);
              }
              void main() {
                vec3 n = normalize(vNormalLocal);
                float craters = noise(n * 6.0) * 0.6 + noise(n * 18.0) * 0.3 + noise(n * 40.0) * 0.1;
                vec3 base = mix(vec3(0.55,0.55,0.58), vec3(0.85,0.83,0.78), craters);
                vec3 lightDir = normalize(uSunPos - vWorldPos);
                float diff = max(dot(n, lightDir), 0.0);
                vec3 col = base * (0.12 + diff * 1.0);
                gl_FragColor = vec4(col, 1.0);
              }
            `}
          />
        </mesh>
        {/* Faint reflected "moonlight" — a soft point light pointed back
            toward Earth, so the dark side picks up cool fill. */}
        <pointLight intensity={120} decay={2} color="hsl(220, 60%, 85%)" />
      </group>
    </group>
  );
}