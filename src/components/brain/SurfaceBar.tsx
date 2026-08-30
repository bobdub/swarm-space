import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import { getBuilderBlockEngine } from '@/lib/brain/builderBlockEngine';
import { BuilderBlockView } from '@/components/brain/builder/BuilderBlockView';
import { COMPOUND_TABLE } from '@/lib/virtualHub/compoundCatalog';
import { useBarLightsOn } from '@/lib/brain/barLightsStore';
import { BarLightSwitchButton } from '@/components/brain/BarLightSwitchButton';
import { registerPubAnchor, registerPubSeatAnchor } from '@/lib/world/pubAnchors';

/**
 * SurfaceBar — minimal walkable bar: four walls, a flat roof, and an
 * open doorway on the south side. Replaces the previous WetWorkHabitat
 * "town" prefab while we figure out interactive landmarks.
 *
 * Collision is real: every wall segment is its own BuilderBlock so the
 * BuilderBlockEngine stamps a curvature basin (via pinSupportBasin) at
 * the segment's live world position each tick. The avatar's body
 * follows 𝒞_collide = −∇Π(u), so it gets pushed out of those basins
 * instead of phasing through. The doorway is just an absent segment —
 * no basin there, so players walk straight in.
 */

// Bar footprint (metres, local tangent frame: +X right, +Z forward).
// Sized for future fit-out: bar counter along the back wall, a cluster
// of tables + stools in the middle, a games nook to one side, and
// plenty of circulation space for avatars.
const HALF_W = 12;     // half-width along right axis (X) → 24 m wide
const HALF_D = 10;     // half-depth along forward axis (Z) → 20 m deep
const WALL_H = 4.0;    // wall height
const WALL_T = 0.5;    // wall thickness
const SEG_LEN = 2.5;   // length of one wall segment / basin spacing
const SEG_BASIN = 1.4; // collision basin radius per segment
const DOOR_HALF = 1.4; // half-width of the doorway opening (south wall)

const WOOD = COMPOUND_TABLE.door_single.color;
const STONE = COMPOUND_TABLE.wall_half.color;
const ROOF_COLOR = COMPOUND_TABLE.wall_half.color;

// Furniture palette — tuned to read against the stone walls.
const COUNTER_COLOR = '#5a3a22';   // dark stained oak bar counter
const COUNTER_TOP_COLOR = '#2a1a10'; // near-black lacquered top
const TABLE_COLOR = '#7a5230';     // lighter pub table
const STOOL_COLOR = '#1f1f1f';     // black leather stool
const SIGN_BG = '#1a0f08';
const SIGN_TEXT = '#f4c46a';       // warm amber neon

// Lighting palette — warm interior tungsten + cool accent.
const CEILING_LIGHT_COLOR = '#ffd9a8';   // warm tungsten
const SCONCE_LIGHT_COLOR = '#ffb070';    // amber sconce
const FIXTURE_OFF_COLOR = '#1a1410';     // dim when switched off

// Bar counter sits parallel to the north wall, leaving a 2m walkway behind
// it for the bartender. Counter is 10m long, 1m deep, 1.1m tall.
const COUNTER_LEN = 10;
const COUNTER_DEPTH = 1.0;
const COUNTER_H = 1.1;
const COUNTER_FORWARD = HALF_D - 2.5; // 2.5m clearance from back wall
const COUNTER_SEGS = 5; // basin coverage along the counter

// Stool layout — 4 stools along the customer side of the counter.
const STOOL_COUNT = 4;
const STOOL_R = 0.35;
const STOOL_H = 0.85;
const STOOL_FORWARD = COUNTER_FORWARD - COUNTER_DEPTH / 2 - 0.7;

// Games nook — dartboard on the west wall, card table in front of it.
const DARTS_H = 1.73;          // regulation bull height
const DARTS_R = 0.34;
const CARD_TABLE_R = 0.9;
const CARD_TABLE_H = 0.95;

// One pub table + 2 stools in the middle of the room.
const TABLE_R = 0.7;
const TABLE_H = 1.0;

type SegmentSpec = {
  id: string;
  rightOffset: number;
  forwardOffset: number;
  /** 'x' = wall runs along right axis; 'z' = wall runs along forward axis. */
  axis: 'x' | 'z';
  length: number;
};

