/**
 * ChickenLayer — free-range hens wandering the land.
 *
 * Where each hen is comes from `land/chickens.ts` on the shared clock, so
 * every peer sees the same hen in the same place. A caught hen is hidden
 * on every peer until she respawns (the catch travels as a nature event).
 * This layer only draws the hens near the viewer, as a handful of
 * instanced meshes (body, tail, head, comb, beak, legs).
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EARTH_RADIUS, getEarthPose, getEarthPoseTime, worldPosToLocalNormal, type Vec3 } from '@/lib/brain/earth';
import { groundElevationAt } from '@/lib/brain/groundHeight';
import { arcMetres } from '@/lib/brain/sea/seaLife';
import { getHens, henPoseAt, hensNear, isHenAway, type Hen } from '@/lib/brain/land/chickens';

/** Draw distance (m) and most hens drawn at once. */
const VIEW_M = 90;
const MAX_HENS = 64;
/** Seconds between re-picking which hens are near. */
const PICK_EVERY_S = 1;

const PLUMAGE = ['#f3efe6', '#9a5a2c', '#2b2622', '#a7a39b'].map((c) => new THREE.Color(c));

/** World-from-local rotation for a frame with `up` and `forward` (−Z). */
function frameQuat(up: Vec3, forward: Vec3, out: THREE.Quaternion): THREE.Quaternion {
  const u = new THREE.Vector3(up[0], up[1], up[2]).normalize();
  const f = new THREE.Vector3(forward[0], forward[1], forward[2]).normalize();
  const r = new THREE.Vector3().crossVectors(f, u).normalize();
  const m = new THREE.Matrix4().makeBasis(r, u, f.negate());
  return out.setFromRotationMatrix(m);
}

function henGeometries() {
  // A hen about 0.45 m tall, nose to −Z, feet at y = 0.
  const body = new THREE.SphereGeometry(1, 12, 9);
  body.scale(0.15, 0.14, 0.2);
  body.translate(0, 0.25, 0.02);
  const tail = new THREE.ConeGeometry(0.09, 0.2, 6);
  tail.rotateX(-0.6);
  tail.translate(0, 0.37, 0.17);
  // Head parts are built round the neck pivot, which sits at the origin.
  const head = new THREE.SphereGeometry(0.068, 10, 8);
  head.translate(0, 0.1, -0.05);
  const comb = new THREE.BoxGeometry(0.018, 0.05, 0.07);
  comb.translate(0, 0.175, -0.05);
  const beak = new THREE.ConeGeometry(0.022, 0.06, 5);
  beak.rotateX(-Math.PI / 2);
  beak.translate(0, 0.095, -0.135);
  const leg = new THREE.CylinderGeometry(0.012, 0.012, 0.16, 5);
  leg.translate(0, -0.08, 0); // hangs from the hip at the origin
  return { body, tail, head, comb, beak, leg };
}

/** Neck pivot and hip positions in the hen's frame. */
const NECK: [number, number, number] = [0, 0.33, -0.14];
const HIP_Y = 0.16;
const HIP_X = 0.055;

