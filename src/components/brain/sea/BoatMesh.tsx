/**
 * BoatMesh — the village boat, built from code (no imported model).
 *
 * Local frame: +Y up (out of the sea), −Z toward the bow, +X starboard.
 * y = 0 is the waterline. The hull is lofted from cross-sections; the
 * deck, rail, mast, furled sail, wheel, rowing bench, stowed oars and the
 * stern ladder are plain primitives sized from the plan:
 * 7 m long, 2.6 m beam, 0.6 m draft, deck 0.5 m above the water.
 */

import { useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { COMPOUND_TABLE } from '@/lib/virtualHub/compoundCatalog';
import { BOAT_DECK_Y, BOAT_GATE_HALF, BOAT_RAIL_H } from '@/lib/brain/sea/boatSpec';
import type { Vessel } from '@/lib/brain/sea/vessel';
import { startMastHold, stopMastHold } from '@/lib/brain/sea/crew';
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

export function BoatMesh({ vessel }: { vessel: Vessel }) {
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
  const sailGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    // Triangle in the boom group's frame: luff up the mast, foot along the boom.
    const top = mastH - 0.5 - (boomY - BOAT_DECK_Y);
    g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.05, 0.1, 0, top, 0.05, 0, 0.05, boomLen - 0.1], 3));
    g.computeVertexNormals();
    return g;
  }, [boomLen, boomY]);
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
      {[1, -1].map((side) => (
        <group key={`oar-${side}`} position={[side * 0.75, BOAT_DECK_Y + 0.08, 0.2]}>
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

function Line({ from, to }: { from: [number, number, number]; to: [number, number, number] }) {
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
      <cylinderGeometry args={[0.012, 0.012, length, 4]} />
      <meshStandardMaterial color={ROPE} roughness={0.9} />
    </mesh>
  );
}