function buildSegments(): SegmentSpec[] {
  const segs: SegmentSpec[] = [];
  // Helper to lay segments along an axis between two coords.
  const stripX = (z: number, fromX: number, toX: number, idPrefix: string) => {
    const total = toX - fromX;
    const count = Math.max(1, Math.round(total / SEG_LEN));
    const step = total / count;
    for (let i = 0; i < count; i++) {
      const cx = fromX + step * (i + 0.5);
      segs.push({ id: `${idPrefix}-${i}`, rightOffset: cx, forwardOffset: z, axis: 'x', length: step });
    }
  };
  const stripZ = (x: number, fromZ: number, toZ: number, idPrefix: string) => {
    const total = toZ - fromZ;
    const count = Math.max(1, Math.round(total / SEG_LEN));
    const step = total / count;
    for (let i = 0; i < count; i++) {
      const cz = fromZ + step * (i + 0.5);
      segs.push({ id: `${idPrefix}-${i}`, rightOffset: x, forwardOffset: cz, axis: 'z', length: step });
    }
  };
  // North wall (back): forward = +HALF_D, full width.
  stripX(+HALF_D, -HALF_W, +HALF_W, 'wall-n');
  // South wall (front, with doorway): forward = -HALF_D, two strips skipping the door.
  stripX(-HALF_D, -HALF_W, -DOOR_HALF, 'wall-s-l');
  stripX(-HALF_D, +DOOR_HALF, +HALF_W, 'wall-s-r');
  // East wall: right = +HALF_W, full depth.
  stripZ(+HALF_W, -HALF_D, +HALF_D, 'wall-e');
  // West wall: right = -HALF_W.
  stripZ(-HALF_W, -HALF_D, +HALF_D, 'wall-w');
  return segs;
}

