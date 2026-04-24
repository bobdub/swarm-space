import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Text } from '@react-three/drei';
import {
  EARTH_RADIUS,
  EARTH_SPHERE_SEGMENTS,
  EARTH_SPHERE_RINGS,
  getEarthPose,
  SUN_POSITION,
  WORLD_SCALE,
} from '@/lib/brain/earth';
import { getVolcanoOrgan, SHARED_VOLCANO_ANCHOR_ID } from '@/lib/brain/volcanoOrgan';
import { LAND_LIFT } from '@/lib/brain/surfaceProfile';

/**
 * Procedural blue-green Earth — no textures, no day/night cycle. The
 * shader colours land/ocean from a low-frequency noise of the sphere's
 * unit-vector position so it looks alive without external assets.
 */
const earthVertex = /* glsl */ `
  varying vec3 vNormalLocal;
  varying vec3 vWorldPos;
  varying vec3 vLocalPos;
  // Volcano organ uniforms — single descriptor shared with collision
  // and mantle vent. Vertex displacement turns the cone INTO Earth
  // geometry (no separate prop intersecting the sphere).
  uniform vec3 uVolcCenter;     // Earth-local unit normal at volcano centre
  uniform float uVolcBaseR;     // base radius (m, arc length)
  uniform float uVolcHeight;    // peak height (m)
  uniform float uVolcCraterR;   // crater radius (m)
  uniform float uVolcCraterD;   // crater depth (m)
  uniform float uEarthR;        // EARTH_RADIUS, world units
  uniform float uLandLift;      // metres land sits above ocean baseline

  // Cheap value noise mirroring src/lib/brain/surfaceProfile.ts so the
  // shoreline pixels and the JS-sampled land mask agree exactly.
  float vHash(vec3 p) {
    p = fract(p * vec3(443.8975, 397.2973, 491.1871));
    p += dot(p, p.yzx + 19.19);
    return fract((p.x + p.y) * p.z);
  }
  float vNoise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(vHash(i+vec3(0,0,0)), vHash(i+vec3(1,0,0)), u.x),
          mix(vHash(i+vec3(0,1,0)), vHash(i+vec3(1,1,0)), u.x), u.y),
      mix(mix(vHash(i+vec3(0,0,1)), vHash(i+vec3(1,0,1)), u.x),
          mix(vHash(i+vec3(0,1,1)), vHash(i+vec3(1,1,1)), u.x), u.y),
      u.z);
  }
  float vLandMask(vec3 nrm) {
    float continents =
      vNoise(nrm * 3.5) * 0.6 +
      vNoise(nrm * 8.0) * 0.3 +
      vNoise(nrm * 16.0) * 0.1;
    return smoothstep(0.48, 0.55, continents);
  }

  float volcElevation(vec3 nrm) {
    float d = clamp(dot(uVolcCenter, nrm), -1.0, 1.0);
    float arc = acos(d) * uEarthR;
    if (arc >= uVolcBaseR) return 0.0;
    float u = arc / max(1e-6, uVolcBaseR);
    float t = 1.0 - u;
    float cone = t * t * (3.0 - 2.0 * t);
    float h = uVolcHeight * cone;
    if (arc < uVolcCraterR) {
      float cu = arc / max(1e-6, uVolcCraterR);
      float ct = 1.0 - cu;
      float bowl = ct * ct * (3.0 - 2.0 * ct);
      h -= uVolcCraterD * bowl;
    }
    return max(0.0, h);
  }

  void main() {
    vec3 nrm = normalize(position);
    vNormalLocal = nrm;
    // Land sits LAND_LIFT m above the ocean baseline so coastlines are
    // visible geometry, not just a colour boundary. Volcano lift adds on
    // top of that.
    float lift = volcElevation(nrm) + vLandMask(nrm) * uLandLift;
    vec3 displaced = position + nrm * lift;
    vLocalPos = displaced;
    vec4 wp = modelMatrix * vec4(displaced, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const earthFragment = /* glsl */ `
  varying vec3 vNormalLocal;
  varying vec3 vWorldPos;
  varying vec3 vLocalPos;
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
    float nearMix = 1.0 - smoothstep(5.0, 400.0, dist);
    if (nearMix > 0.001) {
      // Multi-octave ground detail across grass-blade → boulder scales.
      // Sample in Earth-LOCAL space so the painted dirt rotates *with*
      // the planet's spin. Sampling in world space made the grass slide
      // under the player's feet every frame — read as "sinking through
      // the floor" even though physics had them pinned to the shell.
      float micro1 = noise(vLocalPos * 0.8);
      float micro2 = noise(vLocalPos * 4.0);
      float micro3 = noise(vLocalPos * 18.0);
      float micro = micro1 * 0.5 + micro2 * 0.3 + micro3 * 0.2;
      // Stripe-like "grass row" pattern catches walking motion visually.
      float stripes = sin(vLocalPos.x * 1.4) * sin(vLocalPos.z * 1.4) * 0.5 + 0.5;
      vec3 grassDark = vec3(0.08, 0.32, 0.14);
      vec3 grassLight = vec3(0.32, 0.62, 0.28);
      vec3 dirt = vec3(0.42, 0.32, 0.18);
      vec3 groundCol = mix(grassDark, grassLight, micro);
      groundCol = mix(groundCol, dirt, smoothstep(0.65, 0.85, micro2));
      groundCol *= 0.85 + stripes * 0.3;
      // Where the planet shader said "land", paint ground; over ocean, ripple.
      vec3 oceanRipple = ocean * (0.85 + sin(vLocalPos.x * 2.0 + vLocalPos.z * 2.0) * 0.15);
      vec3 surfaceCol = mix(oceanRipple, groundCol, landMask);
      col = mix(col, surfaceCol, nearMix);
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
    () => {
      const organ = getVolcanoOrgan(SHARED_VOLCANO_ANCHOR_ID);
      return {
        uTime: { value: 0 },
        // Sourced from the shared SUN_POSITION so shader, scene light, and
        // daylight-biased spawn can never disagree.
        uSunPos: { value: new THREE.Vector3(...SUN_POSITION) },
        // Volcano organ — same descriptor as collision + mantle vent.
        uVolcCenter: {
          value: new THREE.Vector3(
            organ.centerNormal[0],
            organ.centerNormal[1],
            organ.centerNormal[2],
          ),
        },
        uVolcBaseR: { value: organ.baseRadius },
        uVolcHeight: { value: organ.height },
        uVolcCraterR: { value: organ.craterRadius },
        uVolcCraterD: { value: organ.craterDepth },
        uEarthR: { value: EARTH_RADIUS },
        uLandLift: { value: LAND_LIFT },
      };
    },
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
      <mesh ref={ref} castShadow receiveShadow rotation-y={initialPose.spinAngle}>
        {/* High-tessellation sphere so the volcano vertex displacement
            actually resolves a cone instead of falling between vertices.
            Segment counts come from earth.ts so SURFACE_TESS_CLEARANCE
            (which feeds BODY_SHELL_RADIUS) always matches the rendered
            chord deflection — no more "analytic ground sits 11 m below
            the visible ground" phasing. */}
        <sphereGeometry args={[EARTH_RADIUS, EARTH_SPHERE_SEGMENTS, EARTH_SPHERE_RINGS]} />
        <shaderMaterial
          ref={matRef}
          vertexShader={earthVertex}
          fragmentShader={earthFragment}
          uniforms={uniforms}
          side={THREE.FrontSide}
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
        position={[0, EARTH_RADIUS + 0.6 * WORLD_SCALE, 0]}
        fontSize={0.35 * WORLD_SCALE}
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
            vertexShader={/* glsl */ `
              varying vec3 vNormalLocal;
              varying vec3 vWorldPos;
              void main() {
                vNormalLocal = normalize(position);
                vec4 wp = modelMatrix * vec4(position, 1.0);
                vWorldPos = wp.xyz;
                gl_Position = projectionMatrix * viewMatrix * wp;
              }
            `}
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