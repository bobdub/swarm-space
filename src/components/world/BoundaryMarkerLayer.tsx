/**
 * BoundaryMarkerLayer — press and hold a grid block to claim it.
 *
 * Mounted inside the Canvas. Active only while the Boundary marker is in
 * hand. It lays an invisible pick disc on the ground around the player:
 * pointing at the ground highlights the grid block under the pointer,
 * and pressing and holding on it fills the block until the claim fires
 * (`claimBlockWithMarker`). With no pointer on the ground (joystick,
 * gamepad), the target is the block in front of the player and the
 * HUD's hold button drives the same fill.
 *
 * Highlight colours: green = free, blue = already yours, red = someone
 * else's, slate = communal or water (water can never be claimed). Moving to another block mid-hold restarts it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { toast } from 'sonner';
import {
  earthLocalToWorld,
  getEarthPose,
  getEarthLocalSiteFrame,
  type Vec3,
} from '@/lib/brain/earth';
import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';
import { WORLD_GRID_ORIGIN_ANCHOR } from '@/lib/world/buildGrid';
import { PLOT_CELL, tangentToCell } from '@/lib/world/landPlots';
import { tangentToSurfaceLocal, worldPointToTangent } from '@/lib/world/landPermissions';
import { getHeldTool, subscribeHeldTool } from '@/lib/world/heldToolStore';
import {
  BLOCK_PRICE_SWARM,
  CLAIM_HOLD_MS,
  blockStatus,
  claimBlockWithMarker,
  getMarkerHold,
  isBoundaryMarker,
  resetMarkerHold,
  setMarkerHold,
  type BlockStatus,
} from '@/lib/world/boundaryMarker';

/** Blocks farther than this from the player can't be claimed. */
const REACH_M = 12;
const PICK_RADIUS = REACH_M + PLOT_CELL;

const STATUS_COLOR: Record<BlockStatus, string> = {
  free: '#22c55e',
  own: '#38bdf8',
  foreign: '#ef4444',
  commons: '#94a3b8',
  water: '#64748b',
};

type Cell = { cx: number; cz: number };

function sameCell(a: Cell | null, b: Cell | null): boolean {
  return !!a && !!b && a.cx === b.cx && a.cz === b.cz;
}

function tangentToWorld(tx: number, tz: number, lift: number): Vec3 {
  return earthLocalToWorld(tangentToSurfaceLocal(tx, tz, lift), getEarthPose());
}

function cellAtWorld(point: Vec3): Cell | null {
  const t = worldPointToTangent(point);
  return t ? tangentToCell(t.tx, t.tz) : null;
}

export function BoundaryMarkerLayer({ selfId }: { selfId?: string }) {
  const [active, setActive] = useState(() => isBoundaryMarker(getHeldTool()?.prefabId));
  useEffect(() => subscribeHeldTool((h) => setActive(isBoundaryMarker(h?.prefabId))), []);
  useEffect(() => { if (!active) resetMarkerHold(); }, [active]);
  if (!active || !selfId) return null;
  return <MarkerControls selfId={selfId} />;
}

