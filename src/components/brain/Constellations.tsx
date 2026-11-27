import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getEarthPose, getEarthPoseTime, WORLD_SCALE } from '@/lib/brain/earth';
import { skyCadenceAt } from '@/lib/brain/skyCadence';
import { CONSTELLATIONS, buildConstellationBuffers, constellationCentre, twinkleTime, type Vec3 } from '@/lib/brain/constellations';
import {
  FIND_CONE_DEG,
  MIN_FIND_ALTITUDE_DEG,
  MIN_FIND_STAR_OPACITY,
  gazeOffsetDeg,
  gazeProgress,
  nightIndexAt,
  stepGaze,
  type GazeState,
} from '@/lib/brain/starHunt';
import { foundTonight, getStarHunt, isIndoors, logFind, setGazeProgress } from '@/lib/brain/starHuntStore';

/** Same shell as the background stars (galaxy.ts puts them at 70–90 units). */
const SKY_RADIUS = 75 * WORLD_SCALE;
/** The hunt checks your gaze five times a second, not every frame. */
const HUNT_STEP_S = 0.2;
const MIN_SIN_ALT = Math.sin(MIN_FIND_ALTITUDE_DEG * Math.PI / 180);

const starVertexShader = /* glsl */ `
  attribute float mag;
  attribute float phase;
  uniform float uTime;
  varying float vMag;
  void main() {
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    // Shared-clock twinkle: uTime is the pose clock folded into one period,
    // so every peer's stars brighten and dim together.
    float twinkle = 0.9 + 0.1 * sin(uTime * 1.7 + phase) * sin(uTime * 0.6 + phase * 2.3);
    vMag = mag * twinkle;
    // Just above the background stars' 1–2.6 px: the figure's stars are the
    // brighter ones in their patch of sky, not beacons. Finding them is the game.
    gl_PointSize = mix(2.6, 4.2, mag) * twinkle;
  }
`;

const starFragmentShader = /* glsl */ `
  uniform float uOpacity;
  uniform vec3 uTint;
  varying float vMag;
  void main() {
    float radius = length(gl_PointCoord - vec2(0.5));
    float core = 1.0 - smoothstep(0.2, 0.5, radius);
    float alpha = core * uOpacity * (0.85 + 0.15 * vMag);
    if (alpha <= 0.001) discard;
    gl_FragColor = vec4(uTint, alpha);
  }
`;

/**
 * The Cat, the Dragon, the Pirate Ship and the Flask, drawn as stars only.
 *
 * One draw call baked once at mount. Each frame follows the camera and
 * writes two uniforms, exactly like StarField: the figures keep fixed
 * celestial directions and Earth turns under them on the shared pose clock,
 * so every peer sees the same sky.
 *
 * The same loop runs the star hunt (`starHunt.ts`) at 5 Hz: once you have
 * read the star charts in the bar tonight, holding your gaze on any figure
 * after dark logs the find (each figure once a night).
 */
export function Constellations() {
  const groupRef = useRef<THREE.Group>(null);
  const buffers = useMemo(() => buildConstellationBuffers(SKY_RADIUS), []);
  const centres = useMemo(() => new Map(CONSTELLATIONS.map((c) => [c.id, constellationCentre(c)])), []);
  const starUniforms = useMemo(() => ({
    uOpacity: { value: 0 },
    uTime: { value: 0 },
    // The background stars' own tint: the figures differ only in strength.
    uTint: { value: new THREE.Color('hsl(220, 80%, 92%)') },
  }), []);
  const hunt = useRef<{ acc: number; gaze: GazeState; target: string | null; forward: THREE.Vector3 }>({
    acc: 0,
    gaze: { held: 0, found: false },
    target: null,
    forward: new THREE.Vector3(),
  });

  useFrame(({ camera }, delta) => {
    const group = groupRef.current;
    if (!group) return;
    group.position.copy(camera.position);
    const pose = getEarthPose();
    const camPos: Vec3 = [camera.position.x, camera.position.y, camera.position.z];
    const starOpacity = skyCadenceAt(camPos, pose).starOpacity;
    group.visible = starOpacity > 0.002;
    if (group.visible) {
      starUniforms.uOpacity.value = starOpacity;
      starUniforms.uTime.value = twinkleTime(getEarthPoseTime());
    }

    // ── Star hunt, 5 Hz ──
    const h = hunt.current;
    h.acc += delta;
    if (h.acc < HUNT_STEP_S) return;
    const dt = Math.min(h.acc, 1);
    h.acc = 0;
    const night = nightIndexAt(getEarthPoseTime());
    if (getStarHunt().chartNight !== night) {
      if (h.gaze.held > 0) { h.gaze = { held: 0, found: false }; h.target = null; setGazeProgress(0); }
      return;
    }
    // Which unfound figure, if any, sits in your gaze right now.
    let target: string | null = null;
    if (starOpacity >= MIN_FIND_STAR_OPACITY && !isIndoors()) {
      const ux = camPos[0] - pose.center[0];
      const uy = camPos[1] - pose.center[1];
      const uz = camPos[2] - pose.center[2];
      const ul = Math.hypot(ux, uy, uz) || 1;
      camera.getWorldDirection(h.forward);
      const fwd: Vec3 = [h.forward.x, h.forward.y, h.forward.z];
      let best = FIND_CONE_DEG;
      for (const [id, centre] of centres) {
        if (foundTonight(id, night)) continue;
        const sinAlt = (centre[0] * ux + centre[1] * uy + centre[2] * uz) / ul;
        if (sinAlt < MIN_SIN_ALT) continue;
        const off = gazeOffsetDeg(fwd, centre);
        if (off <= best) { best = off; target = id; }
      }
    }
    // Moving from one figure to another starts the hold over.
    if (target !== h.target) h.gaze = { held: 0, found: false };
    h.target = target;
    h.gaze = stepGaze(h.gaze, target !== null, dt);
    if (h.gaze.found && target) {
      h.gaze = { held: 0, found: false };
      h.target = null;
      logFind(target, night);
      return;
    }
    setGazeProgress(gazeProgress(h.gaze.held));
  });

  return (
    <group ref={groupRef} visible={false}>
      <points renderOrder={-2} frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[buffers.starPositions, 3]}
            count={buffers.starPositions.length / 3}
            array={buffers.starPositions}
            itemSize={3}
          />
          <bufferAttribute
            attach="attributes-mag"
            args={[buffers.starMags, 1]}
            count={buffers.starMags.length}
            array={buffers.starMags}
            itemSize={1}
          />
          <bufferAttribute
            attach="attributes-phase"
            args={[buffers.starPhases, 1]}
            count={buffers.starPhases.length}
            array={buffers.starPhases}
            itemSize={1}
          />
        </bufferGeometry>
        <shaderMaterial
          vertexShader={starVertexShader}
          fragmentShader={starFragmentShader}
          uniforms={starUniforms}
          transparent
          depthWrite={false}
        />
      </points>
    </group>
  );
}
