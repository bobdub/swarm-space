import * as THREE from 'three';

/**
 * Wake ripple rings (see `sea/wake.ts`, `WakeTrail.ripples`). Each patch
 * carries its ring's front radius, fade, wavenumber and crest phase per
 * vertex, so one draw call paints every ring of a boat: bright crests of
 * sin(k·r − φ) that run outward inside the front, falling off as 1/√r.
 */
const vertexShader = /* glsl */ `
  attribute vec2 aOff;
  attribute vec4 aRing;
  varying vec2 vOff;
  varying vec4 vRing;
  void main() {
    vOff = aOff;
    vRing = aRing;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  varying vec2 vOff;
  varying vec4 vRing;
  uniform vec3 uColor;
  void main() {
    float R = vRing.x;
    float d = length(vOff);
    if (d > R) discard;
    // Crests are born behind the front and die at it; the middle, which
    // the energy has left, lies calm.
    float env = (1.0 - smoothstep(R * 0.86, R, d)) * smoothstep(R * 0.25, R * 0.7, d);
    float crest = sin(vRing.z * d - vRing.w);
    float line = smoothstep(0.35, 1.0, crest);
    float a = vRing.y * env * line * 0.5 / sqrt(1.0 + 0.35 * d);
    if (a < 0.003) discard;
    gl_FragColor = vec4(uColor, a);
  }
`;

export function makeRippleMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: { uColor: { value: new THREE.Color('#e8f4ff') } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