export function SurfaceBar({
  anchorPeerId,
  rightOffset = -22,
  forwardOffset = 26,
  id = 'bar-01',
}: {
  anchorPeerId: string;
  rightOffset?: number;
  forwardOffset?: number;
  id?: string;
}) {
  const segments = useMemo(buildSegments, []);

  // Stable list of (block id, body id, segment) tuples for this bar.
  const blocks = useMemo(() => {
    return segments.map((seg) => {
      const blockId = `${id}:${seg.id}:${anchorPeerId}`;
      return { seg, blockId, bodyId: `bar-wall:${blockId}` };
    });
  }, [segments, id, anchorPeerId]);

  // Roof is a single block centred on the bar.
  const roofBlockId = `${id}:roof:${anchorPeerId}`;
  const roofBodyId = `bar-roof:${roofBlockId}`;

  // ── Furniture blocks ──────────────────────────────────────────────
  // Each piece is its own BuilderBlock so collision works (the avatar
  // can't phase through the counter or tables).
  const furniture = useMemo(() => {
    const items: Array<{
      kind: string;
      blockId: string;
      bodyId: string;
      rightOffset: number;
      forwardOffset: number;
      upOffset: number;
      basin: number;
      mass: number;
      meta: Record<string, unknown>;
    }> = [];

    // Bar counter — split into segments so the basin covers the whole length.
    const segStep = COUNTER_LEN / COUNTER_SEGS;
    for (let i = 0; i < COUNTER_SEGS; i++) {
      const cx = -COUNTER_LEN / 2 + segStep * (i + 0.5);
      const blockId = `${id}:counter-${i}:${anchorPeerId}`;
      items.push({
        kind: 'bar-counter',
        blockId,
        bodyId: `bar-counter:${blockId}`,
        rightOffset: cx,
        forwardOffset: COUNTER_FORWARD,
        upOffset: COUNTER_H / 2,
        basin: 0.9,
        mass: 30,
        meta: { length: segStep, depth: COUNTER_DEPTH, height: COUNTER_H },
      });
    }

    // Stools at the counter (customer side, south of counter).
    const stoolSpan = COUNTER_LEN - 1.5;
    for (let i = 0; i < STOOL_COUNT; i++) {
      const denom = STOOL_COUNT - 1;
      const t = denom <= 0 ? 0.5 : i / denom;
      const cx = -stoolSpan / 2 + stoolSpan * t;
      const blockId = `${id}:stool-c-${i}:${anchorPeerId}`;
      items.push({
        kind: 'bar-stool',
        blockId,
        bodyId: `bar-stool:${blockId}`,
        rightOffset: cx,
        forwardOffset: STOOL_FORWARD,
        upOffset: STOOL_H / 2,
        basin: 0.45,
        mass: 6,
        meta: { radius: STOOL_R, height: STOOL_H },
      });
    }

    // Central pub table.
    const tableX = 2;
    const tableZ = -2;
    items.push({
      kind: 'bar-table',
      blockId: `${id}:table-1:${anchorPeerId}`,
      bodyId: `bar-table:${id}:table-1:${anchorPeerId}`,
      rightOffset: tableX,
      forwardOffset: tableZ,
      upOffset: TABLE_H / 2,
      basin: 0.85,
      mass: 15,
      meta: { radius: TABLE_R, height: TABLE_H },
    });
    // Two stools either side of the central table.
    for (let i = 0; i < 2; i++) {
      const dx = i === 0 ? -1.4 : 1.4;
      const blockId = `${id}:stool-t-${i}:${anchorPeerId}`;
      items.push({
        kind: 'bar-stool',
        blockId,
        bodyId: `bar-stool:${blockId}`,
        rightOffset: tableX + dx,
        forwardOffset: tableZ,
        upOffset: STOOL_H / 2,
        basin: 0.45,
        mass: 6,
        meta: { radius: STOOL_R, height: STOOL_H },
      });
    }

    // ── Games nook (west side) ──────────────────────────────────────
    // Dartboard hangs on the interior face of the west wall.
    items.push({
      kind: 'darts-board',
      blockId: `${id}:darts-1:${anchorPeerId}`,
      bodyId: `darts-board:${id}:darts-1:${anchorPeerId}`,
      rightOffset: -HALF_W + WALL_T / 2 + 0.06,
      forwardOffset: -3,
      upOffset: DARTS_H,
      basin: 0,
      mass: 3,

      meta: { radius: DARTS_R },
    });
    // Card table in the same nook — meshes now, Hold'em later.
    items.push({
      kind: 'card-table',
      blockId: `${id}:cards-1:${anchorPeerId}`,
      bodyId: `card-table:${id}:cards-1:${anchorPeerId}`,
      rightOffset: -HALF_W + 3.5,
      forwardOffset: 3,
      upOffset: CARD_TABLE_H / 2,
      basin: 0.3,
      mass: 25,
      meta: { radius: CARD_TABLE_R, height: CARD_TABLE_H },
    });
    for (let i = 0; i < 4; i++) {
      const ang = (Math.PI / 2) * i + Math.PI / 4;
      const blockId = `${id}:stool-cards-${i}:${anchorPeerId}`;
      items.push({
        kind: 'bar-stool',
        blockId,
        bodyId: `bar-stool:${blockId}`,
        rightOffset: -HALF_W + 3.5 + Math.cos(ang) * 1.6,
        forwardOffset: 3 + Math.sin(ang) * 1.6,
        upOffset: STOOL_H / 2,
        basin: 0.45,
        mass: 6,
        meta: { radius: STOOL_R, height: STOOL_H },
      });
    }

    return items;
  }, [id, anchorPeerId]);

  // Proximity anchors — the pub IS the interface, so interactables
  // register their live BuilderBlock body and the proximity hook does
  // the rest. Tags match src/lib/world/barInteractions.ts.
  useEffect(() => {
    const cleanups: Array<() => void> = [];
    const dart = furniture.find((f) => f.kind === 'darts-board');
    if (dart) {
      cleanups.push(registerPubAnchor({
        key: dart.bodyId,
        tag: 'darts-board',
        bodyId: dart.bodyId,
        tableId: `pub:darts:${id}`,
      }));
    }
    const cards = furniture.find((f) => f.kind === 'card-table');
    if (cards) {
      cleanups.push(registerPubAnchor({
        key: cards.bodyId,
        tag: 'card-table',
        bodyId: cards.bodyId,
        tableId: `pub:cards:${id}`,
      }));
      // Stools around the card table become claimable seats.
      furniture
        .filter((f) => f.blockId.includes(':stool-cards-'))
        .forEach((stool, index) => {
          cleanups.push(registerPubSeatAnchor({
            tableId: `pub:cards:${id}`,
            index,
            bodyId: stool.bodyId,
            height: (stool.meta?.height as number) ?? 0.85,
          }));
        });
    }
    return () => { cleanups.forEach((fn) => fn()); };
  }, [furniture, id]);


  // Wall sign — mounted on the inside of the north wall, behind the counter.
  const signBlockId = `${id}:sign:${anchorPeerId}`;
  const signBodyId = `bar-sign:${signBlockId}`;
  const SIGN_W = 4;
  const SIGN_H = 1.2;

  // ── Interior lighting state ───────────────────────────────────────
  // Driven by a plain external store toggled from a DOM overlay button
  // in BrainUniverseScene. Keeping the toggle outside the 3D scene
  // graph is what makes it 100% reliable — the click is a normal HTML
  // button click, never a WebGL raycast.
  const lightsOn = useBarLightsOn();
  const signOn = true;

  // Ceiling fixture grid (positions are local to the roof block centre).
  const ceilingFixtures = useMemo(() => {
    const xs = [-HALF_W * 0.55, 0, +HALF_W * 0.55];
    const zs = [-HALF_D * 0.5, +HALF_D * 0.5];
    const out: Array<{ x: number; z: number }> = [];
    for (const x of xs) for (const z of zs) out.push({ x, z });
    return out;
  }, []);

  // Wall sconces — positions local to the roof block centre, with a
  // wall-normal so we can rotate the fixture to face inward.
  const wallSconces = useMemo(() => {
    const list: Array<{ x: number; z: number; nx: number; nz: number }> = [];
    // North wall (back) — 3 sconces
    for (const x of [-HALF_W * 0.6, 0, +HALF_W * 0.6]) {
      list.push({ x, z: +HALF_D - 0.3, nx: 0, nz: -1 });
    }
    // South wall (front) — 2 sconces, skipping the doorway
    for (const x of [-HALF_W * 0.6, +HALF_W * 0.6]) {
      list.push({ x, z: -HALF_D + 0.3, nx: 0, nz: +1 });
    }
    // East/West walls — 2 each
    for (const z of [-HALF_D * 0.5, +HALF_D * 0.5]) {
      list.push({ x: +HALF_W - 0.3, z, nx: -1, nz: 0 });
      list.push({ x: -HALF_W + 0.3, z, nx: +1, nz: 0 });
    }
    return list;
  }, []);


  useEffect(() => {
    const engine = getBuilderBlockEngine();
    for (const { seg, blockId } of blocks) {
      engine.placeBlock({
        id: blockId,
        kind: 'bar-wall',
        anchorPeerId,
        rightOffset: rightOffset + seg.rightOffset,
        forwardOffset: forwardOffset + seg.forwardOffset,
        upOffset: WALL_H / 2,
        mass: 40,
        basin: SEG_BASIN,
        meta: { axis: seg.axis, length: seg.length },
      });
    }
    engine.placeBlock({
      id: roofBlockId,
      kind: 'bar-roof',
      anchorPeerId,
      rightOffset,
      forwardOffset,
      upOffset: WALL_H + 0.15,
      mass: 120,
      basin: 0.6,
      meta: { width: HALF_W * 2, depth: HALF_D * 2 },
    });
    for (const f of furniture) {
      engine.placeBlock({
        id: f.blockId,
        kind: f.kind,
        anchorPeerId,
        rightOffset: rightOffset + f.rightOffset,
        forwardOffset: forwardOffset + f.forwardOffset,
        upOffset: f.upOffset,
        mass: f.mass,
        basin: f.basin,
        meta: f.meta,
      });
    }
    engine.placeBlock({
      id: signBlockId,
      kind: 'bar-sign',
      anchorPeerId,
      rightOffset,
      forwardOffset: forwardOffset + HALF_D - WALL_T / 2 - 0.05,
      upOffset: 2.4,
      mass: 4,
      basin: 0.2,
      meta: { width: SIGN_W, height: SIGN_H, text: 'THE WET WORK' },
    });
    return () => {
      for (const { blockId } of blocks) engine.removeBlock(blockId, 'bar-wall');
      engine.removeBlock(roofBlockId, 'bar-roof');
      for (const f of furniture) engine.removeBlock(f.blockId, f.kind);
      engine.removeBlock(signBlockId, 'bar-sign');
    };
  }, [blocks, anchorPeerId, rightOffset, forwardOffset, roofBlockId, furniture, signBlockId]);

  return (
    <>
      {blocks.map(({ seg, bodyId }) => (
        <BuilderBlockView key={bodyId} bodyId={bodyId}>
          {() => {
            const dimX = seg.axis === 'x' ? seg.length : WALL_T;
            const dimZ = seg.axis === 'z' ? seg.length : WALL_T;
            return (
              <mesh position={[0, 0, 0]} castShadow receiveShadow>
                <boxGeometry args={[dimX, WALL_H, dimZ]} />
                {/* DoubleSide: the follow camera can dip inside the wall
                    volume; with FrontSide the faces are culled from within
                    and you see straight through the bar. */}
                <meshStandardMaterial color={STONE} roughness={0.85} side={THREE.DoubleSide} />
              </mesh>
            );
          }}
        </BuilderBlockView>
      ))}
      <BuilderBlockView bodyId={roofBodyId}>
        {() => (
          <group>
            {/* Flat roof slab */}
            <mesh position={[0, 0, 0]} castShadow receiveShadow>
              <boxGeometry args={[HALF_W * 2 + WALL_T, 0.3, HALF_D * 2 + WALL_T]} />
              <meshStandardMaterial color={ROOF_COLOR} roughness={0.7} side={THREE.DoubleSide} />
            </mesh>
            {/* Doorway lintel — visual cap above the open south doorway. */}
            <mesh
              position={[0, -0.45, -HALF_D]}
              castShadow
            >
              <boxGeometry args={[DOOR_HALF * 2 + 0.2, 0.6, WALL_T]} />
              <meshStandardMaterial color={WOOD} roughness={0.8} side={THREE.DoubleSide} />
            </mesh>

            {/* Ceiling lights — disc fixtures hanging just below the roof slab. */}
            {ceilingFixtures.map((f, i) => (
              <group key={`ceil-${i}`} position={[f.x, -0.2, f.z]}>
                <mesh castShadow>
                  <cylinderGeometry args={[0.32, 0.32, 0.08, 18]} />
                  <meshStandardMaterial
                    color={lightsOn ? CEILING_LIGHT_COLOR : FIXTURE_OFF_COLOR}
                    emissive={lightsOn ? CEILING_LIGHT_COLOR : '#000'}
                    emissiveIntensity={lightsOn ? 1.6 : 0}
                    roughness={0.4}
                  />
                </mesh>
                {lightsOn && (
                  <pointLight
                    position={[0, -0.1, 0]}
                    color={CEILING_LIGHT_COLOR}
                    intensity={4.5}
                    distance={14}
                    decay={1.6}
                  />
                )}
              </group>
            ))}

            {/* Wall sconces — small emissive boxes mounted high on each wall. */}
            {wallSconces.map((s, i) => {
              // Position sconce ~0.8m below ceiling.
              const y = -WALL_H * 0.35;
              return (
                <group key={`sc-${i}`} position={[s.x, y, s.z]}>
                  <mesh castShadow>
                    <boxGeometry args={[0.35, 0.35, 0.18]} />
                    <meshStandardMaterial
                      color={lightsOn ? SCONCE_LIGHT_COLOR : FIXTURE_OFF_COLOR}
                      emissive={lightsOn ? SCONCE_LIGHT_COLOR : '#000'}
                      emissiveIntensity={lightsOn ? 1.3 : 0}
                      roughness={0.5}
                    />
                  </mesh>
                  {lightsOn && (
                    <pointLight
                      position={[s.nx * 0.4, 0, s.nz * 0.4]}
                      color={SCONCE_LIGHT_COLOR}
                      intensity={2.2}
                      distance={8}
                      decay={1.8}
                    />
                  )}
                </group>
              );
            })}

            {/* Bar Lights switch — DOM button mounted on the interior face
                of the south wall, just to the right of the doorway. Uses
                drei <Html> so the click is a real DOM click (never a raycast). */}
            <Html
              position={[DOOR_HALF + 0.4, 1.3 - (WALL_H + 0.15), -HALF_D + WALL_T / 2 + 0.01]}
              center
              distanceFactor={8}
              zIndexRange={[50, 0]}
              style={{ pointerEvents: 'auto' }}
            >
              <BarLightSwitchButton variant="wall" />
            </Html>

          </group>
        )}
      </BuilderBlockView>
      {furniture.map((f) => (
        <BuilderBlockView key={f.bodyId} bodyId={f.bodyId}>
          {() => {
            if (f.kind === 'bar-counter') {
              const len = (f.meta.length as number) ?? 2;
              return (
                <group>
                  <mesh position={[0, 0, 0]} castShadow receiveShadow>
                    <boxGeometry args={[len, COUNTER_H, COUNTER_DEPTH]} />
                    <meshStandardMaterial color={COUNTER_COLOR} roughness={0.6} />
                  </mesh>
                  <mesh position={[0, COUNTER_H / 2 + 0.03, 0]} castShadow>
                    <boxGeometry args={[len, 0.06, COUNTER_DEPTH + 0.15]} />
                    <meshStandardMaterial color={COUNTER_TOP_COLOR} roughness={0.3} metalness={0.2} />
                  </mesh>
                </group>
              );
            }
            if (f.kind === 'bar-stool') {
              return (
                <group>
                  {/* Pole */}
                  <mesh position={[0, -0.15, 0]} castShadow>
                    <cylinderGeometry args={[0.06, 0.06, STOOL_H - 0.1, 12]} />
                    <meshStandardMaterial color="#3a3a3a" metalness={0.6} roughness={0.4} />
                  </mesh>
                  {/* Seat */}
                  <mesh position={[0, STOOL_H / 2 - 0.05, 0]} castShadow>
                    <cylinderGeometry args={[STOOL_R, STOOL_R, 0.12, 20]} />
                    <meshStandardMaterial color={STOOL_COLOR} roughness={0.7} />
                  </mesh>
                  {/* Base ring */}
                  <mesh position={[0, -STOOL_H / 2 + 0.03, 0]} castShadow>
                    <cylinderGeometry args={[STOOL_R * 0.9, STOOL_R * 0.9, 0.06, 20]} />
                    <meshStandardMaterial color="#2a2a2a" metalness={0.5} roughness={0.5} />
                  </mesh>
                </group>
              );
            }
            if (f.kind === 'darts-board') {
              const r = (f.meta.radius as number) ?? DARTS_R;
              // Cylinder axis runs along local +Y; rotating -90° about Z
              // points that axis INTO the room (world +right from the west
              // wall), so the playing face and its rings sit proud of the
              // backing board instead of buried inside the wall.
              return (
                <group rotation={[0, 0, -Math.PI / 2]}>
                  {/* Backing board */}
                  <mesh castShadow>
                    <cylinderGeometry args={[r + 0.08, r + 0.08, 0.06, 28]} />
                    <meshStandardMaterial color="#1d1206" roughness={0.8} />
                  </mesh>
                  {/* Playing face */}
                  <mesh position={[0, 0.04, 0]}>
                    <cylinderGeometry args={[r, r, 0.02, 32]} />
                    <meshStandardMaterial color="#e8e0cc" roughness={0.6} />
                  </mesh>
                  {/* Alternating scoring wedges */}
                  {Array.from({ length: 10 }).map((_, i) => (
                    <mesh
                      key={`wedge-${i}`}
                      position={[0, 0.052, 0]}
                      rotation={[0, (Math.PI / 10) * i * 2, 0]}
                    >
                      <cylinderGeometry
                        args={[r * 0.94, r * 0.94, 0.004, 24, 1, false, 0, Math.PI / 10]}
                      />
                      <meshStandardMaterial color="#141414" roughness={0.8} />
                    </mesh>
                  ))}
                  {/* Treble + double rings — laid flat in the board plane */}
                  <mesh position={[0, 0.056, 0]} rotation={[Math.PI / 2, 0, 0]}>
                    <torusGeometry args={[r * 0.55, 0.02, 8, 40]} />
                    <meshStandardMaterial color="#8b1a1a" roughness={0.5} />
                  </mesh>
                  <mesh position={[0, 0.056, 0]} rotation={[Math.PI / 2, 0, 0]}>
                    <torusGeometry args={[r * 0.9, 0.02, 8, 40]} />
                    <meshStandardMaterial color="#1f7a3a" roughness={0.5} />
                  </mesh>
                  {/* Outer bull + bull */}
                  <mesh position={[0, 0.058, 0]}>
                    <cylinderGeometry args={[r * 0.16, r * 0.16, 0.006, 20]} />
                    <meshStandardMaterial color="#1f7a3a" roughness={0.5} />
                  </mesh>
                  <mesh position={[0, 0.062, 0]}>
                    <cylinderGeometry args={[r * 0.07, r * 0.07, 0.008, 16]} />
                    <meshStandardMaterial
                      color="#c62828"
                      emissive="#c62828"
                      emissiveIntensity={0.5}
                      roughness={0.4}
                    />
                  </mesh>
                </group>
              );
            }
            if (f.kind === 'card-table') {
              const r = (f.meta.radius as number) ?? CARD_TABLE_R;
              return (
                <group>
                  <mesh position={[0, -0.05, 0]} castShadow>
                    <cylinderGeometry args={[0.12, 0.2, CARD_TABLE_H - 0.1, 12]} />
                    <meshStandardMaterial color="#2a2a2a" metalness={0.4} roughness={0.5} />
                  </mesh>
                  {/* Felt top */}
                  <mesh position={[0, CARD_TABLE_H / 2 - 0.04, 0]} castShadow receiveShadow>
                    <cylinderGeometry args={[r, r, 0.09, 32]} />
                    <meshStandardMaterial color="#14532d" roughness={0.95} />
                  </mesh>
                  {/* Padded rail — a flat ring around the rim, not a hoop */}
                  <mesh
                    position={[0, CARD_TABLE_H / 2 + 0.012, 0]}
                    rotation={[Math.PI / 2, 0, 0]}
                  >
                    <torusGeometry args={[r * 0.94, 0.045, 8, 40]} />
                    <meshStandardMaterial color={COUNTER_COLOR} roughness={0.6} />
                  </mesh>
                  {/* Four card spots so the surface reads as a table */}
                  {Array.from({ length: 4 }).map((_, i) => {
                    const a = (Math.PI / 2) * i + Math.PI / 4;
                    return (
                      <mesh
                        key={`spot-${i}`}
                        position={[Math.cos(a) * r * 0.55, CARD_TABLE_H / 2 + 0.008, Math.sin(a) * r * 0.55]}
                      >
                        <cylinderGeometry args={[0.11, 0.11, 0.004, 16]} />
                        <meshStandardMaterial color="#0f3d22" roughness={0.9} />
                      </mesh>
                    );
                  })}
                </group>
              );
            }

            if (f.kind === 'bar-table') {
              return (
                <group>
                  {/* Pedestal */}
                  <mesh position={[0, -0.05, 0]} castShadow>
                    <cylinderGeometry args={[0.1, 0.15, TABLE_H - 0.1, 12]} />
                    <meshStandardMaterial color="#2a2a2a" metalness={0.4} roughness={0.5} />
                  </mesh>
                  {/* Base */}
                  <mesh position={[0, -TABLE_H / 2 + 0.03, 0]} castShadow>
                    <cylinderGeometry args={[TABLE_R * 0.55, TABLE_R * 0.55, 0.06, 20]} />
                    <meshStandardMaterial color="#2a2a2a" metalness={0.5} roughness={0.5} />
                  </mesh>
                  {/* Top */}
                  <mesh position={[0, TABLE_H / 2 - 0.04, 0]} castShadow receiveShadow>
                    <cylinderGeometry args={[TABLE_R, TABLE_R, 0.08, 24]} />
                    <meshStandardMaterial color={TABLE_COLOR} roughness={0.5} />
                  </mesh>
                </group>
              );
            }
            return null;
          }}
        </BuilderBlockView>
      ))}
      <BuilderBlockView bodyId={signBodyId}>
        {() => (
          <group rotation={[0, Math.PI, 0]}>
            {/* Sign board mounted facing south into the room */}
            <mesh position={[0, 0, 0]} castShadow>
              <boxGeometry args={[SIGN_W, SIGN_H, 0.08]} />
              <meshStandardMaterial color={SIGN_BG} roughness={0.6} />
            </mesh>
            {/* Amber glow letters — emissive bar across the board */}
            <mesh position={[0, 0, 0.05]}>
              <boxGeometry args={[SIGN_W * 0.85, SIGN_H * 0.45, 0.02]} />
              <meshStandardMaterial
                color={signOn ? SIGN_TEXT : FIXTURE_OFF_COLOR}
                emissive={signOn ? SIGN_TEXT : '#000'}
                emissiveIntensity={signOn ? 1.4 : 0}
                roughness={0.3}
              />
            </mesh>
            {signOn && (
              <pointLight
                position={[0, 0, 0.6]}
                color={SIGN_TEXT}
                intensity={1.5}
                distance={5}
                decay={2}
              />
            )}
          </group>
        )}
      </BuilderBlockView>
    </>
  );
}

// Silence unused-import warning when tree-shaking removes THREE.
void THREE;