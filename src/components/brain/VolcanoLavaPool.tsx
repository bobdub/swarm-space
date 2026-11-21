/**
 * VolcanoLavaPool — the lava lake in the crater and the magma conduit
 * that feeds it from the deep mantle (`src/lib/brain/magmaConduit.ts`).
 *
 * Rendered by `VolcanoOverlay` in the crater frame (+y along the volcano's
 * centre normal, y = 0 at the mean lake level), so it inherits the
 * volcano's world pose. Three pieces:
 *
 * 1. A neck "window" at the centre of the lake. It draws no colour; it only
 *    marks its pixels in the stencil buffer where nothing stands in front.
 * 2. The conduit: a hyperboloid sleeve down to the core-mantle boundary
 *    and the white-hot plume root at its foot. It is drawn only through
 *    the window (stencil test, no depth test), so you look down the neck
 *    into the rising column while the crater floor you stand on stays the
 *    same solid, baked ground. Without a stencil buffer it is not drawn.
 * 3. The lake surface: magma wells up in the neck and spreads outward,
 *    crust plates riding the radial flow, thickening and slowing toward the
 *    rim; bursts of gas slugs ring out from the neck on the shared clock.
 *
 * Everything moves on the shared Earth clock (`getEarthPoseTime`), so
 * every peer sees the same lake; brightness follows live mantle pressure.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getMantlePressure } from '@/lib/brain/lavaMantle';
import { getEarthPoseTime } from '@/lib/brain/earth';
import type { VolcanoOrgan } from '@/lib/brain/volcanoOrgan';
import {
  STROMBOLIAN_PERIOD_S,
  UPWELL_AXIS_SPEED,
  conduitDepth,
  conduitProfile,
  magmaHeadAt,
  slugPhaseAt,
  throatRadius,
  upwellSpeedAt,
} from '@/lib/brain/magmaConduit';

/** Shader clock wraps here so float32 keeps sub-millisecond detail. */
const SHADER_CLOCK_WRAP_S = 3600;
/** Window stencil value. */
const NECK_STENCIL = 1;

const noiseGlsl = /* glsl */ `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`;

const lakeVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const lakeFragment = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uPressure;
  uniform float uThroat;   // neck radius / lake radius
  uniform float uSpread;   // radial area flux (r² per second, lake units)
  uniform float uBurstAge; // seconds since the last slug burst
  uniform float uWindow;   // 1 when the conduit shows through the neck
  ${noiseGlsl}

  void main() {
    vec2 uv = (vUv - 0.5) * 2.0;
    float r = length(uv);
    if (r > 1.0) discard;
    vec2 dir = r > 1e-4 ? uv / r : vec2(1.0, 0.0);

    // Radial spreading: with no sink at the surface the area swept grows
    // steadily, so s = r² − Q·t is carried with the melt (speed ∝ 1/r).
    float s = r * r - uSpread * uTime;
    vec2 p = dir * 2.6 + vec2(s * 9.0, s * 6.0);
    float flow = noise(p) + 0.5 * noise(p * 2.3 + 7.1);

    // Crust thickens outward from the neck as the melt cools and slows.
    float cool = smoothstep(uThroat, 1.0, r);
    float crackW = mix(0.16, 0.05, cool);
    float crack = 1.0 - smoothstep(crackW * 0.5, crackW, abs(flow - 0.75));
    float warm = (1.0 - cool) * (1.0 - cool);
    float heat = clamp(crack * (1.0 - 0.45 * cool) + warm * 0.6 + uPressure * 0.15, 0.0, 1.0);

    vec3 crust = vec3(0.10, 0.05, 0.05);
    vec3 molten = mix(vec3(0.95, 0.28, 0.05), vec3(1.0, 0.85, 0.35), heat * 0.7);
    vec3 color = mix(crust, molten, heat);

    // A gas slug bursts at the neck and its ring runs out across the lake.
    float ringR = uThroat + uBurstAge * 0.18;
    float ring = exp(-uBurstAge * 0.9) * (1.0 - smoothstep(0.0, 0.05, abs(r - ringR)));
    color += vec3(1.0, 0.75, 0.35) * ring * 1.4;

    // Upwelling dome over the neck: brightest, and see-through when the
    // conduit is drawn below it so you look down the rising column.
    float neck = 1.0 - smoothstep(uThroat * 0.75, uThroat, r);
    color = mix(color, vec3(1.0, 0.82, 0.45), neck * 0.75);
    float alpha = (1.0 - smoothstep(0.94, 1.0, r)) * mix(1.0, 0.3, neck * uWindow);
    gl_FragColor = vec4(color, alpha);
  }
