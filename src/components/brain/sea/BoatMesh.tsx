/**
 * BoatMesh — the village boat, built from code (no imported model).
 *
 * Local frame: +Y up (out of the sea), −Z toward the bow, +X starboard.
 * y = 0 is the waterline. The hull is lofted from cross-sections; the
 * deck, rail, mast, furled sail, wheel, rowing bench, stowed oars and the
 * stern ladder are plain primitives sized from the plan:
 * 7 m long, 2.6 m beam, 0.6 m draft, deck 0.5 m above the water.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { COMPOUND_TABLE } from '@/lib/virtualHub/compoundCatalog';
import { BOAT_DECK_Y, BOAT_GATE_HALF, BOAT_RAIL_H } from '@/lib/brain/sea/boatSpec';
import { sailFill, type Vessel } from '@/lib/brain/sea/vessel';
import { getCrewBoatKey, getCrewRole, getCrewSpot, startMastHold, stopMastHold } from '@/lib/brain/sea/crew';
import { ROD_SPOTS, getFishing } from '@/lib/brain/sea/fishing';
import { getEarthPoseTime } from '@/lib/brain/earth';
import { HALF_L, STERN_RAIL_END_T, gunwaleY, hullHalfBeam, keelY, tAt, zAt } from '@/lib/brain/sea/boatHull';

const HULL = COMPOUND_TABLE.door_single.color; // oak
const TRIM = '#3b2616';
const DECK = '#9a7448';
const CANVAS = '#e9e1cc';
const ROPE = '#c8b48a';

const STATIONS = 24;
const RIBS = 14;

function buildHull(): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= STATIONS; i++) {
    const t = i / STATIONS;
    const hb = Math.max(0.001, hullHalfBeam(t));
    const gy = gunwaleY(t);
    const ky = Math.min(keelY(t), gy - 0.05);
    for (let j = 0; j <= RIBS; j++) {
      const phi = -Math.PI / 2 + (Math.PI * j) / RIBS;
      const x = hb * Math.sin(phi);
      const y = ky + (gy - ky) * Math.pow(1 - Math.cos(phi), 1.4);
      pos.push(x, y, zAt(t));
    }
  }
  const row = RIBS + 1;
  for (let i = 0; i < STATIONS; i++) {
    for (let j = 0; j < RIBS; j++) {
      const a = i * row + j;
      const b = a + 1;
      const c = a + row;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // Transom: fan across the stern section.
  const sternStart = STATIONS * row;
  const hubIndex = pos.length / 3;
  pos.push(0, (gunwaleY(1) + keelY(1)) / 2, zAt(1));
  for (let j = 0; j < RIBS; j++) idx.push(hubIndex, sternStart + j, sternStart + j + 1);
  // Close the top of the transom.
  idx.push(hubIndex, sternStart + RIBS, sternStart);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function buildDeck(): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  const n = 20;
  // Shape lives in XY; rotated −90° about X, shape y becomes −z.
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = hullHalfBeam(t) * 0.94;
    const z = zAt(t);
    if (i === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  }
  for (let i = n; i >= 0; i--) {
    const t = i / n;
    shape.lineTo(-hullHalfBeam(t) * 0.94, -zAt(t));
  }
  return new THREE.ShapeGeometry(shape);
}

/** Rail along one side from t0 to t1 (bow → stern), as a tube. */
function buildRail(side: 1 | -1, t0: number, t1: number): THREE.TubeGeometry {
  const pts: THREE.Vector3[] = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const t = t0 + ((t1 - t0) * i) / n;
    pts.push(new THREE.Vector3(side * hullHalfBeam(t) * 0.97, BOAT_DECK_Y + BOAT_RAIL_H, zAt(t)));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, 0.035, 6, false);
}

