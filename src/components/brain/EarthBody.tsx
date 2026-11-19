import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Text } from '@react-three/drei';
import {
  EARTH_RADIUS,
  EARTH_SPHERE_RINGS,
  EARTH_SPHERE_SEGMENTS,
  getEarthPose,
  MOON_RADIUS,
  WORLD_SCALE,
} from '@/lib/brain/earth';
import { getVolcanoOrgan, SHARED_VOLCANO_ANCHOR_ID } from '@/lib/brain/volcanoOrgan';
import { buildTerrainGeometry } from '@/lib/brain/terrainGeometry';
import { OBSERVATION_PALETTES, detectDefaultChannel } from '@/lib/brain/observationBias';
import { COSMO_COMPOUNDS, hexToRgb01 } from '@/lib/brain/cosmoChemistry';

/**
 * Procedural blue-green Earth — no textures, no day/night cycle. The
 * shader colours land/ocean from a low-frequency noise of the sphere's
 * unit-vector position so it looks alive without external assets.
 */
const earthVertex = /* glsl */ `
  varying vec3 vNormalLocal;
  varying vec3 vWorldPos;
  varying vec3 vLocalPos;
  varying float vContinents;
  varying float vVolcano;
  // Terrain is baked per vertex in JS (src/lib/brain/terrainMesh.ts): the
  // position attribute is ALREADY displaced by land lift + volcano cone,
  // and physics intersects these very triangles. The GPU no longer
  // re-derives the noise in float32 — that second terrain disagreed with
  // the physics floor around coastlines (you stood inside drawn hills).
  attribute float aContinents;
  attribute float aVolcano;

  void main() {
    vNormalLocal = normalize(position);
    vContinents = aContinents;
    vVolcano = aVolcano;
    vLocalPos = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const earthFragment = /* glsl */ `
  varying vec3 vNormalLocal;
  varying vec3 vWorldPos;
  varying vec3 vLocalPos;
  varying float vContinents;
  varying float vVolcano;
  uniform float uTime;
  uniform vec3 uSunPos;
  // Observation-channel palette (Vector B). Physics classifies the
  // surface; the channel decides RGB. Hard-coded literals are *gone*
  // from the fragment so e.g. a volcano over an ocean reads volcLand,
  // not the underlying ocean blue. Source of truth = OBSERVATION_PALETTES.
  uniform vec3 uColOcean;
  uniform vec3 uColShore;
  uniform vec3 uColLand;
  uniform vec3 uColVolc;
  uniform vec3 uColIce;
  // Volcano descriptor for in-shader volcLand classification — same
  // numbers fed to the vertex pass so visual & physics surface classes
  // can never disagree.
  uniform vec3  uVolcCenter;
  uniform float uVolcBaseR;
  uniform float uVolcHeight;
  uniform float uVolcCraterR;
  uniform float uVolcCraterD;
  uniform float uEarthR;

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
    // Land / volcano classification comes from the same baked values that
    // displaced the vertices, so colour and height can never disagree.
    float continents = vContinents;
    float landMask = smoothstep(0.48, 0.55, continents);
    float volcLift = vVolcano;
    // Shore band — landMask transition zone.
    float shoreMask = smoothstep(0.42, 0.50, continents) * (1.0 - smoothstep(0.50, 0.58, continents));
    // Mix ocean → shore → land, then overlay volcLand where uplift is
    // tall enough to count as dry surface. Polar ice last (latitude wins).
    // Sea floor colour by depth: sandy shallows fade to the deep ocean
    // bed. The see-through water surface is drawn separately at sea level.
    float seaDepth = max(0.0, uEarthR - length(vLocalPos));
    vec3 seaFloor = mix(uColShore * 0.85, uColOcean * 0.55, smoothstep(0.6, 14.0, seaDepth));
    vec3 col = mix(seaFloor, uColShore, shoreMask);
    col = mix(col, uColLand, landMask);
    float volcMask = smoothstep(2.0, 8.0, volcLift);
    col = mix(col, uColVolc, volcMask);
    float polar = smoothstep(0.78, 0.92, abs(n.y));
    col = mix(col, uColIce, polar);
    // Local refs for downstream near-camera blending.
    vec3 ocean = uColOcean;

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
      // Ground micro-variation tinted by the channel's land color so
      // grass/dirt match the orbit-distance land color exactly.
      vec3 grassDark = uColLand * 0.55;
      vec3 grassLight = uColLand * 1.25;
      vec3 dirt = uColShore;
      vec3 groundCol = mix(grassDark, grassLight, micro);
      groundCol = mix(groundCol, dirt, smoothstep(0.65, 0.85, micro2));
      groundCol *= 0.85 + stripes * 0.3;
      // Where the planet shader said "land", paint ground. Out at sea the
      // terrain is the sea floor under the see-through water surface.
      vec3 seaBed = seaFloor * (0.75 + micro * 0.4);
      vec3 surfaceCol = mix(seaBed, groundCol, max(landMask, volcMask));
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
  const terrainGeometry = useMemo(() => buildTerrainGeometry(), []);
  useEffect(() => () => terrainGeometry.dispose(), [terrainGeometry]);
  const seaGeometry = useMemo(() => new THREE.SphereGeometry(EARTH_RADIUS, EARTH_SPHERE_SEGMENTS, EARTH_SPHERE_RINGS), []);
  useEffect(() => () => seaGeometry.dispose(), [seaGeometry]);
  // The Moon is placed from the shared-epoch pose (earth.ts), never from
  // local elapsed time, so every peer sees the same Moon in the same phase.
  const initialMoonPos = useMemo<[number, number, number]>(() => [
    initialPose.moon[0] - initialPose.center[0],
    initialPose.moon[1] - initialPose.center[1],
    initialPose.moon[2] - initialPose.center[2],
  ], [initialPose]);
  const uniforms = useMemo(
    () => {
      const organ = getVolcanoOrgan(SHARED_VOLCANO_ANCHOR_ID);
      const channel = detectDefaultChannel();
      const palette = OBSERVATION_PALETTES[channel];
      const v3 = (rgb: readonly number[]) => new THREE.Vector3(rgb[0], rgb[1], rgb[2]);
      // Water bodies are literally H₂O — pull the colour from the
      // cosmoChemistry compound instead of the channel's "ocean" tint
      // so every channel still reads water as H₂O-blended.
      const waterRgb = hexToRgb01(COSMO_COMPOUNDS.water.color);
      return {
        uTime: { value: 0 },
        // Sourced from the shared-epoch pose Sun (updated each frame) so shader,
        // scene light, and daylight-biased spawn can never disagree.
        uSunPos: { value: new THREE.Vector3(...initialPose.sun) },
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
        // Observation channel palette — per-channel colors for each
        // physics SurfaceClass. Switching the channel never alters the
        // classification, only the rendered RGB.
        // Water must read BLUE. The H₂O compound colour (white H + red O)
        // washes the ocean out to pale pink-gray at a 50/50 blend, so
        // weight the channel's ocean blue 4:1 — chemistry stays present
        // as a faint tint without drowning the blue.
        uColOcean: {
          value: new THREE.Vector3(
            palette.ocean[0] * 0.8 + waterRgb[0] * 0.2,
            palette.ocean[1] * 0.8 + waterRgb[1] * 0.2,
            palette.ocean[2] * 0.8 + waterRgb[2] * 0.2,
          ),
        },
        uColShore: { value: v3(palette.shore) },
        uColLand:  { value: v3(palette.land) },
        uColVolc:  { value: v3(palette.volcLand) },
        uColIce:   { value: v3(palette.ice) },
      };
    },
    [initialPose],
  );
  // Moon shader: cratered grey lit by the same Sun. Direction recomputed
  // each frame against the moon's live world position.
  // Sea surface uses the same blue as the ocean channel (ocean palette
  // with a faint H₂O tint), so the water reads blue and matches orbit view.
  const waterColor = useMemo(() => {
    const o = uniforms.uColOcean.value as THREE.Vector3;
    return new THREE.Color(o.x, o.y, o.z);
  }, [uniforms]);
  const moonUniforms = useMemo(
    () => ({
      uSunPos: { value: new THREE.Vector3(...initialPose.sun) },
      // Lunar regolith compound colour — Si/O/Fe/Mg/Al/Ca blend.
      uRegolith: {
        value: new THREE.Vector3(...hexToRgb01(COSMO_COMPOUNDS.moon.color)),
      },
    }),
    [initialPose],
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

    // The Sun travels with the solar system — keep both shaders lit by
    // its live position.
    if (matRef.current) {
      (matRef.current.uniforms.uSunPos.value as THREE.Vector3).set(pose.sun[0], pose.sun[1], pose.sun[2]);
    }
    if (moonMatRef.current) {
      (moonMatRef.current.uniforms.uSunPos.value as THREE.Vector3).set(pose.sun[0], pose.sun[1], pose.sun[2]);
    }

    // Moon orbit from the shared-epoch pose — relative to Earth's group.
    if (moonGroupRef.current) {
      moonGroupRef.current.position.set(
        pose.moon[0] - pose.center[0],
        pose.moon[1] - pose.center[1],
        pose.moon[2] - pose.center[2],
      );
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
        <primitive object={terrainGeometry} attach="geometry" />
        <shaderMaterial
          ref={matRef}
          vertexShader={earthVertex}
          fragmentShader={earthFragment}
          uniforms={uniforms}
          side={THREE.DoubleSide}
        />
      </mesh>
      {/* Sea surface at sea level. Out at sea the terrain below is the sea
          floor (shallows → shelf → deep ocean bed), seen through the water;
          over land the terrain is higher and hides this sphere by depth. */}
      <mesh renderOrder={1}>
        <primitive object={seaGeometry} attach="geometry" />
        <meshPhongMaterial
          color={waterColor}
          emissive={waterColor}
          emissiveIntensity={0.25}
          transparent
          opacity={0.6}
          shininess={80}
          depthWrite={false}
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
              uniform vec3 uRegolith;
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
                // Regolith compound colour modulated by crater shadow noise.
                vec3 dark = uRegolith * 0.55;
                vec3 lite = uRegolith * 1.10;
                vec3 base = mix(dark, lite, craters);
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