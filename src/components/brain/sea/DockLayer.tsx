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

import { useEffect, useMemo, useRef, useState } from 'react';
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
import { frameOf, getFleet, type FleetBoat } from '@/lib/brain/sea/fleet';
import { getCrewBoatKey, stopMastHold } from '@/lib/brain/sea/crew';
import { mountVillageBoat } from '@/lib/brain/sea/villageBoat';
import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';
import { weatherCurvatureBoost, windAt } from '@/lib/world/weather';
import {
  RIPPLE_INDICES,
  RIPPLE_VERTS,
  WAKE_MAX_POINTS,
  WakeTrail,
  rippleIndices,
} from '@/lib/brain/sea/wake';
import { makeRippleMaterial } from './rippleMaterial';
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
    return mountVillageBoat(getBrainPhysics(), { wind: (n) => windAt(n), sea: (n) => weatherCurvatureBoost(n) });
  }, [site]);

  const jetty = useMemo(() => (site ? buildJetty(site) : null), [site]);

  useFrame(() => {
    const pose = getEarthPose();
    if (earthRef.current) {
      earthRef.current.position.set(pose.center[0], pose.center[1], pose.center[2]);
      earthRef.current.quaternion.set(pose.spinQuat[0], pose.spinQuat[1], pose.spinQuat[2], pose.spinQuat[3]);
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
      <FleetBoats />
    </group>
  );
}

/** Every boat in this world: the dock boat, yours, everyone else's. */
function FleetBoats() {
  const fleet = getFleet();
  const [boats, setBoats] = useState<FleetBoat[]>(() => fleet.list());
  useEffect(() => fleet.subscribe(() => setBoats(fleet.list())), [fleet]);
  return (
    <>
      {boats.map((b) => (
        <BoatView key={b.key} boat={b} />
      ))}
    </>
  );
}

function BoatView({ boat }: { boat: FleetBoat }) {
  const ref = useRef<THREE.Group>(null);
  const tmpQ = useMemo(() => new THREE.Quaternion(), []);
  const tmpE = useMemo(() => new THREE.Euler(), []);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    g.visible = boat.visible;
    if (!boat.visible) return;
    // Swell on the shared clock plus sinkage under load: the same
    // waterline the walkable deck reads, so feet stay on the planks.
    const t = getEarthPoseTime();
    const v = boat.vessel;
    const { roll, pitch } = v.tiltAt(t);
    const { n, heading } = v.motion;
    g.position.copy(at(n, v.waterlineAt(t)));
    tmpE.set(pitch, 0, roll);
    tmpQ.setFromEuler(tmpE);
    g.quaternion.copy(frameQuat(n, heading)).multiply(tmpQ);
  });
  // Releasing the mast anywhere ends a hold begun on it.
  useEffect(() => () => { if (getCrewBoatKey() === boat.key) stopMastHold(); }, [boat.key]);
  return (
    <>
      <group ref={ref}>
        <BoatMesh vessel={boat.vessel} boatKey={boat.key} />
      </group>
      <BoatWake boat={boat} />
    </>
  );
}

/** The trail on the water behind a moving boat, and the rings of ripples
 *  spreading from her bow into a Kelvin V (drawn in Earth-local space). */
function BoatWake({ boat }: { boat: FleetBoat }) {
  const trail = useMemo(() => new WakeTrail(), []);
  const { geo, pos, alpha, rgba } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(WAKE_MAX_POINTS * 2 * 3);
    const a = new Float32Array(WAKE_MAX_POINTS * 2);
    const c = new Float32Array(WAKE_MAX_POINTS * 2 * 4).fill(1);
    const idx: number[] = [];
    for (let i = 0; i < WAKE_MAX_POINTS - 1; i++) {
      const v = 2 * i;
      idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
    }
    g.setIndex(idx);
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('color', new THREE.BufferAttribute(c, 4));
    g.setDrawRange(0, 0);
    return { geo: g, pos: p, alpha: a, rgba: c };
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  const ripples = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(WAKE_MAX_POINTS * RIPPLE_VERTS * 3);
    const o = new Float32Array(WAKE_MAX_POINTS * RIPPLE_VERTS * 2);
    const r = new Float32Array(WAKE_MAX_POINTS * RIPPLE_VERTS * 4);
    g.setIndex(rippleIndices(WAKE_MAX_POINTS));
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('aOff', new THREE.BufferAttribute(o, 2));
    g.setAttribute('aRing', new THREE.BufferAttribute(r, 4));
    g.setDrawRange(0, 0);
    return { geo: g, pos: p, off: o, ring: r, mat: makeRippleMaterial() };
  }, []);
  useEffect(() => () => { ripples.geo.dispose(); ripples.mat.dispose(); }, [ripples]);
  const meshRef = useRef<THREE.Mesh>(null);
  const rippleRef = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const t = getEarthPoseTime();
    if (boat.visible) trail.sample(frameOf(boat), boat.vessel.speed(), t, EARTH_RADIUS);
    // Ripples sit just under the ribbon so the foam reads on top.
    const rk = trail.ripples(t, EARTH_RADIUS, 0.05, ripples.pos, ripples.off, ripples.ring);
    ripples.geo.setDrawRange(0, rk * RIPPLE_INDICES);
    if (rk > 0) {
      (ripples.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      (ripples.geo.attributes.aOff as THREE.BufferAttribute).needsUpdate = true;
      (ripples.geo.attributes.aRing as THREE.BufferAttribute).needsUpdate = true;
    }
    if (rippleRef.current) rippleRef.current.visible = rk > 0;
    const k = trail.ribbon(t, EARTH_RADIUS, 0.06, pos, alpha);
    for (let i = 0; i < 2 * k; i++) rgba[i * 4 + 3] = alpha[i];
    geo.setDrawRange(0, Math.max(0, k - 1) * 6);
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    if (k > 1) geo.computeBoundingSphere();
    if (meshRef.current) meshRef.current.visible = k > 1;
  });
  return (
    <>
      <mesh ref={rippleRef} geometry={ripples.geo} material={ripples.mat} frustumCulled={false} renderOrder={2} visible={false} />
      <mesh ref={meshRef} geometry={geo} frustumCulled={false} renderOrder={3}>
        <meshBasicMaterial vertexColors transparent depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
    </>
  );
}

export default DockLayer;