`;

const conduitVertex = /* glsl */ `
  varying vec3 vPos;
  void main() {
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const conduitFragment = /* glsl */ `
  varying vec3 vPos;
  uniform float uTime;
  uniform float uDepth;
  uniform float uWallSpeed;
  uniform float uPressure;
  ${noiseGlsl}

  void main() {
    float d = max(0.0, -vPos.y);
    float depthFrac = clamp(d / uDepth, 0.0, 1.0);
    float ang = atan(vPos.z, vPos.x);
    vec2 dir = vec2(cos(ang), sin(ang));
    // Streaks carried upward along the wall (drag slows the wall layer).
    float y = (d + uWallSpeed * uTime) * 0.06;
    float streak = noise(dir * 3.0 + vec2(y * 1.7, y));
    streak += 0.5 * noise(dir * 7.0 + vec2(y * 4.1, y * 2.3));
    // Hotter with depth: orange near the neck, white-hot at the plume root.
    float hot = smoothstep(0.0, 0.5, depthFrac);
    vec3 col = mix(vec3(0.75, 0.16, 0.03), vec3(1.0, 0.62, 0.2), hot);
    col = mix(col, vec3(1.0, 0.95, 0.8), smoothstep(0.55, 1.0, depthFrac));
    col *= 0.55 + 0.6 * streak + uPressure * 0.25;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function VolcanoLavaPool({ radius, organ }: { radius: number; organ: VolcanoOrgan }) {
  const lakeMat = useRef<THREE.ShaderMaterial>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const headRef = useRef<THREE.Group>(null);
  const gl = useThree((s) => s.gl);
  // Without a stencil buffer the conduit could not be confined to the
  // neck, so it is simply not drawn and the lake stays opaque.
  const hasStencil = useMemo(() => gl.getContextAttributes()?.stencil === true, [gl]);

  const throat = throatRadius(organ);
  const depth = conduitDepth(organ);

  const lakeUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uPressure: { value: 0 },
      uThroat: { value: Math.min(0.9, throat / radius) },
      // Area flux matched to the conduit's mean rise through the neck,
      // in lake units (r² per second), slowed for the eye.
      uSpread: { value: (0.5 * UPWELL_AXIS_SPEED * (throat / radius) ** 2) / 6 },
      uBurstAge: { value: 99 },
      uWindow: { value: hasStencil ? 1 : 0 },
    }),
    [throat, radius, hasStencil],
  );

  const conduit = useMemo(() => {
    const pts = conduitProfile(organ).map(([r, y]) => new THREE.Vector2(r, y));
    const sleeve = new THREE.LatheGeometry(pts, 24);
    // Root faces down so, like the sleeve's inner wall, it is a back face
    // seen from above: each ray through the neck meets exactly one of them,
    // so no depth test is needed between the two.
    const root = new THREE.CircleGeometry(pts[0].x, 24);
    root.rotateX(Math.PI / 2);
    root.translate(0, -depth, 0);
    const neck = new THREE.CircleGeometry(throat, 32);
    neck.rotateX(-Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      vertexShader: conduitVertex,
      fragmentShader: conduitFragment,
      uniforms: {
        uTime: { value: 0 },
        uDepth: { value: depth },
        // Wall layer: Poiseuille speed at ρ = 0.85, held back by drag;
        // drawn six times faster so the climb reads on screen.
        uWallSpeed: { value: upwellSpeedAt(0.85) * 6 },
        uPressure: { value: 0 },
      },
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      stencilWrite: true,
      stencilRef: NECK_STENCIL,
      stencilFunc: THREE.EqualStencilFunc,
      stencilFail: THREE.KeepStencilOp,
      stencilZFail: THREE.KeepStencilOp,
      stencilZPass: THREE.KeepStencilOp,
    });
    const windowMat = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      stencilWrite: true,
      stencilRef: NECK_STENCIL,
      stencilFunc: THREE.AlwaysStencilFunc,
      stencilZPass: THREE.ReplaceStencilOp,
    });
    return { sleeve, root, neck, mat, windowMat };
  }, [organ, depth, throat]);
  useEffect(() => () => {
    conduit.sleeve.dispose();
    conduit.root.dispose();
    conduit.neck.dispose();
    conduit.mat.dispose();
    conduit.windowMat.dispose();
  }, [conduit]);

  useFrame(() => {
    const time = getEarthPoseTime();
    const wrapped = ((time % SHADER_CLOCK_WRAP_S) + SHADER_CLOCK_WRAP_S) % SHADER_CLOCK_WRAP_S;
    const pressure = Math.max(0, Math.min(1, getMantlePressure()));
    const burstAge = slugPhaseAt(time) * STROMBOLIAN_PERIOD_S;
    if (headRef.current) headRef.current.position.y = magmaHeadAt(organ, time);
    if (lakeMat.current) {
      const u = lakeMat.current.uniforms;
      u.uTime.value = wrapped;
      u.uPressure.value = pressure;
      u.uBurstAge.value = burstAge;
    }
    conduit.mat.uniforms.uTime.value = wrapped;
    conduit.mat.uniforms.uPressure.value = pressure;
    if (lightRef.current) {
      lightRef.current.intensity = 6 + pressure * 14 + Math.sin(time * 1.7) * 1.2 + 10 * Math.exp(-burstAge * 1.5);
    }
  });

  return (
    <group>
      <group ref={headRef}>
        {hasStencil && (
          <>
            {/* 1. Neck window: stencil only, after the opaque terrain. */}
            <mesh geometry={conduit.neck} material={conduit.windowMat} renderOrder={10} />
            {/* 2. Conduit and plume root, seen only through the window. */}
            <mesh geometry={conduit.sleeve} material={conduit.mat} renderOrder={11} frustumCulled={false} />
            <mesh geometry={conduit.root} material={conduit.mat} renderOrder={11} frustumCulled={false} />
          </>
        )}
        {/* 3. Lake surface: raised bowl walls occlude its rim through depth. */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={12}>
          <circleGeometry args={[radius, 64]} />
          <shaderMaterial
            ref={lakeMat}
            uniforms={lakeUniforms}
            vertexShader={lakeVertex}
            fragmentShader={lakeFragment}
            transparent
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      </group>
      <pointLight
        ref={lightRef}
        position={[0, 0.3, 0]}
        color="hsl(20, 100%, 58%)"
        intensity={8}
        distance={radius * 12}
        decay={2}
      />
    </group>
  );
}

export default VolcanoLavaPool;
