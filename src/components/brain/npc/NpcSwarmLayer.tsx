/**
 * NpcSwarmLayer — Phase 7 presentation layer for the live NPC roster.
 *
 * Subscribes to `npcRegistry`, mounts one low-poly capsule per NPC, and
 * drifts each toward the nearest resource site that matches its current
 * drive. Positions are computed every frame via `anchorOnEarth` so the
 * swarm rotates *with* the planet exactly like the player avatar and
 * the WetWork habitat (same `SHARED_VILLAGE_ANCHOR_ID`).
 *
 * Discipline:
 *   - Read-only adapter. Never writes the field, never calls
 *     builderBlockEngine, never mutates economy. The NPC engine still
 *     owns spawn / despawn / drives.
 *   - Honors `featureFlags.scaffoldBus` — when disabled, drift stops
 *     within one frame (positions freeze) so the kill-switch is real.
 *   - No Math.random in motion: drift is deterministic per-frame
 *     interpolation toward the targeted resource site.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { subscribe as subscribeRegistry } from '@/lib/brain/npc/npcRegistry';
import type { Npc } from '@/lib/brain/npc/npcTypes';
import {
  anchorOnEarth,
  BODY_SHELL_RADIUS,
  getEarthPose,
} from '@/lib/brain/earth';
import {
  driveToResourceKind,
  nearestSite,
} from '@/lib/world/resourceTargeting';
import { listResourceSites } from '@/lib/world/baseResources';
import { getFeatureFlags } from '@/config/featureFlags';
import { onNpcDecision } from '@/lib/brain/npc/npc.bus';

const DRIFT_SPEED_MPS = 1.2;   // metres / second along tangent plane
const ARRIVE_RADIUS = 1.5;     // m — once inside, idle in place

interface DriftState {
  tx: number;
  tz: number;
}

/** Stable color from id hash → HSL string. */
function colorFromId(id: string): string {
  let h = 5381 >>> 0;
  for (let i = 0; i < id.length; i++) h = (((h << 5) + h) ^ id.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

/** Initial tangent offset for a new NPC — hash-derived, no Math.random. */
function seedOffset(id: string): DriftState {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const a = ((h >>> 0) / 0x100000000) * Math.PI * 2;
  const r = 6 + (((h >>> 16) & 0xffff) / 0xffff) * 6;
  return { tx: Math.cos(a) * r, tz: Math.sin(a) * r };
}

function NpcCapsule({ npc, anchorId }: { npc: Npc; anchorId: string }) {
  const groupRef = useRef<THREE.Group>(null);
  const driftRef = useRef<DriftState>(seedOffset(npc.id));
  const pulseRef = useRef<number>(0); // seconds remaining on pulse

  const color = useMemo(() => colorFromId(npc.id), [npc.id]);

  useEffect(() => {
    const unsub = onNpcDecision((evt) => {
      if (evt.npcId !== npc.id) return;
      const resourceVerbs = new Set(['drink', 'eat', 'hunt', 'fish', 'gather', 'craft']);
      if (resourceVerbs.has(evt.verb)) pulseRef.current = 0.4;
    });
    return () => { unsub(); };
  }, [npc.id]);

  useFrame((_state, delta) => {
    const group = groupRef.current;
    if (!group) return;
    const flags = getFeatureFlags();
    const kind = driveToResourceKind(npc.currentDrive);
    if (flags.scaffoldBus && kind) {
      const target = nearestSite(driftRef.current.tx, driftRef.current.tz, kind);
      if (target) {
        const dx = target.tx - driftRef.current.tx;
        const dz = target.tz - driftRef.current.tz;
        const d = Math.hypot(dx, dz);
        if (d > ARRIVE_RADIUS) {
          const step = Math.min(d, DRIFT_SPEED_MPS * Math.max(0, Math.min(0.1, delta)));
          driftRef.current.tx += (dx / d) * step;
          driftRef.current.tz += (dz / d) * step;
        }
      }
    }

    const pose = getEarthPose();
    const { worldPos, up } = anchorOnEarth(
      anchorId,
      driftRef.current.tx,
      driftRef.current.tz,
      BODY_SHELL_RADIUS,
      pose,
    );
    group.position.set(worldPos[0], worldPos[1], worldPos[2]);
    // Align capsule "up" axis with the surface normal.
    const upVec = new THREE.Vector3(up[0], up[1], up[2]);
    const quat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      upVec,
    );
    group.quaternion.copy(quat);
    // Pulse decay — 1.0 → 1.15 → 1.0 over 0.4 s on resource-verb hits.
    if (pulseRef.current > 0) {
      pulseRef.current = Math.max(0, pulseRef.current - delta);
      const t = pulseRef.current / 0.4;        // 1 → 0
      const bump = Math.sin(t * Math.PI) * 0.15; // peak 0.15 at midpoint
      const s = 1 + bump;
      group.scale.set(s, s, s);
    } else if (group.scale.x !== 1) {
      group.scale.set(1, 1, 1);
    }
  });

  return (
    <group ref={groupRef}>
      {/* Body — small capsule rendered as cylinder + caps (no drei dep). */}
      <mesh position={[0, 0.55, 0]} castShadow>
        <cylinderGeometry args={[0.22, 0.22, 0.9, 10]} />
        <meshStandardMaterial color={color} roughness={0.6} metalness={0.05} />
      </mesh>
      <mesh position={[0, 1.05, 0]} castShadow>
        <sphereGeometry args={[0.24, 12, 10]} />
        <meshStandardMaterial color={color} roughness={0.55} metalness={0.05} />
      </mesh>
      {/* Drive marker dot above the head — bright unlit so it reads at distance. */}
      <mesh position={[0, 1.55, 0]}>
        <sphereGeometry args={[0.09, 8, 8]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
}

function ResourceMarkers({ anchorId }: { anchorId: string }) {
  const sites = useMemo(() => listResourceSites(), []);
  const refs = useRef<Array<THREE.Mesh | null>>([]);
  const matRefs = useRef<Array<THREE.MeshBasicMaterial | null>>([]);

  useFrame(() => {
    const pose = getEarthPose();
    for (let i = 0; i < sites.length; i++) {
      const m = refs.current[i];
      if (!m) continue;
      const { worldPos } = anchorOnEarth(anchorId, sites[i].tx, sites[i].tz, BODY_SHELL_RADIUS, pose);
      m.position.set(worldPos[0], worldPos[1], worldPos[2]);
      const mat = matRefs.current[i];
      if (mat) {
        const s = sites[i];
        const ratio = s.yieldMax > 0 ? s.yieldLeft / s.yieldMax : 0;
        mat.opacity = 0.2 + 0.65 * ratio;
        mat.visible = s.yieldLeft > 0;
      }
    }
  });

  const colorOf = (k: string) =>
    k === 'water' ? 'hsl(205, 80%, 55%)' :
    k === 'wood'  ? 'hsl(95, 55%, 45%)'  :
                    'hsl(25, 75%, 55%)';

  return (
    <group>
      {sites.map((s, i) => (
        <mesh
          key={s.id}
          ref={(node) => { refs.current[i] = node; }}
        >
          <sphereGeometry args={[0.45, 10, 10]} />
          <meshBasicMaterial
            ref={(node) => { matRefs.current[i] = node; }}
            color={colorOf(s.kind)}
            transparent
            opacity={0.85}
          />
        </mesh>
      ))}
    </group>
  );
}

export function NpcSwarmLayer({ anchorPeerId }: { anchorPeerId: string }) {
  const [roster, setRoster] = useState<Npc[]>([]);

  useEffect(() => {
    const unsub = subscribeRegistry(setRoster);
    return () => { unsub(); };
  }, []);

  return (
    <group>
      <ResourceMarkers anchorId={anchorPeerId} />
      {roster.map((npc) => (
        <NpcCapsule key={npc.id} npc={npc} anchorId={anchorPeerId} />
      ))}
    </group>
  );
}

export default NpcSwarmLayer;