function MarkerControls({ selfId }: { selfId: string }) {
  const discRef = useRef<THREE.Mesh>(null);
  const hoverRef = useRef<Cell | null>(null);
  const pressRef = useRef<Cell | null>(null);
  const holdCellRef = useRef<Cell | null>(null);
  const progressRef = useRef(0);
  /** After a claim fires, wait for release before another hold can start. */
  const latchedRef = useRef(false);
  const busyRef = useRef(false);

  const fillGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 3), 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    return geo;
  }, []);
  const fillMaterial = useMemo(() => new THREE.MeshBasicMaterial({
    color: STATUS_COLOR.free,
    transparent: true,
    opacity: 0.25,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
  }), []);
  const edgeGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(5 * 3), 3));
    return geo;
  }, []);
  const edgeMaterial = useMemo(() => new THREE.LineBasicMaterial({
    color: STATUS_COLOR.free,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
  }), []);
  const edge = useMemo(() => new THREE.Line(edgeGeometry, edgeMaterial), [edgeGeometry, edgeMaterial]);
  const fillMesh = useMemo(() => new THREE.Mesh(fillGeometry, fillMaterial), [fillGeometry, fillMaterial]);

  useEffect(() => () => {
    fillGeometry.dispose();
    fillMaterial.dispose();
    edgeGeometry.dispose();
    edgeMaterial.dispose();
  }, [fillGeometry, fillMaterial, edgeGeometry, edgeMaterial]);

  // Releasing anywhere ends a world hold (the pointer may leave the disc).
  useEffect(() => {
    const up = () => { pressRef.current = null; };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);

  const bodyTangent = (): { tx: number; tz: number } | null => {
    const body = getBrainPhysics().getBody(selfId);
    return body ? worldPointToTangent(body.pos as Vec3) : null;
  };

  const inReach = (c: Cell): boolean => {
    const t = bodyTangent();
    if (!t) return false;
    const mx = (c.cx + 0.5) * PLOT_CELL;
    const mz = (c.cz + 0.5) * PLOT_CELL;
    return Math.hypot(mx - t.tx, mz - t.tz) <= REACH_M;
  };

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    const c = cellAtWorld([e.point.x, e.point.y, e.point.z]);
    hoverRef.current = c && inReach(c) ? c : null;
    if (pressRef.current && c && !sameCell(c, pressRef.current)) {
      pressRef.current = hoverRef.current; // slid to another block: restart there
    }
  };
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== undefined && e.button !== 0) return;
    const c = cellAtWorld([e.point.x, e.point.y, e.point.z]);
    if (!c || !inReach(c)) return;
    e.stopPropagation();
    hoverRef.current = c;
    pressRef.current = c;
  };
  const onLeave = () => { hoverRef.current = null; pressRef.current = null; };

  const fire = async (cell: Cell) => {
    busyRef.current = true;
    setMarkerHold({ busy: true });
    try {
      const res = await claimBlockWithMarker({ cx: cell.cx, cz: cell.cz, ownerId: selfId });
      if (res.ok) toast.success(`Block claimed · ${BLOCK_PRICE_SWARM} SWARM`);
      else if ('reason' in res) toast.error(res.reason);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not claim this block.');
    } finally {
      busyRef.current = false;
      setMarkerHold({ busy: false });
    }
  };

  useFrame((_, dt) => {
    const physics = getBrainPhysics();
    const body = physics.getBody(selfId);
    if (!body) return;
    const pose = getEarthPose();
    const pos = body.pos as Vec3;
    const ux = pos[0] - pose.center[0], uy = pos[1] - pose.center[1], uz = pos[2] - pose.center[2];
    const uLen = Math.hypot(ux, uy, uz) || 1;
    const up = new THREE.Vector3(ux / uLen, uy / uLen, uz / uLen);

    // Pick disc: centred under the player, facing radially out.
    const disc = discRef.current;
    if (disc) {
      disc.position.set(pos[0] - up.x * 0.9, pos[1] - up.y * 0.9, pos[2] - up.z * 0.9);
      disc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), up);
    }

    // Fallback target: the block one step in front of the player.
    let aim: Cell | null = null;
    const fwd = physics.getIntent(selfId)?.basis?.forward;
    if (fwd) {
      aim = cellAtWorld([
        pos[0] + fwd[0] * PLOT_CELL,
        pos[1] + fwd[1] * PLOT_CELL,
        pos[2] + fwd[2] * PLOT_CELL,
      ]);
    }
    if (!aim) aim = cellAtWorld(pos);

    const hud = getMarkerHold().hudPressed;
    const pressing = !!pressRef.current || hud;
    const target = pressRef.current ?? hoverRef.current ?? aim;

    if (!pressing) latchedRef.current = false;
    if (!pressing || latchedRef.current || busyRef.current || !target) {
      progressRef.current = 0;
      holdCellRef.current = null;
    } else {
      if (!sameCell(holdCellRef.current, target)) {
        holdCellRef.current = target;
        progressRef.current = 0;
      }
      // Clamp dt so one long frame (tab hitch) can't complete a hold by itself.
      progressRef.current = Math.min(1, progressRef.current + (Math.min(dt, 0.1) * 1000) / CLAIM_HOLD_MS);
      if (progressRef.current >= 1) {
        latchedRef.current = true;
        const cell = target;
        progressRef.current = 0;
        holdCellRef.current = null;
        void fire(cell);
      }
    }
    setMarkerHold({ target, progress: Math.round(progressRef.current * 20) / 20 });

    // Highlight the target block, lifted onto terrain.
    if (!target) {
      fillMesh.visible = false;
      edge.visible = false;
      return;
    }
    const { status } = blockStatus(target.cx, target.cz, selfId);
    const color = STATUS_COLOR[status];
    fillMaterial.color.set(color);
    edgeMaterial.color.set(color);
    fillMaterial.opacity = 0.18 + progressRef.current * 0.55;
    const x0 = target.cx * PLOT_CELL, x1 = (target.cx + 1) * PLOT_CELL;
    const z0 = target.cz * PLOT_CELL, z1 = (target.cz + 1) * PLOT_CELL;
    const corners: Array<[number, number]> = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
    const fillArr = (fillGeometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    const edgeArr = (edgeGeometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < 4; i++) {
      const w = tangentToWorld(corners[i][0], corners[i][1], 0.06);
      fillArr.set(w, i * 3);
      edgeArr.set(w, i * 3);
    }
    edgeArr.set([edgeArr[0], edgeArr[1], edgeArr[2]], 12);
    (fillGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (edgeGeometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    fillGeometry.computeBoundingSphere();
    edgeGeometry.computeBoundingSphere();
    fillMesh.visible = true;
    edge.visible = true;
  });

  return (
    <group renderOrder={8}>
      <mesh
        ref={discRef}
        onPointerMove={onMove}
        onPointerDown={onDown}
        onPointerLeave={onLeave}
      >
        <circleGeometry args={[PICK_RADIUS, 32]} />
        {/* Invisible but raycastable: draws nothing, still catches the pointer. */}
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <primitive object={fillMesh} renderOrder={8} />
      <primitive object={edge} renderOrder={9} />
    </group>
  );
}

export default BoundaryMarkerLayer;
