import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  EARTH_RADIUS,
  EARTH_SPHERE_RINGS,
  EARTH_SPHERE_SEGMENTS,
  getEarthPose,
  getEarthPoseTime,
  MOON_RADIUS,
  WORLD_SCALE,
  worldPosToLocalNormal,
} from '@/lib/brain/earth';
import { getVolcanoOrgan, SHARED_VOLCANO_ANCHOR_ID } from '@/lib/brain/volcanoOrgan';
import { buildCraterPatchGeometry, buildTerrainGeometry } from '@/lib/brain/terrainGeometry';
import { getCraterCarve } from '@/lib/brain/craterCarve';
import { OBSERVATION_PALETTES, detectDefaultChannel } from '@/lib/brain/observationBias';
import { COSMO_COMPOUNDS, hexToRgb01 } from '@/lib/brain/cosmoChemistry';
import { volcanoLavaRadius } from '@/lib/brain/volcanoEffects';
import { getMantlePressure } from '@/lib/brain/lavaMantle';
import { ventGlowAt } from '@/lib/brain/eruptionCycle';
import { swellPhases, tideFrameAt } from '@/lib/brain/sea/seaSurface';
import { makeSeaMaterial } from '@/components/brain/sea/seaMaterial';
import { seaStateFor } from '@/lib/brain/sea/vessel';
import { weatherCurvatureBoost, windAt } from '@/lib/world/weather';
import { BEACH_LOW_M, BEACH_TOP_M } from '@/lib/brain/beach';

/**
 * Procedural blue-green Earth with shared-pose solar lighting. The
 * shader colours land/ocean from a low-frequency noise of the sphere's
 * unit-vector position so it looks alive without external assets.
 */
