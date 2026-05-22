/**
 * NpcSwarmLayer — Phase 7 presentation layer for the live NPC roster.
 *
 * Subscribes to `npcRegistry`, renders real builder-block bodies for each
 * NPC, and keeps only the world resource markers.
 * NPC motion now comes from the scheduler updating the registry/body blocks,
 * so this layer no longer fakes embodiment with local drift capsules.
 *
 * Discipline:
 *   - Read-only adapter. Never writes the field, never calls
 *     builderBlockEngine, never mutates economy. The NPC engine still
 *     owns spawn / despawn / drives.
 *   - Uses registry/body-block state only; no local fake drift model.
 *   - No Math.random in visuals.
 */
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { subscribe as subscribeRegistry } from '@/lib/brain/npc/npcRegistry';
import type { Npc } from '@/lib/brain/npc/npcTypes';
import { anchorOnEarth, BODY_SHELL_RADIUS, getEarthPose } from '@/lib/brain/earth';
import { BuilderBlockView } from '@/components/brain/builder/BuilderBlockView';
import { listResourceSites } from '@/lib/world/baseResources';
import { onNpcDecision } from '@/lib/brain/npc/npc.bus';
import { bootNpcWorld } from '@/lib/brain/npc/bootNpcWorld';

/** Stable color from id hash → HSL string. */
function colorFromId(id: string): string {
  let h = 5381 >>> 0;
  for (let i = 0; i < id.length; i++) h = (((h << 5) + h) ^ id.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

function NpcBodies({ npc }: { npc: Npc }) {
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
    // Pulse decay — 1.0 → 1.15 → 1.0 over 0.4 s on resource-verb hits.
    if (pulseRef.current > 0) {
      pulseRef.current = Math.max(0, pulseRef.current - delta);
    }
  });

  return (
    <>
      {npc.body.map((slot) => (
        <BuilderBlockView key={`${npc.id}:${slot.kind}`} bodyId={`npc:${slot.kind}:${npc.id}:${slot.kind}`}>
          {() => <NpcBodyMesh slotKind={slot.kind} color={color} pulseRef={pulseRef} />}
        </BuilderBlockView>
      ))}
    </>
  );
}

function currentPulseScale(pulseRef: MutableRefObject<number>): number {
  if (pulseRef.current <= 0) return 1;
  const t = pulseRef.current / 0.4;
  return 1 + Math.sin(t * Math.PI) * 0.15;
}

function NpcBodyMesh({ slotKind, color, pulseRef }: { slotKind: Npc['body'][number]['kind']; color: string; pulseRef: MutableRefObject<number> }) {
  const ref = useRef<THREE.Mesh>(null);

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const s = currentPulseScale(pulseRef);
    mesh.scale.set(s, s, s);
  });

  if (slotKind === 'head') {
    return (
      <mesh ref={ref} castShadow>
        <sphereGeometry args={[0.32, 14, 12]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.06} />
      </mesh>
    );
  }
  if (slotKind === 'core') {
    return (
      <mesh ref={ref} castShadow>
        <capsuleGeometry args={[0.34, 1.1, 6, 12]} />
        <meshStandardMaterial color={color} roughness={0.62} metalness={0.04} />
      </mesh>
    );
  }
  return (
    <mesh ref={ref} castShadow rotation={[0, 0, slotKind.includes('arm') ? Math.PI / 2 : 0]}>
      <capsuleGeometry args={[0.16, 0.9, 4, 10]} />
      <meshStandardMaterial color={color} roughness={0.72} metalness={0.03} />
    </mesh>
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
    // Ensure NPCs are booted into the world as soon as the scene mounts —
    // don't rely solely on the deferred idle boot in main.tsx, which can
    // race with mobile preview timing and leave the world empty.
    void bootNpcWorld();
    const unsub = subscribeRegistry(setRoster);
    return () => { unsub(); };
  }, []);

  return (
    <group>
      {/* Only show resource markers once living NPCs exist — otherwise
          the user sees floating spheres with no inhabitants. */}
      {roster.length > 0 && <ResourceMarkers anchorId={anchorPeerId} />}
      {roster.map((npc) => (
        <NpcBodies key={npc.id} npc={npc} />
      ))}
    </group>
  );
}

export default NpcSwarmLayer;