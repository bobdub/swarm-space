/**
 * SeaLifeLayer — schools of fish and sharks swimming in the open sea.
 *
 * Where each creature is comes from `sea/seaLife.ts` on the shared clock,
 * so every peer sees the same fish in the same place. This layer only
 * draws the ones near the viewer: fish as one instanced mesh (body and
 * tail), sharks from a small pool of meshes with the dorsal fin cutting
 * the surface.
 *
 * Sharks (`sea/sharks.ts`): a swimmer who comes within 12 m gets a
 * warning; within 3 m the shark bites once (−2 Food and a shove) and then
 * dives away for a while. A knifed shark dives away too. A caught shark is
 * gone from the sea for everyone for ten minutes.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { createTierGate, renderGovernor } from '@/lib/brain/renderGovernor';
import { toast } from 'sonner';
import {
  BODY_CENTER_HEIGHT,
  EARTH_RADIUS,
  getEarthPose,
  getEarthPoseTime,
  quatRotate,
  worldPosToLocalNormal,
  type Vec3,
} from '@/lib/brain/earth';
import { isSwimmingAt } from '@/lib/brain/groundHeight';
import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';
import { teleportBody } from '@/lib/pub/seating';
import { materialTotals, spendMaterials } from '@/lib/world/materials';
import {
  SHARK_BITE_FOOD,
  sharkDiveAt,
  sharkGone,
  threateningShark,
  trySharkBite,
} from '@/lib/brain/sea/sharks';
import {
  SHARK_WARN_M,
  arcMetres,
  getSeaLife,
  seaLifeNear,
  seaPoseAt,
  type SeaCreature,
} from '@/lib/brain/sea/seaLife';

/** Draw distances (m). */
const FISH_VIEW_M = 160;
const SHARK_VIEW_M = 260;
/** Most fish and sharks drawn at once. */
const MAX_FISH = 360;
const MAX_SHARKS = 8;
/** Seconds between re-picking which creatures are near. */
const PICK_EVERY_S = 1;
/** Seconds between warnings for the same swimmer. */
const WARN_COOLDOWN_S = 20;

const FISH_COLORS = ['#c9d6e3', '#f2b233', '#3fb8af', '#f07b3f', '#9ad1f5', '#e6e1c5'];
const SHARK_COLOR = '#6b7783';
const SHARK_BELLY = '#c9cfd4';

/** World-from-local rotation for a frame with `up` and `forward` (−Z). */
function frameQuat(up: Vec3, forward: Vec3, out: THREE.Quaternion): THREE.Quaternion {
  const u = new THREE.Vector3(up[0], up[1], up[2]).normalize();
  const f = new THREE.Vector3(forward[0], forward[1], forward[2]).normalize();
  const r = new THREE.Vector3().crossVectors(f, u).normalize();
  const m = new THREE.Matrix4().makeBasis(r, u, f.negate());
  return out.setFromRotationMatrix(m);
}

/** Small deterministic PRNG, so every peer spreads a school the same way. */
function rand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface FishSlot {
  x: number;
  y: number;
  z: number;
  phase: number;
  scale: number;
  color: THREE.Color;
}

const schoolLayout = new Map<string, FishSlot[]>();

/** Where each fish swims inside its school (boat-like frame: x right, z aft). */
function layoutOf(c: SeaCreature): FishSlot[] {
  let l = schoolLayout.get(c.id);
  if (l) return l;
  const r = rand(c.seed);
  const base = FISH_COLORS[Math.floor(r() * FISH_COLORS.length)];
  l = [];
  for (let i = 0; i < c.size; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * 2.4;
    const col = new THREE.Color(base).offsetHSL((r() - 0.5) * 0.04, 0, (r() - 0.5) * 0.12);
    l.push({ x: Math.cos(a) * d, y: (r() - 0.5) * 0.5, z: Math.sin(a) * d * 1.4, phase: r() * Math.PI * 2, scale: 0.8 + 0.45 * r(), color: col });
  }
  schoolLayout.set(c.id, l);
  return l;
}

/** One fish per school leaps clear of the water now and then. */
const LEAP_EVERY_S = 19;
const LEAP_S = 1.1;
const LEAP_H = 0.7;

