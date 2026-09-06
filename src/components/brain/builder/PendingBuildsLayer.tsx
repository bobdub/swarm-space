/**
 * PendingBuildsLayer — the staged ghosts you have dropped but not raised.
 *
 * A staged ghost is private: it lives in `pendingBuildsStore` (local IDB,
 * never gossiped), so only its owner sees it. Walking up to one shows a
 * "Build — press and hold" prompt; holding fills a ring, and at zero the
 * materials are spent and the piece is committed through
 * `placePrefabAtHit` → `getBuilderBlockEngine().placeBlock(...)`, which
 * is still the single writer to the lattice and the thing that gossips
 * the finished object to everyone else.
 *
 * Materials are re-checked at the moment the ring completes, so spending
 * wood elsewhere mid-hold surfaces what is missing instead of building
 * something you can no longer afford.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { toast } from 'sonner';
import {
  STRUCTURE_SHELL_RADIUS,
  getEarthPose,
  quatRotate,
  type Vec3,
} from '@/lib/brain/earth';
import { sampleSurfaceLift } from '@/lib/brain/surfaceProfile';
import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';
import { getPrefab } from '@/lib/brain/prefabHouseCatalog';
import {
  buildSeconds,
  checkAffordable,
  describeMissing,
  prefabCost,
  spendMaterials,
} from '@/lib/world/materials';
import {
  listPendingBuilds,
  removePendingBuild,
  subscribePendingBuilds,
  updatePendingBuild,
  hydratePendingBuilds,
  type PendingBuild,
} from '@/lib/world/pendingBuildsStore';
import { placePrefabAtHit } from '@/lib/world/placementController';
import { recordLocalPlacement } from '@/lib/world/worldPlacementsStore';
import { canBuildAtWorldPoint } from '@/lib/world/landPermissions';

/** How close the player must stand for the build prompt to appear. */
const PROMPT_RANGE_M = 4.2;
const SURFACE_CLEARANCE = 0.03;
/** Progress eases back at this fraction of the fill rate when released. */
const RELEASE_DECAY = 0.55;

function surfaceRadiusFor(localDir: Vec3): number {
  return STRUCTURE_SHELL_RADIUS + sampleSurfaceLift(localDir) + SURFACE_CLEARANCE;
}

function worldPosFor(rec: PendingBuild): Vec3 {
  const pose = getEarthPose();
  const wd = quatRotate(pose.spinQuat, rec.localDir);
  const radius = surfaceRadiusFor(rec.localDir) + (rec.upOffset ?? 0);
  return [
    pose.center[0] + wd[0] * radius,
    pose.center[1] + wd[1] * radius,
    pose.center[2] + wd[2] * radius,
  ];
}

export function PendingBuildsLayer({ selfId }: { selfId?: string }) {
  const [pending, setPending] = useState<PendingBuild[]>([]);

  useEffect(() => {
    void hydratePendingBuilds();
    return subscribePendingBuilds(setPending);
  }, []);

  useEffect(() => { setPending(listPendingBuilds()); }, []);

  if (!pending.length) return null;
  return (
    <>
      {pending.map((rec) => (
        <PendingGhost key={rec.id} record={rec} selfId={selfId} />
      ))}
    </>
  );
}

