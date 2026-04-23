import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  FEET_SHELL_RADIUS,
  EARTH_RADIUS,
  getEarthPose,
  getEarthLocalSiteFrame,
  earthLocalToWorld,
} from '@/lib/brain/earth';
import { COMPOUND_TABLE } from '@/lib/virtualHub/compoundCatalog';
import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';

/**
 * ═══════════════════════════════════════════════════════════════════════
 * SurfaceApartmentV2 — larger walkable apartment ("wet work" interior)
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Same physics contract as SurfaceApartment v1:
 *   - One UQRC 'piece' body, pinned via `physics.pinPiece`.
 *   - Pose driven by `getEarthLocalSiteFrame(anchorPeerId)`, re-projected
 *     to FEET_SHELL_RADIUS each tick so it co-moves with Earth's spin.
 *   - Render is a read-only consumer of physics state.
 *
 * What's new:
 *   - 16 m × 12 m footprint × 2.7 m floor-to-ceiling (1.4× v1 each axis).
 *   - 4 rooms + central hallway: foyer, living, kitchen, bedroom, bath.
 *   - Walls built as multi-segment runs with explicit doorway gaps so an
 *     avatar can actually walk through openings (no invisible blockers
 *     because the apartment has no collider — same as v1 by design).
 *   - Furniture per room (bed, sofa, table+chairs, kitchen counter, tub).
 *   - External porch with steps, second exit at the back.
 *
 * Dimensions are in metres, derived from human scale:
 *   FLOOR_THICK = 0.1, WALL_T = 0.18, DOOR_W = 1.0, DOOR_H = 2.1,
 *   WIN_BOTTOM = 0.9, WIN_TOP = 2.0.
 */

// ── Footprint ───────────────────────────────────────────────────────────
const W = 16;          // east-west
const D = 12;          // north-south
const H = 2.7;         // floor-to-ceiling
const T = 0.18;        // wall thickness
const DOOR_W = 1.0;    // door opening width
const DOOR_H = 2.1;    // door opening height
const WIN_W = 1.4;     // window width
const WIN_H = 1.1;     // window height
const WIN_BOTTOM = 0.9;
const FLOOR_THICK = 0.1;

// Anchor offset from village (metres along local +forward).
const FORWARD_OFFSET = 45;
// Right-shifted from the v1 apartment so they don't collide while we
// A/B test side-by-side. After approval, swap and remove v1.
const RIGHT_OFFSET = 30;

const ANCHOR_RADIUS = FEET_SHELL_RADIUS;

interface WallRun {
  /** Centre of the wall along the major axis, in local coords. */
  startA: number;
  endA: number;
  /** Position on the perpendicular axis. */
  posB: number;
  /** Sequence of [start, end] gaps along the major axis (doors / windows). */
  gaps?: { start: number; end: number; lintelHeight?: number; sillHeight?: number }[];
  /** Wall axis: 'x' = wall runs east-west (perpendicular to z), 'z' = north-south. */
  axis: 'x' | 'z';
  height?: number;
  color: string;
}

