import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ATMOSPHERE_RADIUS, EARTH_RADIUS, getEarthPose, SUN_POSITION } from '@/lib/brain/earth';

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

  void main() {
    vec3 radialUp = normalize(cameraPosition - uPlanetCenter);
    vec3 shellDir = normalize(vWorldPos - uPlanetCenter);
    vec3 sunDir = normalize(uSunPos - uPlanetCenter);

    float elevation = dot(shellDir, radialUp);
    float aboveHorizon = smoothstep(-0.2, 0.08, elevation);
    float zenith = smoothstep(0.0, 0.98, elevation);
    float horizonBand = 1.0 - smoothstep(-0.02, 0.34, elevation);
    float sunGlow = pow(max(dot(shellDir, sunDir), 0.0), 22.0);
    float sunHalo = pow(max(dot(shellDir, sunDir), 0.0), 3.5);

    vec3 horizonColor = mix(vec3(0.05, 0.08, 0.16), vec3(0.48, 0.68, 0.98), 1.0 - uSpaceMix);
    vec3 zenithColor = mix(vec3(0.01, 0.02, 0.05), vec3(0.14, 0.34, 0.82), 1.0 - uSpaceMix * 0.9);
    vec3 warmColor = vec3(0.98, 0.72, 0.36);

    vec3 color = mix(horizonColor, zenithColor, pow(zenith, 0.7));
    color += warmColor * horizonBand * 0.12 * (1.0 - uSpaceMix);
    color += warmColor * sunHalo * 0.16 * (1.0 - uSpaceMix * 0.8);
    color += vec3(1.0, 0.92, 0.78) * sunGlow * 0.5 * (1.0 - uSpaceMix * 0.65);

    float alpha = aboveHorizon * mix(0.92, 0.12, uSpaceMix);
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
      materialRef.current.uniforms.uSunPos.value.set(SUN_POSITION[0], SUN_POSITION[1], SUN_POSITION[2]);
      const altitude = Math.max(0, camera.position.distanceTo(materialRef.current.uniforms.uPlanetCenter.value) - EARTH_RADIUS);
      const atmosphereThickness = Math.max(1, ATMOSPHERE_RADIUS - EARTH_RADIUS);
      materialRef.current.uniforms.uSpaceMix.value = Math.min(1, altitude / atmosphereThickness);
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