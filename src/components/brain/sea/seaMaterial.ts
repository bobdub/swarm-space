import * as THREE from 'three';
import { SEA_SWELL_GLSL, SEA_TIDE_GLSL } from '@/lib/brain/sea/seaSurface';

/** Visual slope gain on the swell normals: real 10 cm swells barely tilt
 *  the surface, so the glints are drawn a few times steeper than the
 *  heights (heights, and the tide, are drawn true). */
const SWELL_SLOPE_GAIN = 4;

/**
 * The see-through sea: Phong (so the scene's Sun, Moon light and sky fill
 * light it and its highlights glint off both), with the shared tide lifting
 * its vertices and the swell tilting its normals. Everything comes from
 * `sea/seaSurface.ts` on the shared clock, so every peer sees one sea and
 * swimmers and hulls float on the same tide the water is drawn at.
 */
export function makeSeaMaterial(color: THREE.Color) {
  const uniforms = {
    uTideMoon: { value: new THREE.Vector3(0, 1, 0) },
    uTideSun: { value: new THREE.Vector3(1, 0, 0) },
    uSwellPhase: { value: new THREE.Vector3() },
    uSea: { value: 1 },
    uSlopeGain: { value: SWELL_SLOPE_GAIN },
  };
  const mat = new THREE.MeshPhongMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.25,
    transparent: true,
    opacity: 0.6,
    shininess: 80,
    depthWrite: false,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        ${SEA_TIDE_GLSL}
        varying vec3 vSeaLocal;
        varying float vSeaDist;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vSeaLocal = position;
        transformed += normalize(position) * seaTide(normalize(position));`)
      .replace('#include <project_vertex>', `#include <project_vertex>
        vSeaDist = length((modelMatrix * vec4(transformed, 1.0)).xyz - cameraPosition);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${SEA_SWELL_GLSL}
        uniform float uSlopeGain;
        uniform mat3 normalMatrix;
        varying vec3 vSeaLocal;
        varying float vSeaDist;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 seaN = normalize(vSeaLocal);
          vec3 seaG = seaSwellSlope(seaN, vSeaDist) * uSlopeGain;
          normal = normalize(normalMatrix * normalize(seaN - seaG));
        }`);
  };
  return { mat, uniforms };
}
