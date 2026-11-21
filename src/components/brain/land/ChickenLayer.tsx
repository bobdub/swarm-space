/**
 * ChickenLayer — free-range hens wandering the land.
 *
 * Where each hen is comes from `land/chickens.ts` on the shared clock, so
 * every peer sees the same hen in the same place. A caught hen is hidden
 * on every peer; then an egg appears in the flock's nest, hatches into a
 * chick, and the chick grows up into the lost bird. Each flock has one
 * rooster: bigger, with a tall comb, wattles and dark sickle tail plumes.
 * This layer only draws the birds near the viewer, as a handful of
 * instanced meshes.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EARTH_RADIUS, getEarthPose, getEarthPoseTime, worldPosToLocalNormal, type Vec3 } from '@/lib/brain/earth';
import { groundElevationAt } from '@/lib/brain/groundHeight';
import { arcMetres } from '@/lib/brain/sea/seaLife';
import {
  EGG_HATCH_MS,
  broodChickPoseAt,
  broodChicks,
  broodEggOffset,
  chickPoseAt,
  eggOffset,
  flockOf,
  nestEggs,
  getHens,
  henLifeAt,
  henPoseAt,
  hensNear,
  nestPoint,
  type Hen,
  type HenPose,
} from '@/lib/brain/land/chickens';

/** Draw distance (m) and most hens drawn at once. */
const VIEW_M = 90;
const MAX_HENS = 96;
const MAX_NESTS = 24;
const MAX_EGGS = 72;
/** Seconds between re-picking which hens are near. */
const PICK_EVERY_S = 1;

const PLUMAGE = ['#f3efe6', '#9a5a2c', '#2b2622', '#a7a39b'].map((c) => new THREE.Color(c));
const ROOSTER_PLUMAGE = ['#f6f1e4', '#b4471f', '#1f1b18', '#c99a45'].map((c) => new THREE.Color(c));
const CHICK = new THREE.Color('#f5d64a');
const EGG_COLORS = ['#f4ecdc', '#e2c29a', '#efe3cf', '#d9b48a'].map((c) => new THREE.Color(c));

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
  // Rooster: a tall serrated comb, red wattles, and arching tail plumes.
  const bigComb = new THREE.BoxGeometry(0.022, 0.09, 0.11);
  bigComb.translate(0, 0.195, -0.045);
  const wattle = new THREE.SphereGeometry(0.022, 6, 5);
  wattle.scale(0.8, 1.5, 0.8);
  wattle.translate(0, 0.045, -0.115);
  const plume = new THREE.ConeGeometry(0.05, 0.36, 5);
  plume.translate(0, 0.18, 0);
  plume.rotateX(0.9);
  plume.translate(0, 0.36, 0.14);
  const nest = nestGeometry();
  const egg = new THREE.SphereGeometry(1, 10, 8);
  egg.scale(0.045, 0.06, 0.045);
  egg.translate(0, 0.07, 0);
  return { body, tail, head, comb, beak, leg, bigComb, wattle, plume, nest, egg };
}

/** Small deterministic PRNG (mulberry32), so every peer builds the same nest. */
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

const STRAW = ['#c9a45c', '#b48a45', '#d8bd7a', '#9c7a3c', '#e0c98f', '#a88a52'].map((c) => new THREE.Color(c));

/**
 * The nest, built in code from plain shapes: a woven bowl of straw about
 * 0.55 m across with a soft, pale lining of down, dozens of loose straws
 * wrapped round its rim, and a few strays poking out onto the ground.
 * Every piece carries its own straw colour, merged into one geometry so
 * all the nests in view still draw in a single call.
 */