function leapAt(c: SeaCreature, t: number): number {
  const period = LEAP_EVERY_S + (c.seed % 7);
  const k = (t + (c.seed % 1000)) % period;
  if (k > LEAP_S) return -1;
  return k / LEAP_S;
}

function fishGeometries(): { body: THREE.BufferGeometry; tail: THREE.BufferGeometry } {
  // A slim fish about 0.45 m long, nose to −Z like everything else here.
  const body = new THREE.SphereGeometry(1, 10, 8);
  body.scale(0.075, 0.1, 0.22);
  const tail = new THREE.ConeGeometry(0.09, 0.16, 4);
  tail.rotateX(-Math.PI / 2); // point the tip forward, the fan aft
  tail.scale(0.35, 1.2, 1);
  tail.translate(0, 0, 0.27);
  return { body, tail };
}

function triangleFins(tris: number[][]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris.flat()), 3));
  g.computeVertexNormals();
  return g;
}

function sharkGeometries(): { body: THREE.BufferGeometry; fins: THREE.BufferGeometry; tail: THREE.BufferGeometry } {
  // About 2.8 m nose to tail, body centre at the origin.
  const body = new THREE.SphereGeometry(1, 16, 10);
  body.scale(0.32, 0.36, 1.35);
  const fins = triangleFins([
    // dorsal fin: swept back, tall enough to break the surface
    [0, 0.3, -0.35], [0, 0.3, 0.25], [0, 0.98, 0.32],
    // pectoral fins
    [-0.25, -0.12, -0.35], [-0.25, -0.12, 0.05], [-0.85, -0.3, 0.2],
    [0.25, -0.12, -0.35], [0.85, -0.3, 0.2], [0.25, -0.12, 0.05],
  ]);
  const tail = triangleFins([
    // tall upper lobe, short lower lobe; pivots at the tail root (z = 0)
    [0, 0.05, 0], [0, 0.7, 0.55], [0, 0.15, 0.25],
    [0, -0.05, 0], [0, 0.05, 0.2], [0, -0.42, 0.42],
  ]);
  return { body, fins, tail };
}

