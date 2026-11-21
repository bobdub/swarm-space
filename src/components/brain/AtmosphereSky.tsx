import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ATMOSPHERE_RADIUS, getEarthPose, SUN_POSITION } from '@/lib/brain/earth';
import { COSMO_COMPOUNDS, hexToRgb01 } from '@/lib/brain/cosmoChemistry';
import { skyCadenceAt } from '@/lib/brain/skyCadence';

const vertexShader = /* glsl */ `
  varying vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vWorldPos;
  uniform vec3 uPlanetCenter;
  uniform vec3 uSunPos;
  uniform float uSpaceMix;
  uniform vec3 uAtmosTint;
  uniform float uDaylight;
  uniform float uTwilight;
  uniform float uAtmosOpacity;

  void main() {
    vec3 radialUp = normalize(cameraPosition - uPlanetCenter);
    vec3 shellDir = normalize(vWorldPos - cameraPosition);
    vec3 sunDir = normalize(uSunPos - cameraPosition);

    float elevation = dot(shellDir, radialUp);
    float aboveHorizon = smoothstep(-0.2, 0.08, elevation);
    float zenith = smoothstep(0.0, 0.98, elevation);
    float horizonBand = 1.0 - smoothstep(-0.02, 0.34, elevation);
    float sunGlow = pow(max(dot(shellDir, sunDir), 0.0), 22.0);
    float sunHalo = pow(max(dot(shellDir, sunDir), 0.0), 3.5);

    // Day-side sky tint is the N₂/O₂/Ar/CO₂ blend from cosmoChemistry —
    // literal compound colour, not a hand-picked blue. Mixed toward the
    // black of space as altitude rises.
    vec3 dayHorizon = uAtmosTint * 1.05;
    vec3 dayZenith  = uAtmosTint * 0.55;
    vec3 horizonColor = mix(vec3(0.05, 0.08, 0.16), dayHorizon, uDaylight * (1.0 - uSpaceMix));
    vec3 zenithColor = mix(vec3(0.01, 0.02, 0.05), dayZenith, uDaylight * (1.0 - uSpaceMix));
    vec3 warmColor = vec3(0.98, 0.72, 0.36);

    vec3 color = mix(horizonColor, zenithColor, pow(zenith, 0.7));
    // Sunset stays in the Sun-facing horizon, not an orange ring at midnight.
    color = mix(color, warmColor, horizonBand * sunHalo * uTwilight * 0.7 * (1.0 - uSpaceMix));
    color += warmColor * sunHalo * 0.16 * uDaylight * (1.0 - uSpaceMix);
    color += vec3(1.0, 0.92, 0.78) * sunGlow * 0.5 * uDaylight * (1.0 - uSpaceMix);

    float alpha = aboveHorizon * uAtmosOpacity;
    if (alpha <= 0.001) discard;
    gl_FragColor = vec4(color, alpha);
  }
`;

export function AtmosphereSky() {
  const ref = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      uPlanetCenter: { value: new THREE.Vector3() },
      uSunPos: { value: new THREE.Vector3(...SUN_POSITION) },
      uSpaceMix: { value: 0 },
      uDaylight: { value: 1 },
      uTwilight: { value: 0 },
      uAtmosOpacity: { value: 0.92 },
      uAtmosTint: {
        value: new THREE.Vector3(...hexToRgb01(COSMO_COMPOUNDS.atmosphere.color)),
      },
    }),
    [],
  );

  useFrame(({ camera }) => {
    const pose = getEarthPose();
    if (ref.current) {
      ref.current.position.set(pose.center[0], pose.center[1], pose.center[2]);
    }
    if (materialRef.current) {
      materialRef.current.uniforms.uPlanetCenter.value.set(pose.center[0], pose.center[1], pose.center[2]);
      materialRef.current.uniforms.uSunPos.value.set(pose.sun[0], pose.sun[1], pose.sun[2]);
      const sky = skyCadenceAt([camera.position.x, camera.position.y, camera.position.z], pose);
      materialRef.current.uniforms.uSpaceMix.value = sky.spaceMix;
      materialRef.current.uniforms.uDaylight.value = sky.daylight;
      materialRef.current.uniforms.uTwilight.value = sky.twilight;
      materialRef.current.uniforms.uAtmosOpacity.value = sky.atmosphereOpacity;
    }
  });

  return (
    <mesh ref={ref} renderOrder={-1}>
      <sphereGeometry args={[ATMOSPHERE_RADIUS * 1.02, 48, 32]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
        side={THREE.BackSide}
        transparent
        depthWrite={false}
      />
    </mesh>
  );
}