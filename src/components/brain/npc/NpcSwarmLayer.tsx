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