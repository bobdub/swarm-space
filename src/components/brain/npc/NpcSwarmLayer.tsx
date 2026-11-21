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
import { BuilderBlockView } from '@/components/brain/builder/BuilderBlockView';
import { onNpcDecision } from '@/lib/brain/npc/npc.bus';
import { bootNpcWorld } from '@/lib/brain/npc/bootNpcWorld';
import { subscribeDroppedTools, toolsOwnedByNpc } from '@/lib/world/droppedToolsStore';
import { toolKindOf, type NpcToolKind } from '@/lib/brain/npc/npcTools';
import { getPrefab } from '@/lib/brain/prefabHouseCatalog';

/** Stable color from id hash → HSL string. */
function colorFromId(id: string): string {
  let h = 5381 >>> 0;
  for (let i = 0; i < id.length; i++) h = (((h << 5) + h) ^ id.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

/** The tool kind a drive works with, so the NPC holds the right one. */
const DRIVE_TOOL: Partial<Record<string, NpcToolKind>> = {
  gather: 'chop',
  craft: 'chop',
  hunt: 'whittle',
  drink: 'carry',
};

/** Tools this NPC picked up (prefab ids), kept live as pickups land. */
function useOwnedTools(npcName: string): string[] {
  const [owned, setOwned] = useState<string[]>(() => toolsOwnedByNpc(npcName));
  useEffect(() => {
    const refresh = () => setOwned((prev) => {
      const next = toolsOwnedByNpc(npcName);
      return next.length === prev.length && next.every((id, i) => id === prev[i]) ? prev : next;
    });
    refresh();
    return subscribeDroppedTools(refresh);
  }, [npcName]);
  return owned;
}

/** Which owned tool is in hand: the one the current work needs, else the first. */
function toolInHand(owned: string[], drive: string | undefined): string | null {
  if (owned.length === 0) return null;
  const want = drive ? DRIVE_TOOL[drive] : undefined;
  return (want && owned.find((id) => toolKindOf(id) === want)) || owned[0];
}

function HeldToolMesh({ prefabId }: { prefabId: string }) {
  const prefab = getPrefab(prefabId);
  const color = prefab?.color ?? '#9ca3af';
  if (toolKindOf(prefabId) === 'carry') {
    return (
      <mesh position={[0.24, -0.12, 0.04]} castShadow>
        <cylinderGeometry args={[0.07, 0.06, 0.11, 12]} />
        <meshStandardMaterial color={color} roughness={0.8} />
      </mesh>
    );
  }
  return (
    <group position={[0.22, 0.0, 0.05]}>
      <mesh castShadow>
        <cylinderGeometry args={[0.014, 0.014, 0.42, 8]} />
        <meshStandardMaterial color="#8b5a2b" roughness={0.85} />
      </mesh>
      <mesh position={[0.03, 0.19, 0]} castShadow>
        <boxGeometry args={[0.08, 0.05, 0.02]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.2} />
      </mesh>
    </group>
  );
}

function NpcBodies({ npc }: { npc: Npc }) {
  const pulseRef = useRef<number>(0); // seconds remaining on pulse

  const color = useMemo(() => colorFromId(npc.id), [npc.id]);
  const owned = useOwnedTools(npc.name);
  const inHand = toolInHand(owned, npc.currentDrive);

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
          {() => (
            <>
              <NpcBodyMesh slotKind={slot.kind} color={color} pulseRef={pulseRef} />
              {slot.kind === 'arm_r' && inHand && <HeldToolMesh prefabId={inHand} />}
            </>
          )}
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
    // Idle bodies sit at scale 1: skip the matrix write so dozens of slots stay quiet.
    if (mesh.scale.x === s) return;
    mesh.scale.set(s, s, s);
  });

  if (slotKind === 'head') {
    return (
      <mesh ref={ref} castShadow>
        <sphereGeometry args={[0.13, 14, 12]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.06} />
      </mesh>
    );
  }
  if (slotKind === 'core') {
    return (
      <mesh ref={ref} castShadow>
        <capsuleGeometry args={[0.14, 0.44, 6, 12]} />
        <meshStandardMaterial color={color} roughness={0.62} metalness={0.04} />
      </mesh>
    );
  }
  return (
    <mesh ref={ref} castShadow rotation={[0, 0, slotKind.includes('arm') ? Math.PI / 2 : 0]}>
      <capsuleGeometry args={[0.065, 0.36, 4, 10]} />
      <meshStandardMaterial color={color} roughness={0.72} metalness={0.03} />
    </mesh>
  );
}

export function NpcSwarmLayer({ anchorPeerId }: { anchorPeerId: string }) {
  const [roster, setRoster] = useState<Npc[]>([]);

  useEffect(() => {
    // Boot NPCs anchored to the shared village frame so they appear in
    // the same world site the camera + WetWorkHabitat live on.
    void bootNpcWorld(anchorPeerId);
    const unsub = subscribeRegistry(setRoster);
    return () => { unsub(); };
  }, [anchorPeerId]);

  return (
    <group>
      {roster.map((npc) => (
        <NpcBodies key={npc.id} npc={npc} />
      ))}
    </group>
  );
}

export default NpcSwarmLayer;