const earthVertex = /* glsl */ `
  varying vec3 vNormalLocal;
  varying vec3 vNormalWorld;
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
    // Baked slope normals, rotated into the same frame as Sun and position.
    vNormalWorld = normalize(mat3(modelMatrix) * normal);
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
  varying vec3 vNormalWorld;
  varying vec3 vWorldPos;
  varying vec3 vLocalPos;
  varying float vContinents;
  varying float vVolcano;
  uniform float uTime;
  uniform vec3 uSunPos;
  uniform vec3 uLavaPos;
  uniform vec3 uLavaColor;
  uniform float uLavaPower;
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
  // Beach band (m above mean sea level), from beach.ts: the sand a shovel
  // scoops salt from is exactly the sand drawn here.
  uniform float uBeachTop;
  uniform float uBeachLow;
  // The summit crater is cut out of the baked Earth mesh and drawn by the
  // crater patch (same shader, CRATER_PATCH defined) from the carved
  // heights physics walks on (craterCarve.ts).
  uniform float uCraterHoleCos;

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
#ifndef CRATER_PATCH
    if (dot(n, uVolcCenter) > uCraterHoleCos) discard;
#endif
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
    // Beach: one band of the drawn ground's own height, from wet sand just
    // under the waterline to a crisp edge with the grass at uBeachTop.
    float elev = length(vLocalPos) - uEarthR;
    float beachMask = smoothstep(uBeachLow - 0.3, uBeachLow, elev)
      * (1.0 - smoothstep(uBeachTop - 0.12, uBeachTop + 0.12, elev))
      * (1.0 - volcMask) * (1.0 - polar);
    vec3 sand = uColShore * 1.12;
    col = mix(col, sand, beachMask);
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
      // Ground micro-variation tinted by the channel's land color so
      // grass/dirt match the orbit-distance land color exactly.
      vec3 grassDark = uColLand * 0.55;
      vec3 grassLight = uColLand * 1.25;
      vec3 dirt = uColShore;
      vec3 groundCol = mix(grassDark, grassLight, micro);
      groundCol = mix(groundCol, dirt, smoothstep(0.65, 0.85, micro2));
      // Where the planet shader said "land", paint ground. Out at sea the
      // terrain is the sea floor under the see-through water surface.
      vec3 seaBed = seaFloor * (0.75 + micro * 0.4);
      // Basalt/ash retains its volcanic material even at walking distance.
      vec3 volcanicStone = uColVolc * (0.55 + micro * 0.65);
      vec3 surfaceCol = mix(seaBed, groundCol, landMask);
      surfaceCol = mix(surfaceCol, volcanicStone, volcMask);
      // Sand: fine ripples, darker where the sea wets it.
      float wet = 1.0 - smoothstep(-0.1, 0.45, elev);
      vec3 drySand = sand * (0.9 + micro2 * 0.16 + micro3 * 0.08);
      vec3 beachCol = mix(drySand, drySand * 0.72, wet);
      surfaceCol = mix(surfaceCol, beachCol, beachMask);
      surfaceCol = mix(surfaceCol, uColIce * (0.85 + micro * 0.15), polar);
      col = mix(col, surfaceCol, nearMix);
    }

    // Sun direction derived from the real scene Sun's world position —
    // no abstract sky box, no painted sun. The lit hemisphere of Earth
    // matches wherever the <pointLight> actually is.
    vec3 lightDir = normalize(uSunPos - vWorldPos);
    float diff = max(dot(normalize(vNormalWorld), lightDir), 0.0);
    float ambient = 0.25;
    col *= (ambient + diff * 1.1);
    // Custom terrain shaders do not receive scene point lights automatically.
    // Add local incandescent fill with Lambert incidence and inverse-square falloff.
    vec3 toLava = uLavaPos - vWorldPos;
    float lavaDistanceSq = max(dot(toLava, toLava), 0.01);
    float lavaIncidence = max(dot(normalize(vNormalWorld), normalize(toLava)), 0.0);
    col += uLavaColor * uColVolc * lavaIncidence * uLavaPower / lavaDistanceSq;

    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Seconds between sea-state reads at the camera (weather moves slowly). */
const SEA_STATE_EVERY_S = 0.5;
/** How far inside the rim the Earth mesh's crater hole starts (m). */
const CRATER_HOLE_OVERLAP_M = 0.6;

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
  const lavaSite = useMemo(() => {
    const organ = getVolcanoOrgan(SHARED_VOLCANO_ANCHOR_ID);
    return new THREE.Vector3(...organ.centerNormal).multiplyScalar(volcanoLavaRadius(organ) + 0.3);
  }, []);
  const lavaPosition = useMemo(() => new THREE.Vector3(), []);
  const lavaSpin = useMemo(() => new THREE.Quaternion(), []);
  const terrainGeometry = useMemo(() => buildTerrainGeometry(), []);
  useEffect(() => () => terrainGeometry.dispose(), [terrainGeometry]);
  const craterGeometry = useMemo(() => buildCraterPatchGeometry(), []);
  useEffect(() => () => craterGeometry.dispose(), [craterGeometry]);
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
        uLavaPos: { value: lavaSite.clone().applyQuaternion(new THREE.Quaternion(...initialPose.spinQuat)).add(new THREE.Vector3(...initialPose.center)) },
        uLavaColor: { value: new THREE.Color('hsl(20, 100%, 58%)') },
        uLavaPower: { value: 8 },
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
        uBeachTop: { value: BEACH_TOP_M },
        uBeachLow: { value: BEACH_LOW_M },
        // Hole a little inside the rim: the patch overlaps the mesh there.
        uCraterHoleCos: { value: Math.cos((getCraterCarve().rimR - CRATER_HOLE_OVERLAP_M) / EARTH_RADIUS) },
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
    [initialPose, lavaSite],
  );
  // The carved crater: drawn by the Earth shader itself (shared uniforms,
  // so Sun and lava glow stay in step), without the crater hole.
  const craterMat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: earthVertex,
    fragmentShader: earthFragment,
    uniforms,
    defines: { CRATER_PATCH: 1 },
    side: THREE.DoubleSide,
    // Wins the thin overlap band at the rim where both surfaces coincide.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  }), [uniforms]);
  useEffect(() => () => craterMat.dispose(), [craterMat]);
  // Moon shader: cratered grey lit by the same Sun. Direction recomputed
  // each frame against the moon's live world position.
  // Sea surface uses the same blue as the ocean channel (ocean palette
  // with a faint H₂O tint), so the water reads blue and matches orbit view.
  const waterColor = useMemo(() => {
    const o = uniforms.uColOcean.value as THREE.Vector3;
    return new THREE.Color(o.x, o.y, o.z);
  }, [uniforms]);
  const sea = useMemo(() => makeSeaMaterial(waterColor), [waterColor]);
  useEffect(() => () => sea.mat.dispose(), [sea]);
  const seaRef = useRef<THREE.Mesh>(null);
  const seaStateAt = useRef(-Infinity);
  const swellPhase = useMemo<number[]>(() => [], []);
  const camWorld = useMemo(() => new THREE.Vector3(), []);
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

  useFrame(({ camera }, dt) => {
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

    // The sea spins with the planet (its swell is fixed to the Earth) and
    // takes its tide and swell from the shared clock.
    if (seaRef.current) seaRef.current.rotation.y = pose.spinAngle;
    const tNow = getEarthPoseTime();
    const tide = tideFrameAt(tNow);
    sea.uniforms.uTideMoon.value.set(tide.moon[0], tide.moon[1], tide.moon[2]);
    sea.uniforms.uTideSun.value.set(tide.sun[0], tide.sun[1], tide.sun[2]);
    swellPhases(tNow, swellPhase);
    sea.uniforms.uSwellPhase.value.set(swellPhase[0], swellPhase[1], swellPhase[2]);
    // Sea state where the viewer is: the same rule that rocks the boats.
    if (Math.abs(tNow - seaStateAt.current) >= SEA_STATE_EVERY_S) {
      seaStateAt.current = tNow;
      camera.getWorldPosition(camWorld);
      const n = worldPosToLocalNormal([camWorld.x, camWorld.y, camWorld.z], pose);
      const w = windAt(n);
      sea.uniforms.uSea.value = seaStateFor(Math.hypot(w[0], w[1], w[2]), weatherCurvatureBoost(n));
    }

    // The Sun travels with the solar system — keep both shaders lit by
    // its live position.
    if (matRef.current) {
      (matRef.current.uniforms.uSunPos.value as THREE.Vector3).set(pose.sun[0], pose.sun[1], pose.sun[2]);
      lavaSpin.set(...pose.spinQuat);
      lavaPosition.copy(lavaSite).applyQuaternion(lavaSpin);
      lavaPosition.x += pose.center[0];
      lavaPosition.y += pose.center[1];
      lavaPosition.z += pose.center[2];
      (matRef.current.uniforms.uLavaPos.value as THREE.Vector3).copy(lavaPosition);
      // Vent glow follows the shared eruption cycle (faint while the magma
      // rests deep in the conduit); shared mantle pressure shades it.
      matRef.current.uniforms.uLavaPower.value = (1 + 19 * ventGlowAt(tNow))
        * (0.85 + 0.3 * Math.max(0, Math.min(1, getMantlePressure(tNow))));
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
        {/* Summit crater: the bowl and the open vent mouth, carved from the
            same heights the walker stands on (craterCarve.ts). */}
        <mesh geometry={craterGeometry} material={craterMat} />
      </mesh>
      {/* Sea surface at sea level, raised and lowered by the shared tide
          (sea/seaSurface.ts) — the same tide swimmers and boats float on. Out at sea the terrain below is the sea
          floor (shallows → shelf → deep ocean bed), seen through the water;
          over land the terrain is higher and hides this sphere by depth. */}
      <mesh ref={seaRef} renderOrder={1} rotation-y={initialPose.spinAngle}>
        <primitive object={seaGeometry} attach="geometry" />
        <primitive object={sea.mat} attach="material" />
      </mesh>
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