export function nestGeometry(): THREE.BufferGeometry {
  const r = rand(0x5e57);
  const parts: { g: THREE.BufferGeometry; color: (i: number) => THREE.Color }[] = [];

  // The bowl: a lathe of a rounded rim, shallow hollow in the middle,
  // each ring nudged in and out so the edge is never a perfect circle.
  const profile = [
    [0.0, 0.012], [0.06, 0.016], [0.11, 0.03], [0.155, 0.06], [0.19, 0.095],
    [0.215, 0.11], [0.245, 0.1], [0.27, 0.07], [0.28, 0.035], [0.272, 0.0],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const bowl = new THREE.LatheGeometry(profile, 28).toNonIndexed();
  const bp = bowl.getAttribute('position');
  for (let i = 0; i < bp.count; i++) {
    const x = bp.getX(i);
    const z = bp.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 + 0.05 * Math.sin(a * 5 + 1.3) + 0.03 * Math.sin(a * 11);
    bp.setXYZ(i, x * k, bp.getY(i) * (1 + 0.12 * Math.sin(a * 7)), z * k);
  }
  bowl.computeVertexNormals();
  // Darker straw under the rim, sun-bleached on top, mottled face by face.
  const dark = new THREE.Color('#8f6d36');
  const light = new THREE.Color('#d9bf80');
  const tint = new THREE.Color();
  const bpos = bowl.getAttribute('position');
  parts.push({
    g: bowl,
    color: (f) => {
      const y = (bpos.getY(f * 3) + bpos.getY(f * 3 + 1) + bpos.getY(f * 3 + 2)) / 3;
      const n = ((Math.imul(f + 1, 2654435761) >>> 0) % 1000) / 1000;
      return tint.copy(dark).lerp(light, Math.min(1, y / 0.1) * 0.7 + n * 0.3).clone();
    },
  });

  // The lining: a pale disc of down in the hollow, where the eggs lie.
  const lining = new THREE.CircleGeometry(0.13, 16).toNonIndexed();
  lining.rotateX(-Math.PI / 2);
  lining.translate(0, 0.02, 0);
  const down = new THREE.Color('#efe6d2');
  parts.push({ g: lining, color: () => down });

  // Straws woven round the rim: thin flat strips laid along the circle,
  // each tilted and turned a little.
  for (let i = 0; i < 170; i++) {
    const len = 0.1 + 0.14 * r();
    const strip = new THREE.BoxGeometry(0.009, 0.004, len).toNonIndexed();
    const a = r() * Math.PI * 2;
    const rad = 0.15 + 0.13 * r();
    const y = 0.03 + 0.085 * r() * (1 - Math.abs(rad - 0.22) * 3);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(Math.cos(a) * rad, Math.max(0.01, y), Math.sin(a) * rad),
      new THREE.Quaternion().setFromEuler(new THREE.Euler((r() - 0.5) * 0.7, -a + (r() - 0.5) * 0.6, (r() - 0.5) * 0.5)),
      new THREE.Vector3(1, 1, 1),
    );
    strip.applyMatrix4(m);
    const c = STRAW[Math.floor(r() * STRAW.length)];
    parts.push({ g: strip, color: () => c });
  }

  // A few strays sticking out onto the ground round the nest.
  for (let i = 0; i < 14; i++) {
    const len = 0.12 + 0.12 * r();
    const strip = new THREE.BoxGeometry(0.008, 0.004, len).toNonIndexed();
    const a = r() * Math.PI * 2;
    const rad = 0.27 + 0.06 * r();
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(Math.cos(a) * rad, 0.006, Math.sin(a) * rad),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a + Math.PI / 2 + (r() - 0.5) * 1.2, 0)),
      new THREE.Vector3(1, 1, 1),
    );
    strip.applyMatrix4(m);
    const c = STRAW[Math.floor(r() * STRAW.length)];
    parts.push({ g: strip, color: () => c });
  }

  // Merge every part (all non-indexed) into one geometry with vertex colours.
  let total = 0;
  for (const p of parts) total += p.g.getAttribute('position').count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const p of parts) {
    const pa = p.g.getAttribute('position');
    const na = p.g.getAttribute('normal');
    for (let i = 0; i < pa.count; i++) {
      pos.set([pa.getX(i), pa.getY(i), pa.getZ(i)], (o + i) * 3);
      nor.set([na.getX(i), na.getY(i), na.getZ(i)], (o + i) * 3);
      const c = p.color(Math.floor(i / 3));
      col.set([c.r, c.g, c.b], (o + i) * 3);
    }
    o += pa.count;
    p.g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
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
      bigComb: make(geo.bigComb, new THREE.MeshStandardMaterial({ color: '#d1271f', roughness: 0.7 }), MAX_HENS, false),
      wattle: make(geo.wattle, new THREE.MeshStandardMaterial({ color: '#c41e1a', roughness: 0.7 }), MAX_HENS, false),
      plume: make(geo.plume, new THREE.MeshStandardMaterial({ color: '#16302a', roughness: 0.4, metalness: 0.35 }), MAX_HENS * 3, false),
      nest: make(geo.nest, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }), MAX_NESTS, false),
      egg: make(geo.egg, new THREE.MeshStandardMaterial({ roughness: 0.5 }), MAX_EGGS, true),
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
    zAxis: new THREE.Vector3(0, 0, 1),
    head: new THREE.Matrix4(),
    col: new THREE.Color(),
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
    let rk = 0; // roosters drawn (combs, wattles)
    let pk = 0; // plumes
    let ek = 0; // eggs
    let nk = 0; // nests
    const nests = new Set<string>();
    const place = (n: Vec3, lift: number, heading: Vec3, scale: number) => {
      tmp.p.set(n[0], n[1], n[2]).multiplyScalar(EARTH_RADIUS + groundElevationAt(n) + lift);
      frameQuat(n, heading, tmp.q);
      tmp.frame.compose(tmp.p, tmp.q, tmp.s.set(scale, scale, scale));
      return tmp.frame;
    };

    const drawEgg = (n: Vec3, heading: Vec3, rock: number, color: THREE.Color, seed: number) => {
      if (ek >= MAX_EGGS) return;
      place(n, 0, heading, 1);
      if (rock > 0) {
        tmp.q2.setFromAxisAngle(tmp.zAxis, 0.25 * Math.sin(now * 14 + seed) * rock);
        tmp.local.makeRotationFromQuaternion(tmp.q2);
        tmp.m.multiplyMatrices(tmp.frame, tmp.local);
        meshes.egg.setMatrixAt(ek, tmp.m);
      } else {
        meshes.egg.setMatrixAt(ek, tmp.frame);
      }
      meshes.egg.setColorAt(ek, color);
      ek++;
    };

    const drawBird = (hp: HenPose, scale: number, rooster: boolean, plumage: number, chick: boolean, grown: number) => {
      if (k >= MAX_HENS) return;
      if (arcMetres(viewN, hp.n) > VIEW_M) return;
      const adultCol = (rooster ? ROOSTER_PLUMAGE : PLUMAGE)[plumage] ?? PLUMAGE[0];
      // Yellow fluff until halfway, then the adult feathers come through.
      const col = chick ? tmp.col.copy(CHICK).lerp(adultCol, Math.max(0, (grown - 0.5) * 2)) : adultCol;
      const size = scale * (chick ? 0.3 + 0.7 * grown : 1);

      // Walking: a little bob, legs swinging, head jerking forward.
      // Pecking: head dips to the ground a few times. Chicks scurry faster.
      const stride = hp.pecking ? 0 : Math.sin(hp.phase * Math.PI * 2 * (chick ? 14 : 9));
      const bob = hp.pecking ? 0 : 0.012 * Math.abs(stride);
      place(hp.n, bob, hp.heading, size);

      meshes.body.setMatrixAt(k, tmp.frame);
      meshes.tail.setMatrixAt(k, tmp.frame);
      meshes.body.setColorAt(k, col);
      meshes.tail.setColorAt(k, col);
      if (rooster && grown > 0.7) {
        for (let i = 0; i < 3 && pk < MAX_HENS * 3; i++) {
          tmp.q2.setFromAxisAngle(tmp.zAxis, (i - 1) * 0.35);
          tmp.local.compose(tmp.p.set(0, 0, 0), tmp.q2, tmp.s.set(1, 1 - 0.15 * Math.abs(i - 1), 1));
          tmp.m.multiplyMatrices(tmp.frame, tmp.local);
          meshes.plume.setMatrixAt(pk++, tmp.m);
        }
      }

      const peck = hp.pecking ? Math.max(0, Math.sin(hp.phase * Math.PI * 2 * 3)) : 0;
      const pitch = -1.15 * peck;
      const jut = hp.pecking ? 0.03 * peck : 0.025 * stride;
      tmp.q2.setFromAxisAngle(tmp.xAxis, -pitch);
      tmp.local.compose(tmp.p.set(NECK[0], NECK[1] - 0.03 * peck, NECK[2] - jut), tmp.q2, tmp.one);
      const headM = tmp.head.multiplyMatrices(tmp.frame, tmp.local);
      meshes.head.setMatrixAt(k, headM);
      meshes.head.setColorAt(k, col);
      meshes.beak.setMatrixAt(k, headM);
      // Hens and young roosters wear the small comb; chicks have none yet.
      const combScale = chick && grown < 0.6 ? 0.001 : 1;
      if (rooster && grown > 0.7) {
        meshes.bigComb.setMatrixAt(rk, headM);
        meshes.wattle.setMatrixAt(rk, headM);
        rk++;
        tmp.m.makeScale(0.001, 0.001, 0.001);
        meshes.comb.setMatrixAt(k, tmp.m.premultiply(headM));
      } else {
        tmp.m.makeScale(combScale, combScale, combScale);
        meshes.comb.setMatrixAt(k, tmp.m.premultiply(headM));
      }

      for (let side = 0; side < 2; side++) {
        const swing = (side === 0 ? 1 : -1) * 0.45 * stride;
        tmp.q2.setFromAxisAngle(tmp.xAxis, swing);
        tmp.local.compose(tmp.p.set(side === 0 ? -HIP_X : HIP_X, HIP_Y, 0.02), tmp.q2, tmp.one);
        tmp.m.multiplyMatrices(tmp.frame, tmp.local);
        meshes.legs.setMatrixAt(k * 2 + side, tmp.m);
      }
      k++;
    };

    for (const h of nr.hens) {
      // One nest per flock, at its home, with the eggs the hens laid in it
      // and the chicks that hatched from them.
      if (!nests.has(h.flock) && nk < MAX_NESTS && arcMetres(viewN, h.nest) <= VIEW_M) {
        nests.add(h.flock);
        meshes.nest.setMatrixAt(nk++, place(h.nest, 0, h.e1, 1));
        const flock = flockOf(h);
        for (const e of nestEggs(flock, wall)) {
          const [ox, oz] = broodEggOffset(e);
          const left = (e.layAt + EGG_HATCH_MS - wall) / 1000;
          const rock = e.fertile && left < 30 ? 1 - left / 30 : 0;
          drawEgg(nestPoint(h.nest, ox, oz), h.e1, rock, EGG_COLORS[e.mother.plumage] ?? EGG_COLORS[0], e.layAt % 97);
        }
        for (const c of broodChicks(flock, wall)) {
          // Brood chicks stay chick-sized: they leave before they are grown.
          drawBird(broodChickPoseAt(c, t), c.egg.mother.scale, false, c.egg.mother.plumage, true, c.progress * 0.55);
        }
      }
      const life = henLifeAt(h, wall);
      if (life.stage === 'gone') continue;

      if (life.stage === 'egg') {
        const [ox, oz] = eggOffset(h.slot);
        // Rocks a little in its last half minute, as the chick pecks out.
        const left = (1 - life.progress) * (EGG_HATCH_MS / 1000);
        drawEgg(nestPoint(h.nest, ox, oz), h.e1, left < 30 ? 1 - left / 30 : 0, EGG_COLORS[h.plumage] ?? EGG_COLORS[0], h.slot);
        continue;
      }

      const chick = life.stage === 'chick';
      const hp: HenPose = chick ? chickPoseAt(h, t, life.progress) : henPoseAt(h, t);
      drawBird(hp, h.scale, h.rooster, h.plumage, chick, chick ? life.progress : 1);
    }
    const counts: Record<keyof typeof meshes, number> = {
      body: k, tail: k, head: k, comb: k, beak: k, legs: k * 2,
      bigComb: rk, wattle: rk, plume: pk, nest: nk, egg: ek,
    };
    for (const key of Object.keys(meshes) as (keyof typeof meshes)[]) {
      const m = meshes[key];
      m.count = counts[key];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
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
