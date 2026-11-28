import { memo, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import { getBuilderBlockEngine } from '@/lib/brain/builderBlockEngine';
import { BuilderBlockView } from '@/components/brain/builder/BuilderBlockView';
import { COMPOUND_TABLE } from '@/lib/virtualHub/compoundCatalog';
import { useBarLightsOn } from '@/lib/brain/barLightsStore';
import { BarLightSwitchButton } from '@/components/brain/BarLightSwitchButton';
import { registerPubAnchor, registerPubSeatAnchor } from '@/lib/world/pubAnchors';
import { useActiveTableId } from '@/lib/pub/activeTableStore';
import { barStoolOffsets, barStoolTableId, counterColliderOffsets } from '@/lib/pub/barStools';
import { PubLeaveHold } from '@/components/pub/PubLeaveHold';
import { BarSignArt, DonorLeaderboardBoard, DrinksMenuBoard, BAR_SIGN_ASPECT } from '@/components/brain/BarSignage';
import { StarChartBoard } from '@/components/brain/StarChartBoard';
import { setIndoors } from '@/lib/brain/starHuntStore';
import { useFrame } from '@react-three/fiber';

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
const SIGN_TEXT = '#f4c46a';       // warm amber spill light on the sign

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
/** The drinks chalkboard stands on the middle counter segment, facing the room. */
const MENU_W = 0.9;
const MENU_H = 0.75;
// Walk-through guard. Avatar push-out works on circles, so the counter
// carries a row of invisible colliders every half metre; each one's
// radius is the counter's half-depth, so the row reads as a solid slab.
const COUNTER_COLLIDER_R = COUNTER_DEPTH / 2;

// Stool layout — stools along the full customer side of the counter.
const STOOL_R = 0.35;
const STOOL_H = 0.85;
const STOOL_FORWARD = COUNTER_FORWARD - COUNTER_DEPTH / 2 - 0.7;

// Games nook — dartboard on the west wall, card table in front of it.
const DARTS_H = 1.73;          // regulation bull height
const DARTS_R = 0.34;
/** Rolls the dartboard's face axis (local +Y) to local −X, into the room. */
export const DARTS_BOARD_ROLL = Math.PI / 2;
const CARD_TABLE_R = 0.9;
const CARD_TABLE_H = 0.95;

// Signage: the Green Cat & Red Dragon sign over the counter and outside by
// the door, and the donor leaderboard on the back wall behind the card table.
const SIGN_W = 3.6;
const SIGN_H = SIGN_W / BAR_SIGN_ASPECT;
const OUT_SIGN_W = 4.2;
const DONOR_W = 3.4;
const DONOR_H = 2.8;
/**
 * The donor board hangs on the back (north) wall in the far west corner,
 * behind the card table, so it faces you as you walk in the door. It sits
 * just clear of the back wall's west sconce, which lights it.
 */
export const DONOR_RIGHT = -HALF_W + 2.75;
/** Turns the board's face (local +Z) to −forward, south into the room. */
export const DONOR_BOARD_YAW = Math.PI;
/**
 * The four star charts (one per constellation, for the star hunt) hang in a
 * 2 × 2 grid on the west wall in the games nook, to the left of the
 * dartboard as you face it (toward the front wall), clear of the wall
 * sconce. Read them here, then go out after dark and find the figures.
 */
const STARS_W = 1.2;
const STARS_H = 1.5;
const STARS_GAP = 0.1;
/** Grid half-width along the wall (two charts and a gap). */
export const STAR_GRID_HALF = STARS_W + STARS_GAP / 2;
/**
 * Each chart's place in the grid, in the chart group's frame (x along the
 * wall, to your right as you face it; y up). Top row: Cat, Dragon; bottom
 * row: Pirate Ship, Flask, matching the order of CONSTELLATIONS.
 */
const STAR_CHART_SLOTS: Array<{ id: string; x: number; y: number }> = [
  { id: 'cat', x: -(STARS_W + STARS_GAP) / 2, y: (STARS_H + STARS_GAP) / 2 },
  { id: 'dragon', x: (STARS_W + STARS_GAP) / 2, y: (STARS_H + STARS_GAP) / 2 },
  { id: 'ship', x: -(STARS_W + STARS_GAP) / 2, y: -(STARS_H + STARS_GAP) / 2 },
  { id: 'flask', x: (STARS_W + STARS_GAP) / 2, y: -(STARS_H + STARS_GAP) / 2 },
];
export const STAR_CHART_RIGHT = -HALF_W + WALL_T / 2 + 0.08;
export const STAR_CHART_FORWARD = -6.6;
/**
 * Turns the chart's face (local +Z) to local −X, east into the room. The
 * render frame's +X is the site frame's left, so the west wall
 * (−rightOffset) sits on local +X, like the dartboard's.
 */
export const STAR_CHART_YAW = -Math.PI / 2;

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

export const SurfaceBar = memo(function SurfaceBar({
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

  // Invisible colliders that make the counter solid to walk into.
  const counterColliders = useMemo(() => {
    return counterColliderOffsets(COUNTER_LEN).map((x, i) => ({
      blockId: `${id}:counter-solid-${i}:${anchorPeerId}`,
      rightOffset: x,
    }));
  }, [id, anchorPeerId]);

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
    barStoolOffsets(COUNTER_LEN).forEach((cx, i) => {
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
    });

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
    // The whole counter is the bar: walk up anywhere along it to order.
    furniture
      .filter((f) => f.kind === 'bar-counter')
      .forEach((seg) => {
        cleanups.push(registerPubAnchor({
          key: seg.bodyId,
          tag: 'bar-counter',
          bodyId: seg.bodyId,
          tableId: `pub:bar:${id}`,
        }));
      });
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
    // Every stool along the counter is its own one-seat perch.
    furniture
      .filter((f) => f.blockId.includes(':stool-c-'))
      .forEach((stool, index) => {
        const tableId = barStoolTableId(id, index);
        cleanups.push(registerPubAnchor({
          key: stool.bodyId,
          tag: 'bar-stool',
          bodyId: stool.bodyId,
          tableId,
        }));
        cleanups.push(registerPubSeatAnchor({
          tableId,
          index: 0,
          bodyId: stool.bodyId,
          height: (stool.meta?.height as number) ?? STOOL_H,
        }));
      });
    return () => { cleanups.forEach((fn) => fn()); };
  }, [furniture, id]);


  // Wall sign — "The Green Cat & Red Dragon" art, mounted on the inside of
  // the north wall over the counter.
  const signBlockId = `${id}:sign:${anchorPeerId}`;
  const signBodyId = `bar-sign:${signBlockId}`;
  // The same sign outside, on the front (south) wall beside the doorway.
  const outSignBlockId = `${id}:sign-out:${anchorPeerId}`;
  const outSignBodyId = `bar-sign:${outSignBlockId}`;
  // Donor leaderboard on the back wall behind the card table, facing the door.
  const donorBlockId = `${id}:donors:${anchorPeerId}`;
  const donorBodyId = `bar-donors:${donorBlockId}`;
  // The four star charts for the star hunt, beside the dartboard facing into the room.
  const starsBlockId = `${id}:stars:${anchorPeerId}`;
  const starsBodyId = `bar-stars:${starsBlockId}`;

  // ── Interior lighting state ───────────────────────────────────────
  // Driven by a plain external store toggled from a DOM overlay button
  // in BrainUniverseScene. Keeping the toggle outside the 3D scene
  // graph is what makes it 100% reliable — the click is a normal HTML
  // button click, never a WebGL raycast.
  const lightsOn = useBarLightsOn();
  // Which of this bar's games the local player is at, for the in-world
  // "hold to leave" buttons.
  const activeTableId = useActiveTableId();
  const atDarts = activeTableId === `pub:darts:${id}`;
  const atCards = activeTableId === `pub:cards:${id}`;
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
    // North wall (back) — 2 sconces; the centre spot is the sign over the counter.
    for (const x of [-HALF_W * 0.6, +HALF_W * 0.6]) {
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
    for (const c of counterColliders) {
      engine.placeBlock({
        id: c.blockId,
        kind: 'bar-counter-solid',
        anchorPeerId,
        rightOffset: rightOffset + c.rightOffset,
        forwardOffset: forwardOffset + COUNTER_FORWARD,
        upOffset: COUNTER_H / 2,
        mass: 30,
        basin: 0, // collision only; the counter segments own the field basin
        meta: { solidRadius: COUNTER_COLLIDER_R },
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
      meta: { width: SIGN_W, height: SIGN_H, text: 'The Green Cat & Red Dragon' },
    });
    engine.placeBlock({
      id: outSignBlockId,
      kind: 'bar-sign',
      anchorPeerId,
      rightOffset: rightOffset + DOOR_HALF + 0.4 + OUT_SIGN_W / 2,
      forwardOffset: forwardOffset - HALF_D - WALL_T / 2 - 0.03,
      upOffset: 2.3,
      mass: 4,
      basin: 0,
      meta: { width: OUT_SIGN_W, text: 'The Green Cat & Red Dragon' },
    });
    engine.placeBlock({
      id: donorBlockId,
      kind: 'bar-donors',
      anchorPeerId,
      rightOffset: rightOffset + DONOR_RIGHT,
      forwardOffset: forwardOffset + HALF_D - WALL_T / 2 - 0.08,
      upOffset: 2.0,
      mass: 4,
      basin: 0,
      meta: { width: DONOR_W, height: DONOR_H },
    });
    engine.placeBlock({
      id: starsBlockId,
      kind: 'bar-stars',
      anchorPeerId,
      rightOffset: rightOffset + STAR_CHART_RIGHT,
      forwardOffset: forwardOffset + STAR_CHART_FORWARD,
      upOffset: 2.0,
      mass: 4,
      basin: 0,
      meta: { width: STAR_GRID_HALF * 2, height: STARS_H * 2 + STARS_GAP },
    });
    return () => {
      for (const { blockId } of blocks) engine.removeBlock(blockId, 'bar-wall');
      engine.removeBlock(roofBlockId, 'bar-roof');
      for (const f of furniture) engine.removeBlock(f.blockId, f.kind);
      for (const c of counterColliders) engine.removeBlock(c.blockId, 'bar-counter-solid');
      engine.removeBlock(signBlockId, 'bar-sign');
      engine.removeBlock(outSignBlockId, 'bar-sign');
      engine.removeBlock(donorBlockId, 'bar-donors');
      engine.removeBlock(starsBlockId, 'bar-stars');
    };
  }, [blocks, anchorPeerId, rightOffset, forwardOffset, roofBlockId, furniture, counterColliders, signBlockId, outSignBlockId, donorBlockId, starsBlockId]);

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
            <IndoorsProbe />
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
                  {f.blockId.includes(':counter-2:') && (
                    // Turned like the sign above it to face south, leaning back a touch.
                    <group position={[0, COUNTER_H / 2 + 0.06 + MENU_H / 2, 0.1]} rotation={[0, Math.PI, 0]}>
                      <group rotation={[-0.18, 0, 0]}>
                        <DrinksMenuBoard width={MENU_W} height={MENU_H} />
                      </group>
                    </group>
                  )}
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
              // Cylinder axis runs along local +Y; rolling +90° about Z
              // points that axis along local −X, which is INTO the room from
              // the west wall (local +X is the site frame's left, so the west
              // wall sits on +X). The playing face and its rings then sit
              // proud of the backing board instead of facing the stone.
              return (
                <group>
                {atDarts && (
                  // Hold-to-leave sits on the wall just beside the board.
                  <Html
                    position={[0.12, 0, r + 0.45]}
                    center
                    distanceFactor={6}
                    zIndexRange={[60, 0]}
                    style={{ pointerEvents: 'auto' }}
                  >
                    <PubLeaveHold />
                  </Html>
                )}
                <group rotation={[0, 0, DARTS_BOARD_ROLL]}>
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
                  {atCards && (
                    // Hold-to-leave in the middle of the felt.
                    <Html
                      position={[0, CARD_TABLE_H / 2 + 0.12, 0]}
                      center
                      distanceFactor={6}
                      zIndexRange={[60, 0]}
                      style={{ pointerEvents: 'auto' }}
                    >
                      <PubLeaveHold />
                    </Html>
                  )}
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
            {/* The Green Cat & Red Dragon, facing south into the room over the counter */}
            <BarSignArt width={SIGN_W} glow={0.3} />
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
      <BuilderBlockView bodyId={outSignBodyId}>
        {() => (
          // Outside face of the south wall, facing out toward the approach.
          <group rotation={[0, Math.PI, 0]}>
            <BarSignArt width={OUT_SIGN_W} glow={0.35} />
          </group>
        )}
      </BuilderBlockView>
      <BuilderBlockView bodyId={donorBodyId}>
        {() => (
          // Inside face of the back wall, turned to face south toward the door.
          <group rotation={[0, DONOR_BOARD_YAW, 0]}>
            <DonorLeaderboardBoard width={DONOR_W} height={DONOR_H} />
          </group>
        )}
      </BuilderBlockView>
      <BuilderBlockView bodyId={starsBodyId}>
        {() => (
          <group rotation={[0, STAR_CHART_YAW, 0]}>
            {STAR_CHART_SLOTS.map((slot) => (
              <group key={slot.id} position={[slot.x, slot.y, 0]}>
                <StarChartBoard chartId={slot.id} width={STARS_W} height={STARS_H} />
              </group>
            ))}
          </group>
        )}
      </BuilderBlockView>
    </>
  );
});

// Silence unused-import warning when tree-shaking removes THREE.
void THREE;

/**
 * Tells the star hunt whether the camera is under the bar's roof (you can't
 * find stars through it). Lives in the roof block's local frame: origin at
 * the roof's centre, x = right, z = forward, y = up.
 */
function IndoorsProbe() {
  const ref = useRef<THREE.Group>(null);
  const local = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ camera }) => {
    if (!ref.current) return;
    local.copy(camera.position);
    ref.current.worldToLocal(local);
    setIndoors(Math.abs(local.x) < HALF_W + WALL_T && Math.abs(local.z) < HALF_D + WALL_T && local.y < 0);
  });
  useEffect(() => () => setIndoors(false), []);
  return <group ref={ref} />;
}
