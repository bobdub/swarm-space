import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { getBuilderBlockEngine } from '@/lib/brain/builderBlockEngine';
import { BuilderBlockView } from '@/components/brain/builder/BuilderBlockView';
import { COMPOUND_TABLE } from '@/lib/virtualHub/compoundCatalog';

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
    return () => {
      for (const { blockId } of blocks) engine.removeBlock(blockId, 'bar-wall');
      engine.removeBlock(roofBlockId, 'bar-roof');
    };
  }, [blocks, anchorPeerId, rightOffset, forwardOffset, roofBlockId]);

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
                <meshStandardMaterial color={STONE} roughness={0.85} />
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
              <meshStandardMaterial color={ROOF_COLOR} roughness={0.7} />
            </mesh>
            {/* Doorway lintel — visual cap above the open south doorway. */}
            <mesh
              position={[0, -0.45, -HALF_D]}
              castShadow
            >
              <boxGeometry args={[DOOR_HALF * 2 + 0.2, 0.6, WALL_T]} />
              <meshStandardMaterial color={WOOD} roughness={0.8} />
            </mesh>
          </group>
        )}
      </BuilderBlockView>
    </>
  );
}

// Silence unused-import warning when tree-shaking removes THREE.
void THREE;