export function ChickenLayer() {
  const { camera } = useThree();
  const earthRef = useRef<THREE.Group>(null);
  const geo = useMemo(henGeometries, []);
  const meshes = useMemo(() => {
    const make = (g: THREE.BufferGeometry, mat: THREE.Material, count: number, colored: boolean) => {
      const m = new THREE.InstancedMesh(g, mat, count);
      if (colored) m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      return m;
    };
    return {
      body: make(geo.body, new THREE.MeshStandardMaterial({ roughness: 0.9 }), MAX_HENS, true),
      tail: make(geo.tail, new THREE.MeshStandardMaterial({ roughness: 0.9 }), MAX_HENS, true),
      head: make(geo.head, new THREE.MeshStandardMaterial({ roughness: 0.85 }), MAX_HENS, true),
      comb: make(geo.comb, new THREE.MeshStandardMaterial({ color: '#d1271f', roughness: 0.7 }), MAX_HENS, false),
      beak: make(geo.beak, new THREE.MeshStandardMaterial({ color: '#e8a623', roughness: 0.6 }), MAX_HENS, false),
      legs: make(geo.leg, new THREE.MeshStandardMaterial({ color: '#d99a2b', roughness: 0.7 }), MAX_HENS * 2, false),
    };
  }, [geo]);
  useEffect(() => () => {
    for (const m of Object.values(meshes)) {
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
      m.dispose();
    }
  }, [meshes]);

  // Seeding every flock takes a moment (terrain checks), so do it when the
  // browser is idle rather than in the first frame.
  const ready = useRef(false);
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const run = () => { getHens(); ready.current = true; };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(run, { timeout: 3000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(run, 500);
    return () => window.clearTimeout(id);
  }, []);

  const near = useRef<{ at: number; hens: Hen[] }>({ at: -Infinity, hens: [] });
  const tmp = useMemo(() => ({
    q: new THREE.Quaternion(),
    q2: new THREE.Quaternion(),
    p: new THREE.Vector3(),
    one: new THREE.Vector3(1, 1, 1),
    s: new THREE.Vector3(),
    frame: new THREE.Matrix4(),
    local: new THREE.Matrix4(),
    m: new THREE.Matrix4(),
    xAxis: new THREE.Vector3(1, 0, 0),
  }), []);

  useFrame(() => {
    const pose = getEarthPose();
    const earth = earthRef.current;
    if (earth) {
      earth.position.set(pose.center[0], pose.center[1], pose.center[2]);
      earth.quaternion.set(pose.spinQuat[0], pose.spinQuat[1], pose.spinQuat[2], pose.spinQuat[3]);
    }
    const t = getEarthPoseTime();
    const now = performance.now() / 1000;
    const wall = Date.now();
    const viewN = worldPosToLocalNormal([camera.position.x, camera.position.y, camera.position.z], pose);

    const nr = near.current;
    if (ready.current && now - nr.at > PICK_EVERY_S) {
      nr.at = now;
      nr.hens = hensNear(viewN, VIEW_M);
    }

    let k = 0;
    for (const h of nr.hens) {
      if (k >= MAX_HENS) break;
      if (isHenAway(h.id, wall)) continue;
      const hp = henPoseAt(h, t);
      if (arcMetres(viewN, hp.n) > VIEW_M) continue;
      const ground = groundElevationAt(hp.n);
      const col = PLUMAGE[h.plumage] ?? PLUMAGE[0];

      // Walking: a little bob, legs swinging, head jerking forward.
      // Pecking: head dips to the ground a few times.
      const stride = hp.pecking ? 0 : Math.sin(hp.phase * Math.PI * 2 * 9);
      const bob = hp.pecking ? 0 : 0.012 * Math.abs(stride);
      tmp.p.set(hp.n[0], hp.n[1], hp.n[2]).multiplyScalar(EARTH_RADIUS + ground + bob);
      frameQuat(hp.n, hp.heading, tmp.q);
      tmp.frame.compose(tmp.p, tmp.q, tmp.s.set(h.scale, h.scale, h.scale));

      meshes.body.setMatrixAt(k, tmp.frame);
      meshes.tail.setMatrixAt(k, tmp.frame);
      meshes.body.setColorAt(k, col);
      meshes.tail.setColorAt(k, col);

      const peck = hp.pecking ? Math.max(0, Math.sin(hp.phase * Math.PI * 2 * 3)) : 0;
      const pitch = -1.15 * peck;
      const jut = hp.pecking ? 0.03 * peck : 0.025 * stride;
      tmp.q2.setFromAxisAngle(tmp.xAxis, -pitch);
      tmp.local.compose(tmp.p.set(NECK[0], NECK[1] - 0.03 * peck, NECK[2] - jut), tmp.q2, tmp.one);
      tmp.m.multiplyMatrices(tmp.frame, tmp.local);
      meshes.head.setMatrixAt(k, tmp.m);
      meshes.head.setColorAt(k, col);
      meshes.comb.setMatrixAt(k, tmp.m);
      meshes.beak.setMatrixAt(k, tmp.m);

      for (let side = 0; side < 2; side++) {
        const swing = (side === 0 ? 1 : -1) * 0.45 * stride;
        tmp.q2.setFromAxisAngle(tmp.xAxis, swing);
        tmp.local.compose(tmp.p.set(side === 0 ? -HIP_X : HIP_X, HIP_Y, 0.02), tmp.q2, tmp.one);
        tmp.m.multiplyMatrices(tmp.frame, tmp.local);
        meshes.legs.setMatrixAt(k * 2 + side, tmp.m);
      }
      k++;
    }
    for (const key of ['body', 'tail', 'head', 'comb', 'beak'] as const) {
      const m = meshes[key];
      m.count = k;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    meshes.legs.count = k * 2;
    meshes.legs.instanceMatrix.needsUpdate = true;
  });

  return (
    <group ref={earthRef}>
      {Object.entries(meshes).map(([key, m]) => (
        <primitive key={key} object={m} />
      ))}
    </group>
  );
}

export default ChickenLayer;