export function BoatMesh({ vessel, boatKey }: { vessel: Vessel; boatKey?: string }) {
  const hull = useMemo(buildHull, []);
  const deck = useMemo(buildDeck, []);
  const gateT0 = tAt(-BOAT_GATE_HALF);
  const gateT1 = tAt(BOAT_GATE_HALF);
  const rails = useMemo(
    () => [
      buildRail(1, 0.04, gateT0),
      buildRail(1, gateT1, STERN_RAIL_END_T),
      buildRail(-1, 0.04, gateT0),
      buildRail(-1, gateT1, STERN_RAIL_END_T),
    ],
    [gateT0, gateT1],
  );
  // Rail posts every ~0.8 m, skipping the gates.
  const posts = useMemo(() => {
    const out: [number, number, number][] = [];
    for (let z = -HALF_L + 0.5; z <= HALF_L - 0.45; z += 0.8) {
      if (Math.abs(z) < BOAT_GATE_HALF) continue;
      const hb = hullHalfBeam(tAt(z)) * 0.97;
      out.push([hb, z, 0], [-hb, z, 0]);
    }
    for (const g of [-BOAT_GATE_HALF, BOAT_GATE_HALF]) {
      const hb = hullHalfBeam(tAt(g)) * 0.97;
      out.push([hb, g, 1], [-hb, g, 1]);
    }
    return out;
  }, []);

  const mastZ = -0.7;
  const mastH = 6;
  const boomY = BOAT_DECK_Y + 1.7;
  const boomLen = 3.1;
  const wheelZ = 2.55;
  const benchZ = 0.85;
  const sternZ = HALF_L;

  // Live parts: the wheel turns with the helm, the boom swings to leeward,
  // and the sail unrolls from the boom as it is raised.
  const wheelRef = useRef<THREE.Group>(null);
  const boomRef = useRef<THREE.Group>(null);
  const sailRef = useRef<THREE.Mesh>(null);
  const furlRef = useRef<THREE.Mesh>(null);
  // The sail is a grid over the triangle (luff up the mast, foot along the
  // boom) so it can belly to leeward with the wind, and flap when luffing.
  const SAIL_U = 8;
  const SAIL_V = 8;
  const sailTop = mastH - 0.5 - (boomY - BOAT_DECK_Y);
  const sailGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array((SAIL_U + 1) * (SAIL_V + 1) * 3);
    const idx: number[] = [];
    const row = SAIL_U + 1;
    for (let j = 0; j < SAIL_V; j++) {
      for (let i = 0; i < SAIL_U; i++) {
        const a = j * row + i;
        idx.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
      }
    }
    g.setIndex(idx);
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    return g;
  }, []);
  useEffect(() => () => sailGeo.dispose(), [sailGeo]);
  const shapeSail = (depth: number, luff: number, side: number, time: number) => {
    const attr = sailGeo.attributes.position as THREE.BufferAttribute;
    const p = attr.array as Float32Array;
    const footA = 0.1;
    const footB = boomLen - 0.1;
    let k = 0;
    for (let j = 0; j <= SAIL_V; j++) {
      const v = j / SAIL_V;
      for (let i = 0; i <= SAIL_U; i++) {
        const u = i / SAIL_U;
        const fz = footA + (footB - footA) * u;
        const y = 0.05 + (sailTop - 0.05) * v;
        const z = fz * (1 - v) + 0.05 * v;
        const chord = (footB - footA) * (1 - v);
        const belly = Math.sin(Math.PI * u) * Math.pow(1 - v, 0.6);
        let x = side * depth * chord * belly;
        if (luff > 0) x += luff * 0.12 * Math.sin(time * 11 + u * 9 + v * 4) * belly;
        p[k++] = x; p[k++] = y; p[k++] = z;
      }
    }
    attr.needsUpdate = true;
    sailGeo.computeVertexNormals();
    sailGeo.computeBoundingSphere();
  };
  const sailShapeKey = useRef('');
  useFrame(() => {
    const boat = vessel;
    if (wheelRef.current) wheelRef.current.rotation.z = -boat.cmd.wheel * 1.5 * Math.PI * 2;
    const sail = boat.cmd.sail;
    const w = boat.windOnBow();
    // Boom to leeward: near the centreline close-hauled, well out running.
    const beta = Math.abs(w.from);
    const swing = sail > 0.02 && w.speed > 1e-6 ? Math.max(0.15, Math.min(1.35, beta * 0.5)) : 0;
    const target = w.from > 0 ? -swing : swing;
    if (boomRef.current) boomRef.current.rotation.y += (target - boomRef.current.rotation.y) * 0.05;
    if (sailRef.current) {
      sailRef.current.visible = sail > 0.02;
      sailRef.current.scale.set(1, Math.max(0.02, sail), 1);
      if (sail > 0.02) {
        // Belly to leeward with the drive; flap when pointed into the wind.
        const { fill, luff } = sailFill(w.from, w.speed);
        const side = w.from > 0 ? -1 : 1;
        const depth = 0.14 * fill;
        const key = luff > 0 ? '' : `${side}:${depth.toFixed(3)}`;
        if (luff > 0 || key !== sailShapeKey.current) {
          sailShapeKey.current = key;
          shapeSail(depth, luff, side, performance.now() / 1000);
        }
      }
    }
    if (furlRef.current) furlRef.current.scale.set(1 - 0.6 * sail, 1, 1 - 0.6 * sail);
  });
  const onMastDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    startMastHold(vessel.cmd.sail);
    const up = () => { stopMastHold(); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  return (
    <group>
      {/* Hull */}
      <mesh geometry={hull} castShadow receiveShadow>
        <meshStandardMaterial color={HULL} roughness={0.85} side={THREE.DoubleSide} />
      </mesh>
      {/* Deck */}
      <mesh geometry={deck} rotation={[-Math.PI / 2, 0, 0]} position={[0, BOAT_DECK_Y, 0]} receiveShadow>
        <meshStandardMaterial color={DECK} roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      {/* Rails and posts (gates midships each side) */}
      {rails.map((g, i) => (
        <mesh key={`rail-${i}`} geometry={g}>
          <meshStandardMaterial color={TRIM} roughness={0.7} />
        </mesh>
      ))}
      {posts.map(([x, z, gate], i) => (
        <mesh key={`post-${i}`} position={[x, BOAT_DECK_Y + BOAT_RAIL_H / 2, z]}>
          <cylinderGeometry args={[gate ? 0.05 : 0.03, gate ? 0.05 : 0.03, BOAT_RAIL_H, 6]} />
          <meshStandardMaterial color={TRIM} roughness={0.7} />
        </mesh>
      ))}
      {/* Mast, boom and the furled sail */}
      <mesh position={[0, BOAT_DECK_Y + mastH / 2, mastZ]} castShadow>
        <cylinderGeometry args={[0.07, 0.1, mastH, 10]} />
        <meshStandardMaterial color={TRIM} roughness={0.75} />
      </mesh>
      {/* Press and hold the mast to raise or lower the sail (helm only). */}
      <mesh position={[0, BOAT_DECK_Y + mastH / 2, mastZ]} onPointerDown={onMastDown}>
        <cylinderGeometry args={[0.45, 0.45, mastH, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <group ref={boomRef} position={[0, boomY, mastZ]}>
        <mesh position={[0, 0, boomLen / 2]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.05, 0.05, boomLen, 8]} />
          <meshStandardMaterial color={TRIM} roughness={0.75} />
        </mesh>
        <mesh ref={furlRef} position={[0, 0.13, boomLen / 2]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.13, 0.11, boomLen - 0.2, 10]} />
          <meshStandardMaterial color={CANVAS} roughness={0.95} />
        </mesh>
        <mesh ref={sailRef} geometry={sailGeo} visible={false} castShadow>
          <meshStandardMaterial color={CANVAS} roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
      </group>
      {/* Stays: forestay to the bow, backstay to the stern */}
      <Line from={[0, BOAT_DECK_Y + mastH, mastZ]} to={[0, gunwaleY(0.02), zAt(0.02)]} />
      <Line from={[0, BOAT_DECK_Y + mastH, mastZ]} to={[0, gunwaleY(0.98), zAt(0.98)]} />
      {/* Ship's wheel on its pedestal, facing aft */}
      <mesh position={[0, BOAT_DECK_Y + 0.45, wheelZ]}>
        <boxGeometry args={[0.16, 0.9, 0.16]} />
        <meshStandardMaterial color={TRIM} roughness={0.7} />
      </mesh>
      <group ref={wheelRef} position={[0, BOAT_DECK_Y + 1.0, wheelZ + 0.12]}>
        <mesh>
          <torusGeometry args={[0.36, 0.03, 8, 28]} />
          <meshStandardMaterial color={HULL} roughness={0.6} />
        </mesh>
        {Array.from({ length: 8 }, (_, i) => (
          <mesh key={`spoke-${i}`} rotation={[0, 0, (i * Math.PI) / 4]}>
            <boxGeometry args={[0.035, 0.94, 0.035]} />
            <meshStandardMaterial color={HULL} roughness={0.6} />
          </mesh>
        ))}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.06, 0.06, 0.08, 10]} />
          <meshStandardMaterial color={TRIM} roughness={0.6} />
        </mesh>
      </group>
      {/* Rowing bench and the stowed oars */}
      <mesh position={[0, BOAT_DECK_Y + 0.42, benchZ]} castShadow>
        <boxGeometry args={[hullHalfBeam(tAt(benchZ)) * 1.85, 0.08, 0.36]} />
        <meshStandardMaterial color={TRIM} roughness={0.8} />
      </mesh>
      <OarsOut vessel={vessel} boatKey={boatKey} benchZ={benchZ} />
      {[1, -1].map((side) => (
        <group key={`oar-${side}`} name="stowed-oar" position={[side * 0.75, BOAT_DECK_Y + 0.08, 0.2]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.03, 0.03, 3.2, 6]} />
            <meshStandardMaterial color={HULL} roughness={0.7} />
          </mesh>
          <mesh position={[0, 0, 1.55]}>
            <boxGeometry args={[0.16, 0.03, 0.55]} />
            <meshStandardMaterial color={HULL} roughness={0.7} />
          </mesh>
        </group>
      ))}
      {/* Rods in their holders by the rail, forward of the mast */}
      {ROD_SPOTS.map(([x, z]) => (
        <RodInHolder key={`rod-${x}`} x={x} z={z} />
      ))}
      <FishingLine vessel={vessel} boatKey={boatKey} />
      {/* Stern ladder down into the sea */}
      <group position={[0, 0, sternZ + 0.06]}>
        {[-0.22, 0.22].map((x) => (
          <mesh key={`ladder-${x}`} position={[x, gunwaleY(1) / 2 - 0.35, 0]}>
            <boxGeometry args={[0.04, gunwaleY(1) + 0.7, 0.04]} />
            <meshStandardMaterial color={TRIM} roughness={0.7} />
          </mesh>
        ))}
        {[-0.5, -0.15, 0.2, 0.55].map((y) => (
          <mesh key={`rung-${y}`} position={[0, y, 0]}>
            <boxGeometry args={[0.44, 0.035, 0.035]} />
            <meshStandardMaterial color={TRIM} roughness={0.7} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

function Line({ from, to, radius = 0.012, color = ROPE }: { from: [number, number, number]; to: [number, number, number]; radius?: number; color?: string }) {
  const { position, quaternion, length } = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const dir = b.clone().sub(a);
    const len = dir.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return { position: mid, quaternion: q, length: len };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from.join(','), to.join(',')]);
  return (
    <mesh position={position} quaternion={quaternion}>
      <cylinderGeometry args={[radius, radius * 0.6, length, 5]} />
      <meshStandardMaterial color={color} roughness={0.9} />
    </mesh>
  );
}

/** Rod geometry: butt in a holder on the rail, tip out over the water. */
const ROD_LEN = 2.4;
function rodTip(x: number, z: number): [number, number, number] {
  const side = x < 0 ? -1 : 1;
  const base = [x + side * 0.3, BOAT_DECK_Y + 0.75, z] as const;
  // 55° out from upright, leaning a little forward.
  const a = (55 * Math.PI) / 180;
  return [base[0] + side * Math.sin(a) * ROD_LEN, base[1] + Math.cos(a) * ROD_LEN, base[2] - 0.25];
}

function RodInHolder({ x, z }: { x: number; z: number }) {
  const side = x < 0 ? -1 : 1;
  const base: [number, number, number] = [x + side * 0.3, BOAT_DECK_Y + 0.75, z];
  return (
    <group>
      <Line from={base} to={rodTip(x, z)} radius={0.018} color={TRIM} />
      <mesh position={[base[0], base[1] - 0.15, base[2]]}>
        <cylinderGeometry args={[0.04, 0.04, 0.3, 6]} />
        <meshStandardMaterial color={TRIM} roughness={0.7} />
      </mesh>
    </group>
  );
}

/** The local angler's line and float, when they fish from this boat. */
function FishingLine({ vessel, boatKey }: { vessel: Vessel; boatKey?: string }) {
  const floatRef = useRef<THREE.Mesh>(null);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    return g;
  }, []);
  useEffect(() => () => geo.dispose(), [geo]);
  const line = useMemo(() => new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#f4f1e6' })), [geo]);
  const fishRef = useRef<THREE.Group>(null);
  useFrame(() => {
    const f = getFishing();
    const mine = !!boatKey && getCrewRole() === 'rod' && getCrewBoatKey() === boatKey;
    const out = mine && (f.phase === 'waiting' || f.phase === 'bite' || f.phase === 'fight');
    const [sx, sz] = getCrewSpot() ?? ROD_SPOTS[0];
    const tip = rodTip(sx, sz);
    const side = sx < 0 ? -1 : 1;
    const now = performance.now() / 1000;
    // The fish: thrashing under the float while it's on, then swung up
    // out of the water to the rod tip when you land it.
    const fish = fishRef.current;
    if (fish) {
      const landed = mine && f.phase === 'caught' ? getEarthPoseTime() - f.since : -1;
      const on = f.phase === 'bite' || f.phase === 'fight';
      const show = (mine && on) || (landed >= 0 && landed < 1.6);
      fish.visible = show;
      if (show) {
        const fx0 = tip[0] + side * 0.8;
        const fz0 = tip[2] - 0.4;
        if (on) {
          // Hooked, it runs wider and harder than when it first takes.
          const run = f.phase === 'fight' ? 0.45 : 0.1;
          fish.position.set(fx0 + run * Math.sin(now * 3.1), -0.35, fz0 + run * Math.cos(now * 2.3));
          fish.rotation.set(0, now * 4, 0);
        } else {
          const u = Math.min(1, landed / 0.8);
          const e = u * u * (3 - 2 * u);
          fish.position.set(fx0 + (tip[0] - fx0) * e, -0.35 + (tip[1] - 0.45 + 0.35) * e, fz0 + (tip[2] - fz0) * e);
          // Hanging nose-up from the line, wriggling.
          fish.rotation.set(Math.PI / 2 * e, 0, 0.4 * Math.sin(now * 14));
        }
      }
    }
    line.visible = out;
    if (floatRef.current) floatRef.current.visible = out;
    if (!out) return;
    // The float sits on the water (the boat frame's y = 0 is the
    // waterline) and dips hard when a fish takes it.
    const dip = f.phase === 'bite' || f.phase === 'fight' ? -0.12 + 0.08 * Math.sin(now * 18) : 0.02 * Math.sin(now * 2.1);
    const fx = tip[0] + side * 0.8;
    const fy = dip - 0.02 * (vessel.sea - 1);
    const fz = tip[2] - 0.4;
    const p = (geo.attributes.position as THREE.BufferAttribute).array as Float32Array;
    p[0] = tip[0]; p[1] = tip[1]; p[2] = tip[2];
    p[3] = fx; p[4] = fy + 0.05; p[5] = fz;
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    geo.computeBoundingSphere();
    if (floatRef.current) floatRef.current.position.set(fx, fy, fz);
  });
  return (
    <>
      <primitive object={line} />
      <mesh ref={floatRef} visible={false}>
        <sphereGeometry args={[0.07, 10, 8]} />
        <meshStandardMaterial color="#e2483c" roughness={0.5} />
      </mesh>
      <group ref={fishRef} visible={false}>
        <mesh scale={[0.075, 0.1, 0.22]}>
          <sphereGeometry args={[1, 10, 8]} />
          <meshStandardMaterial color="#c9d6e3" roughness={0.35} metalness={0.3} />
        </mesh>
        <mesh position={[0, 0, 0.27]} rotation={[-Math.PI / 2, 0, 0]} scale={[0.35, 1.2, 1]}>
          <coneGeometry args={[0.09, 0.16, 4]} />
          <meshStandardMaterial color="#c9d6e3" roughness={0.5} side={THREE.DoubleSide} />
        </mesh>
      </group>
    </>
  );
}

