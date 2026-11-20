/**
 * DockLayer — the village jetty and the boat moored alongside it.
 *
 * The whole layer lives in Earth-local coordinates: one group follows the
 * planet's centre and spin each frame, and everything inside it is placed
 * once from `getVillageDockSite()`. The jetty planks are registered as a
 * deck surface on mount, so walkers stand on them through the same
 * `supportElevationAt` the physics floor, avatar feet and camera use.
 *
 * The boat floats by `sea/vessel.ts` and its deck is walkable
 * (`sea/villageBoat.ts`): the drawn hull and the deck you stand on read
 * the same waterline every frame. She sails under the weather field's
 * wind (`sea/vessel.ts`), so the mesh is placed from the boat's live
 * position and heading each frame (docs/project-plans/village-boat-plan.md).
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { EARTH_RADIUS, getEarthPose, getEarthPoseTime, type Vec3 } from '@/lib/brain/earth';
import { groundElevationAt } from '@/lib/brain/groundHeight';
import {
  JETTY_TOP,
  JETTY_WIDTH,
  getVillageDockSite,
  starboardOf,
  travel,
  travelTangent,
  type DockSite,
} from '@/lib/brain/sea/dockSite';
import { registerDeckSurface, straightDeck } from '@/lib/brain/sea/deckSupport';
import { getVillageBoat, swellTiltAt } from '@/lib/brain/sea/vessel';
import { mountVillageBoat } from '@/lib/brain/sea/villageBoat';
import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';
import { windAt } from '@/lib/world/weather';
import { BoatMesh } from './BoatMesh';

const PLANK = '#8a6640';
const PILE = '#4a3420';
const SEGMENT_M = 3;
const PLANK_T = 0.18;

/** World-from-local rotation for a frame with `up` and `forward` (−Z). */
function frameQuat(up: Vec3, forward: Vec3): THREE.Quaternion {
  const u = new THREE.Vector3(...up).normalize();
  const f = new THREE.Vector3(...forward).normalize();
  const r = new THREE.Vector3().crossVectors(f, u).normalize(); // right = forward × up
  const back = f.clone().negate();
  const m = new THREE.Matrix4().makeBasis(r, u, back);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

function at(n: Vec3, elevation: number): THREE.Vector3 {
  const r = EARTH_RADIUS + elevation;
  return new THREE.Vector3(n[0] * r, n[1] * r, n[2] * r);
}

interface JettyPiece {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
}

interface Pile {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  height: number;
}

function buildJetty(site: DockSite): { planks: JettyPiece[]; piles: Pile[] } {
  const planks: JettyPiece[] = [];
  const piles: Pile[] = [];
  const count = Math.max(1, Math.ceil(site.jettyLength / SEGMENT_M));
  const step = site.jettyLength / count;
  for (let i = 0; i < count; i++) {
    const mid = (i + 0.5) * step;
    const n = travel(site.jettyStart, site.jettyDir, mid);
    const t = travelTangent(site.jettyStart, site.jettyDir, mid);
    planks.push({
      position: at(n, JETTY_TOP - PLANK_T / 2),
      quaternion: frameQuat(n, t),
      length: step + 0.02,
    });
  }
  for (let i = 0; i <= count; i++) {
    const along = i * step;
    const n = travel(site.jettyStart, site.jettyDir, along);
    const t = travelTangent(site.jettyStart, site.jettyDir, along);
    const side = starboardOf(n, t);
    for (const s of [1, -1]) {
      const pn = travel(n, side, (s * (JETTY_WIDTH / 2 - 0.12)));
      const floor = groundElevationAt(pn);
      const top = JETTY_TOP + 0.35; // posts stand a little proud of the planks
      if (floor >= JETTY_TOP - 0.05) continue; // on dry land: no pile needed
      const height = top - floor;
      piles.push({ position: at(pn, floor + height / 2), quaternion: frameQuat(pn, t), height });
    }
  }
  return { planks, piles };
}

export function DockLayer() {
  const site = useMemo(() => getVillageDockSite(), []);
  const earthRef = useRef<THREE.Group>(null);
  const boatRef = useRef<THREE.Group>(null);

  // The jetty planks are walkable ground.
  useEffect(() => {
    if (!site) return;
    return registerDeckSurface(
      straightDeck({
        id: 'village-jetty',
        start: site.jettyStart,
        dir: site.jettyDir,
        length: site.jettyLength,
        width: JETTY_WIDTH,
        top: JETTY_TOP,
        radius: EARTH_RADIUS,
      }),
    );
  }, [site]);

  // The boat's deck is walkable and its float steps with the physics.
  useEffect(() => {
    if (!site) return;
    // Wind is the weather field's own: the vector the clouds ride.
    return mountVillageBoat(getBrainPhysics(), { wind: (n) => windAt(n) });
  }, [site]);

  const jetty = useMemo(() => (site ? buildJetty(site) : null), [site]);

  const tmpQ = useMemo(() => new THREE.Quaternion(), []);
  const tmpE = useMemo(() => new THREE.Euler(), []);
  useFrame(() => {
    const pose = getEarthPose();
    if (earthRef.current) {
      earthRef.current.position.set(pose.center[0], pose.center[1], pose.center[2]);
      earthRef.current.quaternion.set(pose.spinQuat[0], pose.spinQuat[1], pose.spinQuat[2], pose.spinQuat[3]);
    }
    if (boatRef.current && site) {
      // Swell on the shared clock plus sinkage under load: the same
      // waterline the walkable deck reads, so feet stay on the planks.
      const t = getEarthPoseTime();
      const boat = getVillageBoat();
      const { roll, pitch } = swellTiltAt(t, boat.phase);
      const { n, heading } = boat.motion;
      boatRef.current.position.copy(at(n, boat.waterlineAt(t)));
      tmpE.set(pitch, 0, roll);
      tmpQ.setFromEuler(tmpE);
      boatRef.current.quaternion.copy(frameQuat(n, heading)).multiply(tmpQ);
    }
  });

  if (!site || !jetty) return null;
  return (
    <group ref={earthRef}>
      {jetty.planks.map((p, i) => (
        <mesh key={`plank-${i}`} position={p.position} quaternion={p.quaternion} receiveShadow castShadow>
          <boxGeometry args={[JETTY_WIDTH, PLANK_T, p.length]} />
          <meshStandardMaterial color={PLANK} roughness={0.92} />
        </mesh>
      ))}
      {jetty.piles.map((p, i) => (
        <mesh key={`pile-${i}`} position={p.position} quaternion={p.quaternion}>
          <cylinderGeometry args={[0.11, 0.13, p.height, 8]} />
          <meshStandardMaterial color={PILE} roughness={0.95} />
        </mesh>
      ))}
      <group ref={boatRef}>
        <BoatMesh />
      </group>
    </group>
  );
}

export default DockLayer;