function PendingGhost({ record, selfId }: { record: PendingBuild; selfId?: string }) {
  const prefab = useMemo(() => getPrefab(record.prefabId), [record.prefabId]);
  const groupRef = useRef<THREE.Group>(null);
  const holdingRef = useRef(false);
  const progressRef = useRef(0);
  const completedRef = useRef(false);
  const [near, setNear] = useState(false);
  const [progress, setProgress] = useState(0);
  const [blocked, setBlocked] = useState<string | null>(null);

  const duration = useMemo(() => buildSeconds(record.prefabId), [record.prefabId]);
  const cost = useMemo(() => prefabCost(record.prefabId), [record.prefabId]);

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const group = groupRef.current;
    if (!group || !prefab) return;

    const pose = getEarthPose();
    const wd = quatRotate(pose.spinQuat, record.localDir);
    const pos = worldPosFor(record);
    group.position.set(pos[0], pos[1], pos[2]);

    // +Y aligned with the local surface normal, then the stored yaw.
    const up = new THREE.Vector3(wd[0], wd[1], wd[2]).normalize();
    const ref = Math.abs(up.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const right = new THREE.Vector3().crossVectors(ref, up).normalize();
    const fwd = new THREE.Vector3().crossVectors(up, right).normalize();
    const base = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(right, up, fwd),
    );
    const yawQ = new THREE.Quaternion().setFromAxisAngle(up, record.yaw ?? 0);
    group.quaternion.copy(yawQ).multiply(base);

    // Proximity gate for the prompt.
    const body = selfId ? getBrainPhysics().getBody(selfId) : undefined;
    const bp = (selfId ? getBrainPhysics().getBodyRenderPos(selfId) : undefined) ?? body?.pos;
    const inRange = bp
      ? Math.hypot(bp[0] - pos[0], bp[1] - pos[1], bp[2] - pos[2]) <= PROMPT_RANGE_M + prefab.width
      : false;
    if (inRange !== near) setNear(inRange);

    // Hold timer. Releasing eases the ring back down rather than resetting.
    if (holdingRef.current && inRange) {
      progressRef.current = Math.min(1, progressRef.current + delta / duration);
    } else if (progressRef.current > 0) {
      progressRef.current = Math.max(0, progressRef.current - (delta / duration) * (1 / RELEASE_DECAY));
    }
    if (Math.abs(progressRef.current - progress) > 0.01 || progressRef.current === 0 || progressRef.current === 1) {
      setProgress(progressRef.current);
    }

    if (progressRef.current >= 1 && !completedRef.current) {
      completedRef.current = true;
      holdingRef.current = false;
      complete(pos);
    }
  });

  const complete = (pos: Vec3) => {
    if (!prefab) return;
    // Re-check the wallet at the moment of completion.
    const afford = checkAffordable(cost);
    if (!afford.ok) {
      setBlocked(describeMissing(afford.missing));
      progressRef.current = 0;
      setProgress(0);
      completedRef.current = false;
      return;
    }
    if (selfId) {
      const perm = canBuildAtWorldPoint(pos, selfId);
      if (!perm.ok) {
        setBlocked(perm.reason ?? 'You cannot build here.');
        progressRef.current = 0;
        setProgress(0);
        completedRef.current = false;
        return;
      }
    }
    if (!spendMaterials(cost)) {
      setBlocked('Materials were used elsewhere.');
      progressRef.current = 0;
      setProgress(0);
      completedRef.current = false;
      return;
    }
    const handle = placePrefabAtHit({
      hitPoint: pos,
      prefabId: record.prefabId,
      actorId: selfId ?? 'local',
      yaw: record.yaw ?? 0,
      upOffset: record.upOffset ?? 0,
    });
    if (!handle) {
      setBlocked('That piece could not be raised here.');
      completedRef.current = false;
      progressRef.current = 0;
      setProgress(0);
      return;
    }
    void recordLocalPlacement(handle);
    removePendingBuild(record.id);
    toast.success(`Built ${prefab.label}.`);
  };

  if (!prefab) return null;

  const pct = Math.round(progress * 100);
  const remaining = Math.max(0, duration * (1 - progress));

  return (
    <group ref={groupRef}>
      <mesh position={[0, prefab.height / 2, 0]}>
        <boxGeometry args={[prefab.width, prefab.height, prefab.depth]} />
        <meshStandardMaterial
          color={prefab.color}
          transparent
          opacity={0.3 + progress * 0.5}
          emissive={prefab.color}
          emissiveIntensity={0.25 + progress * 0.8}
          depthWrite={false}
        />
      </mesh>
      {/* Footprint outline so a staged piece reads as "not built yet". */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[Math.max(prefab.width, prefab.depth) * 0.55, Math.max(prefab.width, prefab.depth) * 0.62, 32]} />
        <meshBasicMaterial color={prefab.color} transparent opacity={0.6} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>

      {near && (
        <Html
          position={[0, prefab.height + 0.7, 0]}
          center
          distanceFactor={9}
          zIndexRange={[90, 0]}
          style={{ pointerEvents: 'auto', userSelect: 'none' }}
        >
          <div
            data-testid={`build-prompt-${record.id}`}
            onPointerDown={(e) => {
              e.stopPropagation();
              setBlocked(null);
              holdingRef.current = true;
            }}
            onPointerUp={(e) => { e.stopPropagation(); holdingRef.current = false; }}
            onPointerLeave={() => { holdingRef.current = false; }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              borderRadius: 999,
              background: 'hsla(265,70%,8%,0.92)',
              border: `2px solid ${blocked ? 'hsla(35,90%,60%,0.85)' : 'hsla(265,80%,65%,0.7)'}`,
              boxShadow: '0 0 18px hsla(265,80%,65%,0.4)',
              fontFamily: 'system-ui, sans-serif',
              fontSize: 13,
              color: 'white',
              whiteSpace: 'nowrap',
              cursor: 'pointer',
              touchAction: 'none',
            }}
          >
            <ProgressRing value={progress} />
            <span>
              {blocked
                ? blocked
                : progress > 0
                  ? `Building… ${remaining.toFixed(1)}s (${pct}%)`
                  : 'Build — press and hold'}
            </span>
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); removePendingBuild(record.id); }}
              title="Remove this ghost"
              style={{
                appearance: 'none',
                border: 'none',
                background: 'hsla(0,0%,100%,0.08)',
                color: '#fda4af',
                borderRadius: 999,
                padding: '4px 10px',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              ✕
            </button>
          </div>
        </Html>
      )}
    </group>
  );
}

function ProgressRing({ value }: { value: number }) {
  const R = 11;
  const C = 2 * Math.PI * R;
  return (
    <svg width={28} height={28} viewBox="0 0 28 28" aria-hidden="true">
      <circle cx={14} cy={14} r={R} fill="none" stroke="hsla(0,0%,100%,0.18)" strokeWidth={3} />
      <circle
        cx={14}
        cy={14}
        r={R}
        fill="none"
        stroke="hsl(265,85%,70%)"
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={C}
        strokeDashoffset={C * (1 - value)}
        transform="rotate(-90 14 14)"
      />
    </svg>
  );
}