export function SeaLifeLayer({ selfId }: { selfId: string }) {
  const { camera } = useThree();
  const earthRef = useRef<THREE.Group>(null);
  const sharkRefs = useRef<(THREE.Group | null)[]>([]);
  const sharkTailRefs = useRef<(THREE.Group | null)[]>([]);
  const fish = useMemo(fishGeometries, []);
  const shark = useMemo(sharkGeometries, []);
  // Instance colours exist from the start, so the material compiles with
  // per-fish colour on its first frame.
  const fishMeshes = useMemo(() => {
    const make = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
      const m = new THREE.InstancedMesh(geo, mat, MAX_FISH);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FISH * 3).fill(1), 3);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      return m;
    };
    return {
      body: make(fish.body, new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.3 })),
      tail: make(fish.tail, new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.15, side: THREE.DoubleSide })),
    };
  }, [fish]);
  useEffect(() => () => {
    fish.body.dispose(); fish.tail.dispose();
    (fishMeshes.body.material as THREE.Material).dispose();
    (fishMeshes.tail.material as THREE.Material).dispose();
    shark.body.dispose(); shark.fins.dispose(); shark.tail.dispose();
  }, [fish, fishMeshes, shark]);

  const near = useRef<{ at: number; schools: SeaCreature[]; sharks: SeaCreature[] }>({ at: -Infinity, schools: [], sharks: [] });
  // Seeding every home takes a moment (a terrain check per loop), so do it
  // when the browser is idle rather than in the first frame.
  const ready = useRef(false);
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    const run = () => { getSeaLife(); ready.current = true; };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(run, { timeout: 3000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(run, 500);
    return () => window.clearTimeout(id);
  }, []);
  const warn = useRef({ checkAt: 0, lastAt: -Infinity });
  const tmp = useMemo(() => ({
    q: new THREE.Quaternion(),
    q2: new THREE.Quaternion(),
    p: new THREE.Vector3(),
    s: new THREE.Vector3(),
    m: new THREE.Matrix4(),
    school: new THREE.Matrix4(),
    local: new THREE.Matrix4(),
    yAxis: new THREE.Vector3(0, 1, 0),
    xAxis: new THREE.Vector3(1, 0, 0),
  }), []);

  // Earth follows every frame; the creatures themselves are paced by the
  // render governor. Their poses come from absolute shared time, so a
  // skipped frame simply lands them where they belong now.
  const gate = useMemo(() => createTierGate('proximity'), []);
  useFrame((_state, delta) => {
    const pose = getEarthPose();
    const earth = earthRef.current;
    if (earth) {
      earth.position.set(pose.center[0], pose.center[1], pose.center[2]);
      earth.quaternion.set(pose.spinQuat[0], pose.spinQuat[1], pose.spinQuat[2], pose.spinQuat[3]);
    }
    const due = gate(delta);
    if (due === null) return;
    const g0 = performance.now();
    try {
    const t = getEarthPoseTime();
    const now = performance.now() / 1000;
    const viewN = worldPosToLocalNormal([camera.position.x, camera.position.y, camera.position.z], pose);

    // Broad phase once a second: which loops come near the viewer.
    const nr = near.current;
    if (ready.current && now - nr.at > PICK_EVERY_S) {
      nr.at = now;
      nr.schools = seaLifeNear(viewN, FISH_VIEW_M, 'school');
      nr.sharks = seaLifeNear(viewN, SHARK_VIEW_M, 'shark');
    }

    // ── Fish ──
    const bodyMesh = fishMeshes.body;
    const tailMesh = fishMeshes.tail;
    let k = 0;
    {
      for (const c of nr.schools) {
        const sp = seaPoseAt(c, t);
        if (arcMetres(viewN, sp.n) > FISH_VIEW_M) continue;
        const layout = layoutOf(c);
        if (k + layout.length > MAX_FISH) break;
        tmp.p.set(sp.n[0], sp.n[1], sp.n[2]).multiplyScalar(EARTH_RADIUS - c.depth);
        frameQuat(sp.n, sp.heading, tmp.q);
        tmp.school.compose(tmp.p, tmp.q, tmp.s.set(1, 1, 1));
        const leap = leapAt(c, t);
        const beat = 6 + 4 * sp.speed;
        for (let i = 0; i < layout.length; i++) {
          const f = layout[i];
          // Each fish weaves a little about its place and wags as it swims.
          const w = t * beat + f.phase;
          let y = f.y + 0.08 * Math.sin(w * 0.23);
          let pitch = 0;
          if (i === 0 && leap >= 0) {
            // Up out of the water and back in, nose leading the arc.
            y += (c.depth + LEAP_H) * 4 * leap * (1 - leap);
            pitch = (0.5 - leap) * 1.6;
          }
          tmp.p.set(f.x + 0.25 * Math.sin(w * 0.17), y, f.z + 0.3 * Math.sin(w * 0.11));
          tmp.q2.setFromAxisAngle(tmp.yAxis, 0.18 * Math.sin(w));
          if (pitch) tmp.q2.multiply(new THREE.Quaternion().setFromAxisAngle(tmp.xAxis, pitch));
          tmp.local.compose(tmp.p, tmp.q2, tmp.s.set(f.scale, f.scale, f.scale));
          tmp.m.multiplyMatrices(tmp.school, tmp.local);
          bodyMesh.setMatrixAt(k, tmp.m);
          tailMesh.setMatrixAt(k, tmp.m);
          bodyMesh.setColorAt(k, f.color);
          tailMesh.setColorAt(k, f.color);
          k++;
        }
      }
      bodyMesh.count = k;
      tailMesh.count = k;
      bodyMesh.instanceMatrix.needsUpdate = true;
      tailMesh.instanceMatrix.needsUpdate = true;
      if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true;
      if (tailMesh.instanceColor) tailMesh.instanceColor.needsUpdate = true;
    }

    // ── Sharks ──
    let s = 0;
    for (const c of nr.sharks) {
      if (s >= MAX_SHARKS) break;
      if (sharkGone(c.id, Date.now())) continue;
      const sp = seaPoseAt(c, t);
      if (arcMetres(viewN, sp.n) > SHARK_VIEW_M) continue;
      const g = sharkRefs.current[s];
      if (!g) break;
      g.visible = true;
      const bob = 0.04 * Math.sin(t * 0.9 + c.p1);
      // A shark keeping away (after a bite, or knifed) dives out of reach.
      const dive = sharkDiveAt(c.id, t);
      g.position.set(sp.n[0], sp.n[1], sp.n[2]).multiplyScalar(EARTH_RADIUS - c.depth - dive + bob);
      frameQuat(sp.n, sp.heading, tmp.q);
      tmp.q2.setFromAxisAngle(tmp.yAxis, 0.06 * Math.sin(t * 2.2 + c.p2));
      g.quaternion.copy(tmp.q).multiply(tmp.q2);
      const tail = sharkTailRefs.current[s];
      if (tail) tail.rotation.y = 0.35 * Math.sin(t * 2.2 + c.p2);
      s++;
    }
    for (let i = s; i < MAX_SHARKS; i++) {
      const g = sharkRefs.current[i];
      if (g) g.visible = false;
    }

    // ── A swimmer near a shark: a warning, then a bite (this device) ──
    const w = warn.current;
    if (now >= w.checkAt) {
      w.checkAt = now + 0.25;
      if (nr.sharks.length) {
        const body = getBrainPhysics().getBody(selfId);
        if (body) {
          const n = worldPosToLocalNormal(body.pos, pose);
          const dx = body.pos[0] - pose.center[0];
          const dy = body.pos[1] - pose.center[1];
          const dz = body.pos[2] - pose.center[2];
          const r = Math.hypot(dx, dy, dz);
          const feet = r - EARTH_RADIUS - BODY_CENTER_HEIGHT;
          if (isSwimmingAt(n, feet)) {
            const nowMs = Date.now();
            const bite = trySharkBite(n, t, nowMs);
            if (bite) {
              const have = materialTotals().food;
              const lost = Math.min(SHARK_BITE_FOOD, Math.max(0, Math.floor(have)));
              if (lost > 0) spendMaterials({ food: lost });
              const p = quatRotate(pose.spinQuat, [bite.shoveTo[0] * r, bite.shoveTo[1] * r, bite.shoveTo[2] * r]);
              teleportBody(selfId, [p[0] + pose.center[0], p[1] + pose.center[1], p[2] + pose.center[2]]);
              w.lastAt = now;
              toast.error('A shark bit you!', {
                id: 'shark-warning',
                description: lost > 0 ? `You lost ${lost} Food. Get out of the water, or swing your knife at it.` : 'Get out of the water, or swing your knife at it.',
              });
            } else if (now - w.lastAt > WARN_COOLDOWN_S && threateningShark(n, t, nowMs, SHARK_WARN_M)) {
              w.lastAt = now;
              toast.warning('Shark nearby! Swim for a boat or the shore, or ready your knife.', { id: 'shark-warning' });
            }
          }
        }
      }
    }
    } finally { renderGovernor.observeSubsystem('sea-life', performance.now() - g0); }
  });

  return (
    <group ref={earthRef}>
      <primitive object={fishMeshes.body} />
      <primitive object={fishMeshes.tail} />
      {Array.from({ length: MAX_SHARKS }, (_, i) => (
        <group key={i} ref={(el) => { sharkRefs.current[i] = el; }} visible={false}>
          <mesh geometry={shark.body}>
            <meshStandardMaterial color={SHARK_COLOR} roughness={0.6} />
          </mesh>
          {/* paler belly */}
          <mesh geometry={shark.body} position={[0, -0.1, 0]} scale={[0.92, 0.82, 0.95]}>
            <meshStandardMaterial color={SHARK_BELLY} roughness={0.7} />
          </mesh>
          <mesh geometry={shark.fins}>
            <meshStandardMaterial color={SHARK_COLOR} roughness={0.6} side={THREE.DoubleSide} />
          </mesh>
          <group position={[0, 0.05, 1.25]} ref={(el) => { sharkTailRefs.current[i] = el; }}>
            <mesh geometry={shark.tail}>
              <meshStandardMaterial color={SHARK_COLOR} roughness={0.6} side={THREE.DoubleSide} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
}

export default SeaLifeLayer;
