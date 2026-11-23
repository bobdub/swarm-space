/**
 * VolcanoLavaPool — the magma column in the vent, the summit pond it
 * forms during an eruption, and the lava tongues that run down the flanks.
 *
 * Rendered by `VolcanoOverlay` in the crater frame (+y along the volcano's
 * centre normal, y = 0 at `volcanoLavaRadius`, 0.25 m above the baked vent
 * floor), so it inherits the volcano's world pose. When and how high the
 * magma stands comes from `eruptionCycle.ts`; where the lava runs comes
 * from `lavaFlows.ts`; both read the shared Earth clock, so every peer
 * sees the same eruption.
 *
 * The crater is carved for real (`craterCarve.ts`): EarthBody cuts it out
 * of the baked mesh and draws the bowl, whose flat floor ring opens onto
 * the vent. Everything here sits on that same carved ground, never a flat
 * plate floating over it:
 *
 * 1. The conduit, continuing the vent mouth straight down: dark rock walls
 *    warmed by the magma's glow, and the top of the magma column, far down
 *    when the volcano is quiet. Ordinary depth-tested geometry, so you can
 *    walk to the edge, look down the shaft, and fall in.
 * 2. The summit pond: when the column reaches the floor, magma fills the
 *    bowl to `POND_LEVEL_M`, only where the carved ground is lower, with
 *    crust plates and slug-burst rings.
 * 3. Lava tongues: ribbons draped down the steepest descent of the baked
 *    slopes, revealed up to each front, incandescent in the fed channel
 *    and at the front, then crusting dark and weathering away.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { EARTH_RADIUS, getEarthPoseTime, type Vec3 } from '@/lib/brain/earth';
import { getMantlePressure } from '@/lib/brain/lavaMantle';
import { sampleTerrainLift } from '@/lib/brain/terrainMesh';
import { carvedGroundAt, craterMagmaLevelAt, getCraterCarve } from '@/lib/brain/craterCarve';
import { CRATER_PATCH_SEGMENTS } from '@/lib/brain/terrainGeometry';
import type { VolcanoOrgan } from '@/lib/brain/volcanoOrgan';
import { volcanoLavaRadius } from '@/lib/brain/volcanoEffects';
import {
  STROMBOLIAN_PERIOD_S,
  UPWELL_AXIS_SPEED,
  conduitProfile,
  conduitRadiusAt,
  slugPhaseAt,
  throatRadius,
} from '@/lib/brain/magmaConduit';
import { eruptionStateAt, ventGlowAt } from '@/lib/brain/eruptionCycle';
import {
  flowHalfWidthAt,
  lavaFlowPaths,
  lavaFlowStateAt,
  stepOnSphere,
} from '@/lib/brain/lavaFlows';

/** Shader clock wraps here so float32 keeps sub-millisecond detail. */
const SHADER_CLOCK_WRAP_S = 3600;
/** How far draped surfaces sit above the baked ground (m). */
const DRAPE_M = 0.12;
/** Reach of the vent light (m). */
const LIGHT_REACH_M = 288;