/** Build a wall run as a series of solid segments around the gaps. */
function WallSegments({ run }: { run: WallRun }) {
  const height = run.height ?? H;
  const segments: JSX.Element[] = [];
  const gaps = (run.gaps ?? []).slice().sort((a, b) => a.start - b.start);
  let cursor = run.startA;
  let key = 0;
  for (const g of gaps) {
    if (g.start > cursor) {
      const len = g.start - cursor;
      const mid = cursor + len / 2;
      segments.push(
        <mesh
          key={`seg-${key++}`}
          position={
            run.axis === 'x'
              ? [mid, height / 2, run.posB]
              : [run.posB, height / 2, mid]
          }
          castShadow
          receiveShadow
        >
          <boxGeometry
            args={
              run.axis === 'x'
                ? [len, height, T]
                : [T, height, len]
            }
          />
          <meshStandardMaterial color={run.color} roughness={0.85} />
        </mesh>,
      );
    }
    // Lintel (above door/window) and sill (below window)
    const lintelH = g.lintelHeight ?? DOOR_H;
    const sillH = g.sillHeight ?? 0;
    const gapLen = g.end - g.start;
    const gapMid = g.start + gapLen / 2;
    if (lintelH < height) {
      const lintelThick = height - lintelH;
      segments.push(
        <mesh
          key={`lintel-${key++}`}
          position={
            run.axis === 'x'
              ? [gapMid, lintelH + lintelThick / 2, run.posB]
              : [run.posB, lintelH + lintelThick / 2, gapMid]
          }
          castShadow
          receiveShadow
        >
          <boxGeometry
            args={
              run.axis === 'x'
                ? [gapLen, lintelThick, T]
                : [T, lintelThick, gapLen]
            }
          />
          <meshStandardMaterial color={run.color} roughness={0.85} />
        </mesh>,
      );
    }
    if (sillH > 0) {
      segments.push(
        <mesh
          key={`sill-${key++}`}
          position={
            run.axis === 'x'
              ? [gapMid, sillH / 2, run.posB]
              : [run.posB, sillH / 2, gapMid]
          }
          castShadow
          receiveShadow
        >
          <boxGeometry
            args={
              run.axis === 'x'
                ? [gapLen, sillH, T]
                : [T, sillH, gapLen]
            }
          />
          <meshStandardMaterial color={run.color} roughness={0.85} />
        </mesh>,
      );
    }
    cursor = g.end;
  }
  if (cursor < run.endA) {
    const len = run.endA - cursor;
    const mid = cursor + len / 2;
    segments.push(
      <mesh
        key={`seg-${key++}`}
        position={
          run.axis === 'x'
            ? [mid, height / 2, run.posB]
            : [run.posB, height / 2, mid]
        }
        castShadow
        receiveShadow
      >
        <boxGeometry
          args={
            run.axis === 'x'
              ? [len, height, T]
              : [T, height, len]
          }
        />
        <meshStandardMaterial color={run.color} roughness={0.85} />
      </mesh>,
    );
  }
  return <group>{segments}</group>;
}