/**
 * The oars out through the rowlocks while someone rows: they sweep with
 * the stroke (one side harder when turning). Stowed on deck otherwise.
 */
function OarsOut({ vessel, boatKey, benchZ }: { vessel: Vessel; boatKey?: string; benchZ: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const sweepRefs = useRef<(THREE.Group | null)[]>([]);
  const phase = useRef(0);
  const lastT = useRef(0);
  const hb = hullHalfBeam(tAt(benchZ));
  useFrame((_, dt) => {
    const g = groupRef.current;
    if (!g) return;
    const localRower = !!boatKey && getCrewRole() === 'oars' && getCrewBoatKey() === boatKey;
    const row = vessel.cmd.row;
    const turn = vessel.cmd.rowTurn;
    const pulling = Math.abs(row) > 0.05 || Math.abs(turn) > 0.05;
    const out = localRower || pulling;
    g.visible = out;
    // Hide the stowed pair while the oars are out.
    g.parent?.children.forEach((c) => { if (c.name === 'stowed-oar') c.visible = !out; });
    if (!out) return;
    const step = Math.min(0.1, dt || 0.016);
    lastT.current += step;
    if (pulling) phase.current += step * 2.6;
    [1, -1].forEach((side, i) => {
      const r = sweepRefs.current[i];
      if (!r) return;
      // Turning to starboard pulls the port oar harder, and the reverse.
      const strength = Math.min(1, Math.abs(row - side * turn * 0.8));
      r.rotation.y = pulling ? side * 0.45 * strength * Math.sin(phase.current) : 0;
    });
  });
  return (
    <group ref={groupRef} visible={false}>
      {[1, -1].map((side, i) => (
        <group key={`oar-out-${side}`} position={[side * hb, BOAT_DECK_Y + 0.35, benchZ]}>
          <group ref={(el) => { sweepRefs.current[i] = el; }}>
            <group rotation={[0, 0, side * -0.45]}>
              <mesh position={[side * 0.5, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.03, 0.03, 3.2, 6]} />
                <meshStandardMaterial color={HULL} roughness={0.7} />
              </mesh>
              <mesh position={[side * 1.85, 0, 0]}>
                <boxGeometry args={[0.55, 0.03, 0.16]} />
                <meshStandardMaterial color={HULL} roughness={0.7} />
              </mesh>
            </group>
          </group>
        </group>
      ))}
    </group>
  );
}