const noiseGlsl = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`;

/** Pond: draped ground below, flat melt surface wherever it is deeper. */
const pondVertex = /* glsl */ `
  attribute float aGround;
  attribute float aCarve;
  uniform float uLevel;
  varying vec2 vUv;
  varying float vSub;
  varying float vCarve;
  void main() {
    vUv = uv;
    vSub = uLevel - aGround;
    vCarve = aCarve;
    vec3 p = position;
    p.y = max(aGround + ${DRAPE_M.toFixed(2)}, uLevel);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

/** Column head: a flat disk down the conduit (always fully molten). */
const headVertex = /* glsl */ `
  varying vec2 vUv;
  varying float vSub;
  varying float vCarve;
  void main() {
    vUv = uv;
    vSub = 1.0;
    vCarve = 0.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const meltFragment = /* glsl */ `
  varying vec2 vUv;
  varying float vSub;
  varying float vCarve;
  uniform float uTime;
  uniform float uHeat;     // 0 crusted … 1 vigorous
  uniform float uThroat;   // neck radius / surface radius
  uniform float uSpread;   // radial area flux (r² per second, surface units)
  uniform float uBurstAge; // seconds since the last slug burst
  uniform float uSolid;    // 1 for the opaque column head
  ${noiseGlsl}

  void main() {
    vec2 uv = (vUv - 0.5) * 2.0;
    float r = length(uv);
    if (r > 1.0) discard;
    // Melt only where it is actually deeper than the ground (pond), and
    // never as a sheet hanging off the summit's lower edge. Depth carved
    // out of the crater bowl (vCarve) is legitimately deep: it fills.
    float wet = smoothstep(0.0, 0.15, vSub) * (1.0 - smoothstep(1.1, 1.7, vSub - vCarve));
    if (wet <= 0.001) discard;
    vec2 dir = r > 1e-4 ? uv / r : vec2(1.0, 0.0);

    // Radial spreading from the neck: s = r² − Q·t rides with the melt.
    float s = r * r - uSpread * uTime;
    vec2 p = dir * 2.6 + vec2(s * 9.0, s * 6.0);
    float flow = noise(p) + 0.5 * noise(p * 2.3 + 7.1);

    // Crust thickens outward from the neck as the melt cools and slows.
    float cool = smoothstep(uThroat, 1.0, r);
    float crackW = mix(0.16, 0.05, cool);
    float crack = 1.0 - smoothstep(crackW * 0.5, crackW, abs(flow - 0.75));
    float warm = (1.0 - cool) * (1.0 - cool);
    float heat = clamp((crack * (1.0 - 0.45 * cool) + warm * 0.6) * (0.35 + 0.65 * uHeat), 0.0, 1.0);

    vec3 crust = vec3(0.10, 0.05, 0.05);
    vec3 molten = mix(vec3(0.95, 0.28, 0.05), vec3(1.0, 0.85, 0.35), heat * 0.7);
    vec3 color = mix(crust, molten, heat);

    // A gas slug bursts at the neck and its ring runs outward.
    float ringR = uThroat + uBurstAge * 0.18;
    float ring = exp(-uBurstAge * 0.9) * (1.0 - smoothstep(0.0, 0.05, abs(r - ringR)));
    color += vec3(1.0, 0.75, 0.35) * ring * 1.4 * uHeat;

    float neck = 1.0 - smoothstep(uThroat * 0.75, uThroat, r);
    color = mix(color, vec3(1.0, 0.82, 0.45), neck * 0.75 * uHeat);
    float alpha = max(uSolid, (1.0 - smoothstep(0.94, 1.0, r)) * wet);
    gl_FragColor = vec4(color, alpha);
  }
`;

const wallVertex = /* glsl */ `
  varying vec3 vPos;
  void main() {
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** Conduit wall above the magma head: dark rock warmed by its glow. */
const wallFragment = /* glsl */ `
  varying vec3 vPos;
  uniform float uHead;
  uniform float uHeat;
  ${noiseGlsl}

  void main() {
    float above = vPos.y - uHead;
    if (above < 0.0) discard; // below the head the conduit is full of magma
    float ang = atan(vPos.z, vPos.x);
    vec2 dir = vec2(cos(ang), sin(ang));
    float strata = noise(dir * 4.0 + vec2(vPos.y * 0.35, 0.0)) * 0.6
                 + noise(dir * 11.0 + vec2(vPos.y * 1.3, 3.0)) * 0.4;
    vec3 rock = vec3(0.07, 0.06, 0.06) * (0.6 + 0.8 * strata);
    float glow = exp(-above / 9.0) * uHeat;
    vec3 col = rock + vec3(1.0, 0.32, 0.07) * glow * (0.6 + 0.6 * strata);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const flowVertex = /* glsl */ `
  attribute float aS;
  attribute float aU;
  attribute float aTongue;
  attribute float aHalfW;
  uniform vec3 uFront;
  uniform vec3 uFrontGlow;
  varying float vS;
  varying float vU;
  varying float vFront;
  varying float vFrontGlow;
  varying float vHalfW;
  void main() {
    vS = aS;
    vU = aU;
    vHalfW = aHalfW;
    vFront = aTongue < 0.5 ? uFront.x : (aTongue < 1.5 ? uFront.y : uFront.z);
    vFrontGlow = aTongue < 0.5 ? uFrontGlow.x : (aTongue < 1.5 ? uFrontGlow.y : uFrontGlow.z);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const flowFragment = /* glsl */ `
  varying float vS;
  varying float vU;
  varying float vFront;
  varying float vFrontGlow;
  varying float vHalfW;
  uniform float uTime;
  uniform float uFeed;
  uniform float uHeat;
  uniform float uPresence;
  ${noiseGlsl}

  void main() {
    // A rounded lobe at the front.
    float edge = vFront - vHalfW * (1.0 - sqrt(max(0.0, 1.0 - vU * vU)));
    if (vFront <= 0.0 || vS > edge) discard;
    float behind = edge - vS;
    // Crust plates carried downstream while the channel is fed.
    vec2 p = vec2(vS * 0.22 - uTime * 0.9 * uFeed, vU * 1.6 + vS * 0.03);
    float n = noise(p) + 0.5 * noise(p * 2.3 + 3.1);
    float crack = 1.0 - smoothstep(0.04, 0.12, abs(n - 0.75));
    float channel = uFeed * exp(-vS / 90.0) * (1.0 - 0.6 * abs(vU));
    float front = vFrontGlow * exp(-behind / 5.0);
    float hot = clamp((channel + front + crack * 0.45) * uHeat, 0.0, 1.0);
    vec3 basalt = vec3(0.055, 0.045, 0.045) * (0.75 + 0.5 * n);
    vec3 molten = mix(vec3(0.75, 0.13, 0.03), vec3(1.0, 0.72, 0.28), hot);
    vec3 color = mix(basalt, molten, hot);
    float alpha = uPresence * (1.0 - smoothstep(0.75, 1.0, abs(vU)));
    gl_FragColor = vec4(color, alpha);
  }
`;

interface CraterFrame {
  /** Earth-local unit normal at the vent. */
  n: THREE.Vector3;
  /** Crater frame → Earth-local rotation. */
  q: THREE.Quaternion;
  /** Earth-local → crater frame rotation. */
  qInv: THREE.Quaternion;
  /** Radius of the crater-frame origin. */
  origin: number;
}

function makeCraterFrame(organ: VolcanoOrgan): CraterFrame {
  const n = new THREE.Vector3(...organ.centerNormal).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
  return { n, q, qInv: q.clone().invert(), origin: volcanoLavaRadius(organ) };
}

const _v = new THREE.Vector3();
/** Earth-local point (unit direction × radius) → crater frame. */
function toCrater(f: CraterFrame, dir: Vec3, radius: number, out: THREE.Vector3): THREE.Vector3 {
  out.set(dir[0] * radius, dir[1] * radius, dir[2] * radius);
  out.addScaledVector(f.n, -f.origin).applyQuaternion(f.qInv);
  return out;
}

/** Earth-local unit direction under crater-frame plane point (x, z). */
function dirUnder(f: CraterFrame, x: number, z: number): Vec3 {
  _v.set(x, 0, z).applyQuaternion(f.q).addScaledVector(f.n, f.origin).normalize();
  return [_v.x, _v.y, _v.z];
}

/**
 * A polar disk draped on the carved crater ground (`carvedGroundAt`: the
 * bowl, and the floor level across the vent mouth): vertex positions sit
 * `lift` m above it, `aGround` holds the ground's crater-frame height,
 * `aCarve` how far the bowl is carved below the baked summit, and the uv
 * is the nominal disk coordinate (for the melt shader).
 */
function drapedDisk(f: CraterFrame, radius: number, rings: number, segments: number, lift: number) {
  const positions: number[] = [];
  const uvs: number[] = [];
  const ground: number[] = [];
  const carve: number[] = [];
  const index: number[] = [];
  const p = new THREE.Vector3();
  const push = (x: number, z: number) => {
    const d = dirUnder(f, x, z);
    const baked = sampleTerrainLift(d);
    const carved = carvedGroundAt(d, baked);
    toCrater(f, d, EARTH_RADIUS + carved, p);
    ground.push(p.y);
    carve.push(baked - carved);
    positions.push(p.x, p.y + lift, p.z);
    uvs.push(0.5 + (0.5 * x) / radius, 0.5 + (0.5 * z) / radius);
  };
  push(0, 0);
  for (let r = 1; r <= rings; r++) {
    const rr = (radius * r) / rings;
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      push(rr * Math.cos(a), rr * Math.sin(a));
    }
  }
  for (let s = 0; s < segments; s++) {
    // Wound so the face points up (+y) in the crater frame.
    index.push(0, 1 + ((s + 1) % segments), 1 + s);
  }
  for (let r = 1; r < rings; r++) {
    const a0 = 1 + (r - 1) * segments;
    const b0 = 1 + r * segments;
    for (let s = 0; s < segments; s++) {
      const s1 = (s + 1) % segments;
      index.push(a0 + s, a0 + s1, b0 + s, a0 + s1, b0 + s1, b0 + s);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.setAttribute('aGround', new THREE.Float32BufferAttribute(ground, 1));
  g.setAttribute('aCarve', new THREE.Float32BufferAttribute(carve, 1));
  g.setIndex(index);
  g.computeBoundingSphere();
  return { geometry: g, minGround: Math.min(...ground) };
}

/** All tongues as one draped ribbon mesh (one draw call). */
function flowRibbons(f: CraterFrame, organ: VolcanoOrgan): THREE.BufferGeometry {
  const lanes = [-1, -0.5, 0, 0.5, 1];
  const positions: number[] = [];
  const aS: number[] = [];
  const aU: number[] = [];
  const aTongue: number[] = [];
  const aHalfW: number[] = [];
  const index: number[] = [];
  const p = new THREE.Vector3();
  lavaFlowPaths(organ).forEach((path, tongue) => {
    for (let j = 0; j < path.dirs.length; j++) {
      const base = positions.length / 3;
      const hw = flowHalfWidthAt(path.s[j]);
      for (const u of lanes) {
        const d = stepOnSphere(path.dirs[j], path.left[j], u * hw);
        // A low levee-bounded body: thickest on the centreline.
        const thick = 0.18 + 0.55 * Math.sqrt(Math.max(0, 1 - u * u));
        toCrater(f, d, EARTH_RADIUS + sampleTerrainLift(d) + thick, p);
        positions.push(p.x, p.y, p.z);
        aS.push(path.s[j]);
        aU.push(u);
        aTongue.push(tongue);
        aHalfW.push(hw);
      }
      if (j === 0) continue;
      const prev = base - lanes.length;
      for (let k = 0; k < lanes.length - 1; k++) {
        index.push(prev + k, base + k, prev + k + 1, prev + k + 1, base + k, base + k + 1);
      }
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('aS', new THREE.Float32BufferAttribute(aS, 1));
  g.setAttribute('aU', new THREE.Float32BufferAttribute(aU, 1));
  g.setAttribute('aTongue', new THREE.Float32BufferAttribute(aTongue, 1));
  g.setAttribute('aHalfW', new THREE.Float32BufferAttribute(aHalfW, 1));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

export function VolcanoLavaPool({ organ }: { radius?: number; organ: VolcanoOrgan }) {
  const lightRef = useRef<THREE.PointLight>(null);

  const throat = throatRadius(organ);

  const parts = useMemo(() => {
    const frame = makeCraterFrame(organ);
    const carve = getCraterCarve();
    // The vent mouth: the bowl's neck ring (arc `neckR` on the sphere at
    // floor level), projected into the crater frame so the sleeve meets
    // it vertex for vertex.
    const neckAng = carve.neckR / EARTH_RADIUS;
    const neckRad = EARTH_RADIUS + carve.floorElev;
    const mouthR = neckRad * Math.sin(neckAng);
    const mouthY = neckRad * Math.cos(neckAng) - frame.origin;
    const pond = drapedDisk(frame, carve.rimR, 20, 64, 0);
    const flows = flowRibbons(frame, organ);

    // Conduit sleeve from the deep root up to the vent mouth, where it
    // meets the bowl's neck ring vertex for vertex.
    const pts = conduitProfile(organ)
      .filter(([, y]) => y < mouthY - 0.5)
      .map(([r, y]) => new THREE.Vector2(r, y));
    pts.push(new THREE.Vector2(mouthR, mouthY));
    const sleeve = new THREE.LatheGeometry(pts, CRATER_PATCH_SEGMENTS);
    const head = new THREE.CircleGeometry(1, 32);
    head.rotateX(-Math.PI / 2);

    const meltUniforms = (throatFrac: number) => ({
      uTime: { value: 0 },
      uHeat: { value: 0 },
      uThroat: { value: throatFrac },
      // Area flux matched to the conduit's mean rise through the neck,
      // in surface units (r² per second), slowed for the eye.
      uSpread: { value: (0.5 * UPWELL_AXIS_SPEED * throatFrac ** 2) / 6 },
      uBurstAge: { value: 99 },
      uSolid: { value: 0 },
    });
    const headMat = new THREE.ShaderMaterial({
      vertexShader: headVertex,
      fragmentShader: meltFragment,
      uniforms: { ...meltUniforms(0.6), uSolid: { value: 1 } },
    });
    const wallMat = new THREE.ShaderMaterial({
      vertexShader: wallVertex,
      fragmentShader: wallFragment,
      uniforms: { uHead: { value: -40 }, uHeat: { value: 0 } },
      // Seen from inside the shaft; DoubleSide so the walls still close
      // the view when the eye is down the conduit at a steep angle.
      side: THREE.DoubleSide,
    });
    const pondMat = new THREE.ShaderMaterial({
      vertexShader: pondVertex,
      fragmentShader: meltFragment,
      uniforms: { ...meltUniforms(Math.min(0.9, throat / carve.rimR)), uLevel: { value: -40 } },
      transparent: true,
      depthWrite: false,
    });
    const flowMat = new THREE.ShaderMaterial({
      vertexShader: flowVertex,
      fragmentShader: flowFragment,
      uniforms: {
        uTime: { value: 0 },
        uFeed: { value: 0 },
        uHeat: { value: 0 },
        uPresence: { value: 0 },
        uFront: { value: new THREE.Vector3() },
        uFrontGlow: { value: new THREE.Vector3() },
      },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    return {
      pond: pond.geometry,
      pondMinGround: pond.minGround,
      mouthY,
      flows,
      sleeve,
      head,
      headMat,
      wallMat,
      pondMat,
      flowMat,
    };
  }, [organ, throat]);
  useEffect(() => () => {
    parts.pond.dispose();
    parts.flows.dispose();
    parts.sleeve.dispose();
    parts.head.dispose();
    parts.headMat.dispose();
    parts.wallMat.dispose();
    parts.pondMat.dispose();
    parts.flowMat.dispose();
  }, [parts]);

  const headRef = useRef<THREE.Mesh>(null);
  const conduitRef = useRef<THREE.Group>(null);
  const pondRef = useRef<THREE.Mesh>(null);
  const flowRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const time = getEarthPoseTime();
    const wrapped = ((time % SHADER_CLOCK_WRAP_S) + SHADER_CLOCK_WRAP_S) % SHADER_CLOCK_WRAP_S;
    const state = eruptionStateAt(time);
    // Capped at the rim's spill point: above it the magma pours out.
    const level = craterMagmaLevelAt(time);
    const burstAge = slugPhaseAt(time) * STROMBOLIAN_PERIOD_S;
    // Mantle pressure (shared clock) shades the brightness.
    const mantle = 0.85 + 0.3 * Math.max(0, Math.min(1, getMantlePressure(time)));
    const glow = ventGlowAt(time);
    const heat = Math.min(1, 0.4 + 0.6 * Math.max(state.pressure, state.effusion));

    // Column head and the walls above it, seen down the vent.
    const headVisible = level < parts.mouthY;
    if (conduitRef.current) conduitRef.current.visible = headVisible;
    if (headVisible && headRef.current) {
      const r = conduitRadiusAt(organ, Math.max(0, -level));
      headRef.current.position.y = level;
      headRef.current.scale.set(r, 1, r);
      const u = parts.headMat.uniforms;
      u.uTime.value = wrapped;
      u.uHeat.value = heat;
      u.uBurstAge.value = burstAge;
      parts.wallMat.uniforms.uHead.value = level;
      parts.wallMat.uniforms.uHeat.value = heat;
    }

    // Summit pond, only once magma stands above some of the floor.
    const pondVisible = level > parts.pondMinGround;
    if (pondRef.current) pondRef.current.visible = pondVisible;
    if (pondVisible) {
      const u = parts.pondMat.uniforms;
      u.uTime.value = wrapped;
      u.uHeat.value = heat;
      u.uBurstAge.value = burstAge;
      u.uLevel.value = level;
    }

    // Lava tongues on the flanks.
    const flows = lavaFlowStateAt(organ, time);
    const anyFront = flows.fronts.some((f) => f > 0);
    const flowVisible = anyFront && flows.presence > 0;
    if (flowRef.current) flowRef.current.visible = flowVisible;
    if (flowVisible) {
      const u = parts.flowMat.uniforms;
      u.uTime.value = wrapped;
      u.uFeed.value = flows.feed;
      u.uHeat.value = flows.heat;
      u.uPresence.value = flows.presence;
      (u.uFront.value as THREE.Vector3).set(flows.fronts[0] ?? 0, flows.fronts[1] ?? 0, flows.fronts[2] ?? 0);
      (u.uFrontGlow.value as THREE.Vector3).set(flows.frontGlow[0] ?? 0, flows.frontGlow[1] ?? 0, flows.frontGlow[2] ?? 0);
    }

    if (lightRef.current) {
      const near = Math.exp(-Math.max(0, -level) / 10);
      lightRef.current.position.y = Math.max(level, 0) + 0.6;
      lightRef.current.intensity = (1.5 + 24 * glow) * mantle
        + (Math.sin(time * 1.7) * 1.2 + 10 * Math.exp(-burstAge * 1.5)) * near;
    }
  });

  return (
    <group>
      {/* 1. The conduit down the vent: magma head and the walls above it. */}
      <group ref={conduitRef}>
        <mesh ref={headRef} geometry={parts.head} material={parts.headMat} frustumCulled={false} />
        <mesh geometry={parts.sleeve} material={parts.wallMat} frustumCulled={false} />
      </group>
      {/* 2. Summit pond, draped on the carved bowl and depth-tested. */}
      <mesh ref={pondRef} geometry={parts.pond} material={parts.pondMat} renderOrder={13} visible={false} frustumCulled={false} />
      {/* 3. Lava tongues down the flanks. */}
      <mesh ref={flowRef} geometry={parts.flows} material={parts.flowMat} renderOrder={14} visible={false} />
      <pointLight
        ref={lightRef}
        position={[0, 0.6, 0]}
        color="hsl(20, 100%, 58%)"
        intensity={2}
        distance={LIGHT_REACH_M}
        decay={2}
      />
    </group>
  );
}

export default VolcanoLavaPool;