export function SurfaceApartmentV2({ anchorPeerId }: { anchorPeerId: string }) {
  const groupRef = useRef<THREE.Group>(null);
  const bodyId = useMemo(() => `apartment-v2:${anchorPeerId}`, [anchorPeerId]);

  // Make every material double-sided so the player can see interior faces.
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return;
    group.frustumCulled = false;
    group.traverse((obj) => {
      obj.frustumCulled = false;
      const mat = (obj as THREE.Mesh).material;
      if (!mat) return;
      const mats = Array.isArray(mat) ? mat : [mat];
      mats.forEach((m) => {
        if ('side' in m) {
          (m as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
          (m as THREE.MeshStandardMaterial).needsUpdate = true;
        }
      });
    });
  });

  const buildPose = (poseArg?: ReturnType<typeof getEarthPose>) => {
    const pose = poseArg ?? getEarthPose();
    const lf = getEarthLocalSiteFrame(anchorPeerId);
    const localPos: [number, number, number] = [
      lf.normal[0] * EARTH_RADIUS + lf.forward[0] * FORWARD_OFFSET + lf.right[0] * RIGHT_OFFSET,
      lf.normal[1] * EARTH_RADIUS + lf.forward[1] * FORWARD_OFFSET + lf.right[1] * RIGHT_OFFSET,
      lf.normal[2] * EARTH_RADIUS + lf.forward[2] * FORWARD_OFFSET + lf.right[2] * RIGHT_OFFSET,
    ];
    const worldRaw = earthLocalToWorld(localPos, pose);
    const dx = worldRaw[0] - pose.center[0];
    const dy = worldRaw[1] - pose.center[1];
    const dz = worldRaw[2] - pose.center[2];
    const r = Math.hypot(dx, dy, dz) || 1;
    const k = ANCHOR_RADIUS / r;
    const worldPos: [number, number, number] = [
      pose.center[0] + dx * k,
      pose.center[1] + dy * k,
      pose.center[2] + dz * k,
    ];
    const upL = lf.normal, fwdL = lf.forward, rgtL = lf.right;
    const up = earthLocalToWorld(upL, pose);
    const fwd = earthLocalToWorld(fwdL, pose);
    const rgt = earthLocalToWorld(rgtL, pose);
    const upV: [number, number, number] = [up[0] - pose.center[0], up[1] - pose.center[1], up[2] - pose.center[2]];
    const fwdV: [number, number, number] = [fwd[0] - pose.center[0], fwd[1] - pose.center[1], fwd[2] - pose.center[2]];
    const rgtV: [number, number, number] = [rgt[0] - pose.center[0], rgt[1] - pose.center[1], rgt[2] - pose.center[2]];
    return { worldPos, up: upV, forward: fwdV, right: rgtV, pose };
  };

  // Physics body — same contract as v1.
  useEffect(() => {
    const physics = getBrainPhysics();
    const { worldPos } = buildPose();
    physics.addBody({
      id: bodyId,
      kind: 'piece',
      pos: [...worldPos] as [number, number, number],
      vel: [0, 0, 0],
      mass: 120,
      trust: 1,
      meta: { attachedTo: 'earth-surface', structure: 'apartment-v2', anchorPeerId },
    });
    const pin = physics.pinPiece(worldPos, 1.0);
    return () => {
      try { physics.unpin(pin); } catch { /* ignore */ }
      physics.removeBody(bodyId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodyId]);

  const initial = useMemo(() => {
    const { worldPos, up, forward, right } = buildPose();
    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(right[0], right[1], right[2]),
      new THREE.Vector3(up[0], up[1], up[2]),
      new THREE.Vector3(forward[0], forward[1], forward[2]),
    );
    const euler = new THREE.Euler().setFromRotationMatrix(m);
    return { worldPos, euler };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorPeerId]);

  useFrame(() => {
    if (!groupRef.current) return;
    const physics = getBrainPhysics();
    const body = physics.getBody(bodyId);
    const pose = getEarthPose();
    let worldPos: [number, number, number];
    let up: [number, number, number];
    let forward: [number, number, number];
    let right: [number, number, number];
    if (body) {
      const dx = body.pos[0] - pose.center[0];
      const dy = body.pos[1] - pose.center[1];
      const dz = body.pos[2] - pose.center[2];
      const r = Math.hypot(dx, dy, dz) || 1;
      const k = ANCHOR_RADIUS / r;
      body.pos[0] = pose.center[0] + dx * k;
      body.pos[1] = pose.center[1] + dy * k;
      body.pos[2] = pose.center[2] + dz * k;
      worldPos = [body.pos[0], body.pos[1], body.pos[2]];
      up = [dx / r, dy / r, dz / r];
      const lf = getEarthLocalSiteFrame(anchorPeerId);
      const fwdW = earthLocalToWorld(lf.forward, pose);
      const rgtW = earthLocalToWorld(lf.right, pose);
      forward = [fwdW[0] - pose.center[0], fwdW[1] - pose.center[1], fwdW[2] - pose.center[2]];
      right = [rgtW[0] - pose.center[0], rgtW[1] - pose.center[1], rgtW[2] - pose.center[2]];
      const dot = forward[0] * up[0] + forward[1] * up[1] + forward[2] * up[2];
      forward = [forward[0] - up[0] * dot, forward[1] - up[1] * dot, forward[2] - up[2] * dot];
      const fl = Math.hypot(forward[0], forward[1], forward[2]) || 1;
      forward = [forward[0] / fl, forward[1] / fl, forward[2] / fl];
      right = [
        up[1] * forward[2] - up[2] * forward[1],
        up[2] * forward[0] - up[0] * forward[2],
        up[0] * forward[1] - up[1] * forward[0],
      ];
    } else {
      const built = buildPose(pose);
      worldPos = built.worldPos;
      up = built.up;
      forward = built.forward;
      right = built.right;
    }
    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(right[0], right[1], right[2]),
      new THREE.Vector3(up[0], up[1], up[2]),
      new THREE.Vector3(forward[0], forward[1], forward[2]),
    );
    groupRef.current.position.set(worldPos[0], worldPos[1], worldPos[2]);
    groupRef.current.setRotationFromMatrix(m);
  });

  // ── Materials (reuse v1 palette) ──
  const C = COMPOUND_TABLE;
  const concrete = C.floor_4.color;
  const limestone = C.wall_long.color;
  const adobe = C.wall_short.color;
  const gypsum = C.wall_half.color;
  const oak = C.door_single.color;
  const steel = C.door_double.color;
  const sodaGlass = C.window_square.color;
  const boroGlass = C.window_wide.color;
  const terracotta = C.roof_gable.color;

  // ── Wall layout ──
  // Local axes: +x = right (east), +z = forward (north), -z = south (entrance side).
  // Footprint corners: x ∈ [-W/2, W/2], z ∈ [-D/2, D/2].
  // Hallway runs along +x at z ∈ [-1.0, 1.0]; doors open from hallway into rooms.
  const HALL_HALF = 1.0;

  // South wall (entrance) — front door near the centre + a window each side.
  const southWall: WallRun = {
    axis: 'x',
    startA: -W / 2,
    endA: W / 2,
    posB: -D / 2,
    color: limestone,
    gaps: [
      { start: -3.5, end: -3.5 + WIN_W, lintelHeight: WIN_BOTTOM + WIN_H, sillHeight: WIN_BOTTOM },
      { start: -DOOR_W / 2, end: DOOR_W / 2, lintelHeight: DOOR_H },
      { start: 3.5 - WIN_W, end: 3.5, lintelHeight: WIN_BOTTOM + WIN_H, sillHeight: WIN_BOTTOM },
    ],
  };
  // North wall — back door + two bedroom windows.
  const northWall: WallRun = {
    axis: 'x',
    startA: -W / 2,
    endA: W / 2,
    posB: D / 2,
    color: limestone,
    gaps: [
      { start: -W / 2 + 1.5, end: -W / 2 + 1.5 + WIN_W, lintelHeight: WIN_BOTTOM + WIN_H, sillHeight: WIN_BOTTOM },
      { start: -DOOR_W / 2, end: DOOR_W / 2, lintelHeight: DOOR_H },
      { start: W / 2 - 1.5 - WIN_W, end: W / 2 - 1.5, lintelHeight: WIN_BOTTOM + WIN_H, sillHeight: WIN_BOTTOM },
    ],
  };
  // West and east outer walls (long side windows).
  const westWall: WallRun = {
    axis: 'z',
    startA: -D / 2,
    endA: D / 2,
    posB: -W / 2,
    color: limestone,
    gaps: [
      { start: -D / 2 + 2, end: -D / 2 + 2 + WIN_W, lintelHeight: WIN_BOTTOM + WIN_H, sillHeight: WIN_BOTTOM },
      { start: D / 2 - 2 - WIN_W, end: D / 2 - 2, lintelHeight: WIN_BOTTOM + WIN_H, sillHeight: WIN_BOTTOM },
    ],
  };
  const eastWall: WallRun = {
    axis: 'z',
    startA: -D / 2,
    endA: D / 2,
    posB: W / 2,
    color: limestone,
    gaps: [
      { start: -D / 2 + 2, end: -D / 2 + 2 + WIN_W, lintelHeight: WIN_BOTTOM + WIN_H, sillHeight: WIN_BOTTOM },
      { start: D / 2 - 2 - WIN_W, end: D / 2 - 2, lintelHeight: WIN_BOTTOM + WIN_H, sillHeight: WIN_BOTTOM },
    ],
  };

  // Interior partitions: split into 4 rooms around a central hallway.
  // North hallway wall (separates living/kitchen from hallway).
  const hallSouth: WallRun = {
    axis: 'x',
    startA: -W / 2 + T,
    endA: W / 2 - T,
    posB: -HALL_HALF,
    color: adobe,
    gaps: [
      { start: -4.5, end: -4.5 + DOOR_W, lintelHeight: DOOR_H }, // into living
      { start: 3.5, end: 3.5 + DOOR_W, lintelHeight: DOOR_H },   // into kitchen
    ],
  };
  // North side of hallway (separates hallway from bedroom + bath).
  const hallNorth: WallRun = {
    axis: 'x',
    startA: -W / 2 + T,
    endA: W / 2 - T,
    posB: HALL_HALF,
    color: adobe,
    gaps: [
      { start: -4.5, end: -4.5 + DOOR_W, lintelHeight: DOOR_H }, // into bedroom
      { start: 3.5, end: 3.5 + DOOR_W, lintelHeight: DOOR_H },   // into bath
    ],
  };
  // Vertical partition between living (south-west) and kitchen (south-east).
  const vSouth: WallRun = {
    axis: 'z',
    startA: -D / 2 + T,
    endA: -HALL_HALF,
    posB: 0,
    color: adobe,
  };
  // Vertical partition between bedroom (north-west) and bath (north-east).
  const vNorth: WallRun = {
    axis: 'z',
    startA: HALL_HALF,
    endA: D / 2 - T,
    posB: 0,
    color: adobe,
  };

  return (
    <group ref={groupRef} position={initial.worldPos} rotation={[initial.euler.x, initial.euler.y, initial.euler.z]}>
      {/* Floor slab — top face co-planar with feet shell. */}
      <mesh position={[0, -FLOOR_THICK / 2, 0]} receiveShadow>
        <boxGeometry args={[W, FLOOR_THICK, D]} />
        <meshStandardMaterial color={concrete} roughness={0.92} />
      </mesh>

      {/* Outer walls */}
      <WallSegments run={southWall} />
      <WallSegments run={northWall} />
      <WallSegments run={westWall} />
      <WallSegments run={eastWall} />
      {/* Interior partitions */}
      <WallSegments run={hallSouth} />
      <WallSegments run={hallNorth} />
      <WallSegments run={vSouth} />
      <WallSegments run={vNorth} />

      {/* Window glass — soda-lime panes filling each window gap. */}
      {[
        { x: -3.5 + WIN_W / 2, z: -D / 2, axis: 'x' as const },
        { x: 3.5 - WIN_W / 2, z: -D / 2, axis: 'x' as const },
        { x: -W / 2 + 1.5 + WIN_W / 2, z: D / 2, axis: 'x' as const },
        { x: W / 2 - 1.5 - WIN_W / 2, z: D / 2, axis: 'x' as const },
        { x: -W / 2, z: -D / 2 + 2 + WIN_W / 2, axis: 'z' as const },
        { x: -W / 2, z: D / 2 - 2 - WIN_W / 2, axis: 'z' as const },
        { x: W / 2, z: -D / 2 + 2 + WIN_W / 2, axis: 'z' as const },
        { x: W / 2, z: D / 2 - 2 - WIN_W / 2, axis: 'z' as const },
      ].map((w, i) => (
        <mesh key={`win-${i}`} position={[w.x, WIN_BOTTOM + WIN_H / 2, w.z]}>
          <boxGeometry
            args={
              w.axis === 'x'
                ? [WIN_W, WIN_H, T * 0.4]
                : [T * 0.4, WIN_H, WIN_W]
            }
          />
          <meshStandardMaterial
            color={sodaGlass}
            transparent
            opacity={0.45}
            emissive={sodaGlass}
            emissiveIntensity={0.15}
            roughness={0.1}
            metalness={0.2}
          />
        </mesh>
      ))}

      {/* Front door — slightly ajar, oak. */}
      <group position={[DOOR_W / 2 - 0.05, DOOR_H / 2, -D / 2 + T * 0.6]} rotation={[0, -0.4, 0]}>
        <mesh castShadow>
          <boxGeometry args={[DOOR_W, DOOR_H - 0.05, 0.06]} />
          <meshStandardMaterial color={oak} roughness={0.6} />
        </mesh>
        <mesh position={[DOOR_W / 2 - 0.1, 0, 0.05]}>
          <sphereGeometry args={[0.06, 12, 12]} />
          <meshStandardMaterial color={steel} metalness={0.9} roughness={0.2} />
        </mesh>
      </group>

      {/* Ceiling slab + gable roof. */}
      <mesh position={[0, H + 0.05, 0]} castShadow receiveShadow>
        <boxGeometry args={[W + 0.4, 0.1, D + 0.4]} />
        <meshStandardMaterial color={gypsum} roughness={0.9} />
      </mesh>
      <mesh position={[0, H + 1.0, -D / 4]} rotation={[0.5, 0, 0]} castShadow>
        <boxGeometry args={[W + 0.4, 0.15, D / 2 + 0.6]} />
        <meshStandardMaterial color={terracotta} roughness={0.8} />
      </mesh>
      <mesh position={[0, H + 1.0, D / 4]} rotation={[-0.5, 0, 0]} castShadow>
        <boxGeometry args={[W + 0.4, 0.15, D / 2 + 0.6]} />
        <meshStandardMaterial color={terracotta} roughness={0.8} />
      </mesh>

      {/* ── Furniture per room ────────────────────────────────── */}

      {/* LIVING ROOM (south-west quadrant): sofa + coffee table + lamp */}
      <mesh position={[-W / 4, 0.4, -D / 2 + 1.4]} castShadow receiveShadow>
        <boxGeometry args={[3.2, 0.8, 1.0]} />
        <meshStandardMaterial color={gypsum} roughness={0.9} />
      </mesh>
      <mesh position={[-W / 4, 1.0, -D / 2 + 0.95]} castShadow>
        <boxGeometry args={[3.2, 0.6, 0.2]} />
        <meshStandardMaterial color={gypsum} roughness={0.9} />
      </mesh>
      <mesh position={[-W / 4, 0.45, -D / 2 + 3.0]} castShadow receiveShadow>
        <boxGeometry args={[1.8, 0.08, 0.9]} />
        <meshStandardMaterial color={oak} roughness={0.5} />
      </mesh>
      <mesh position={[-W / 4 + 1.7, 0.7, -D / 2 + 1.5]} castShadow>
        <cylinderGeometry args={[0.08, 0.12, 1.4, 12]} />
        <meshStandardMaterial color={steel} metalness={0.85} roughness={0.25} />
      </mesh>
      <mesh position={[-W / 4 + 1.7, 1.5, -D / 2 + 1.5]}>
        <sphereGeometry args={[0.18, 16, 16]} />
        <meshStandardMaterial color={boroGlass} emissive={boroGlass} emissiveIntensity={1.5} transparent opacity={0.85} />
      </mesh>
      <pointLight position={[-W / 4 + 1.7, 1.5, -D / 2 + 1.5]} intensity={6} distance={6} color={boroGlass} />

      {/* KITCHEN (south-east quadrant): counter + stove + table */}
      <mesh position={[W / 4, 0.45, -D / 2 + 0.8]} castShadow receiveShadow>
        <boxGeometry args={[5.0, 0.9, 0.7]} />
        <meshStandardMaterial color={oak} roughness={0.55} />
      </mesh>
      <mesh position={[W / 4 - 1.5, 1.0, -D / 2 + 0.8]} castShadow>
        <boxGeometry args={[0.6, 0.2, 0.5]} />
        <meshStandardMaterial color={steel} metalness={0.7} roughness={0.3} />
      </mesh>
      <mesh position={[W / 4 + 0.8, 0.4, -D / 2 + 3.5]} castShadow receiveShadow>
        <cylinderGeometry args={[1.0, 1.0, 0.08, 18]} />
        <meshStandardMaterial color={oak} roughness={0.5} />
      </mesh>
      {[0, Math.PI / 2, Math.PI, -Math.PI / 2].map((a, i) => (
        <mesh
          key={`kc-${i}`}
          position={[W / 4 + 0.8 + Math.cos(a) * 0.85, 0.45, -D / 2 + 3.5 + Math.sin(a) * 0.85]}
          castShadow
        >
          <boxGeometry args={[0.4, 0.9, 0.4]} />
          <meshStandardMaterial color={gypsum} roughness={0.9} />
        </mesh>
      ))}

      {/* BEDROOM (north-west quadrant): bed + headboard + nightstand */}
      <mesh position={[-W / 4, 0.35, D / 2 - 2.0]} castShadow receiveShadow>
        <boxGeometry args={[2.4, 0.5, 2.0]} />
        <meshStandardMaterial color={gypsum} roughness={0.9} />
      </mesh>
      <mesh position={[-W / 4, 1.05, D / 2 - 1.0]} castShadow>
        <boxGeometry args={[2.4, 1.4, 0.1]} />
        <meshStandardMaterial color={oak} roughness={0.55} />
      </mesh>
      <mesh position={[-W / 4 + 1.5, 0.4, D / 2 - 2.5]} castShadow>
        <boxGeometry args={[0.5, 0.8, 0.5]} />
        <meshStandardMaterial color={oak} roughness={0.5} />
      </mesh>
      <mesh position={[-W / 4 + 1.5, 0.95, D / 2 - 2.5]}>
        <sphereGeometry args={[0.15, 12, 12]} />
        <meshStandardMaterial color={boroGlass} emissive={boroGlass} emissiveIntensity={1.2} transparent opacity={0.85} />
      </mesh>
      <pointLight position={[-W / 4 + 1.5, 1.0, D / 2 - 2.5]} intensity={4} distance={5} color={boroGlass} />

      {/* BATHROOM (north-east quadrant): tub + sink */}
      <mesh position={[W / 4, 0.3, D / 2 - 1.6]} castShadow receiveShadow>
        <boxGeometry args={[2.4, 0.6, 1.2]} />
        <meshStandardMaterial color={gypsum} roughness={0.4} metalness={0.05} />
      </mesh>
      <mesh position={[W / 4, 0.55, D / 2 - 1.6]}>
        <boxGeometry args={[2.0, 0.35, 0.9]} />
        <meshStandardMaterial color={sodaGlass} transparent opacity={0.5} />
      </mesh>
      <mesh position={[W / 4 + 1.6, 0.85, D / 2 - 3.4]} castShadow>
        <boxGeometry args={[1.0, 0.15, 0.6]} />
        <meshStandardMaterial color={gypsum} roughness={0.4} />
      </mesh>
      <mesh position={[W / 4 + 1.6, 0.45, D / 2 - 3.4]}>
        <boxGeometry args={[0.8, 0.7, 0.5]} />
        <meshStandardMaterial color={gypsum} roughness={0.6} />
      </mesh>

      {/* HALLWAY: ceiling lamp */}
      <mesh position={[0, H - 0.05, 0]}>
        <sphereGeometry args={[0.18, 16, 16]} />
        <meshStandardMaterial color={boroGlass} emissive={boroGlass} emissiveIntensity={2.0} transparent opacity={0.85} />
      </mesh>
      <pointLight position={[0, H - 0.2, 0]} intensity={10} distance={W} color={boroGlass} />

      {/* Front porch: 2 steps + lantern */}
      <mesh position={[0, -0.05, -D / 2 - 0.6]} receiveShadow>
        <boxGeometry args={[3.0, 0.2, 1.2]} />
        <meshStandardMaterial color={concrete} roughness={0.92} />
      </mesh>
      <mesh position={[0, -0.2, -D / 2 - 1.4]} receiveShadow>
        <boxGeometry args={[3.6, 0.2, 0.8]} />
        <meshStandardMaterial color={concrete} roughness={0.92} />
      </mesh>
      <mesh position={[1.4, 0.4, -D / 2 - 1.0]} castShadow>
        <cylinderGeometry args={[0.1, 0.15, 0.8, 12]} />
        <meshStandardMaterial color={steel} metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[1.4, 0.95, -D / 2 - 1.0]}>
        <sphereGeometry args={[0.2, 16, 16]} />
        <meshStandardMaterial color={boroGlass} emissive={boroGlass} emissiveIntensity={2.5} transparent opacity={0.85} />
      </mesh>
      <pointLight position={[1.4, 1.0, -D / 2 - 1.0]} intensity={8} distance={8} color={boroGlass} />

      {/* Welcome plaque on the porch riser */}
      <mesh position={[0, 0.05, -D / 2 - 0.05]}>
        <boxGeometry args={[1.4, 0.1, 0.02]} />
        <meshStandardMaterial color={oak} roughness={0.5} />
      </mesh>
    </group>
  );
}
