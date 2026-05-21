/**
 * PlacementInteractor — Phase 5 World Tools surface.
 *
 * Mounts inside the BrainUniverseScene Canvas. When builder mode is on
 * AND a prefab is selected, an invisible raycast sphere co-locates with
 * Earth and turns pointer events into hit points. A ghost mesh previews
 * the placement; click commits via `placePrefabAtHit` and persists via
 * `recordLocalPlacement`.
 *
 * Honors invariants: no `<form>`, type="button" semantics not needed
 * (R3F event), routes through builderBlockEngine + scaffold bus.
 */
import { useMemo, useRef, useState } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { EARTH_RADIUS, getEarthPose } from '@/lib/brain/earth';
import { getPrefab } from '@/lib/brain/prefabHouseCatalog';
import { placePrefabAtHit } from '@/lib/world/placementController';
import { recordLocalPlacement } from '@/lib/world/worldPlacementsStore';
import type { UseBrainBuilder } from '@/lib/brain/useBrainBuilder';

interface Props {
  builder: UseBrainBuilder;
  actorId: string;
}

export function PlacementInteractor({ builder, actorId }: Props) {
  const sphereRef = useRef<THREE.Mesh>(null);
  const ghostRef = useRef<THREE.Group>(null);
  const [hover, setHover] = useState<[number, number, number] | null>(null);

  const active = builder.mode === 'build' && !!builder.selectedPrefabId;
  const prefab = useMemo(
    () => (builder.selectedPrefabId ? getPrefab(builder.selectedPrefabId) : undefined),
    [builder.selectedPrefabId],
  );

  // Keep raycast sphere centred on Earth as it orbits/spins.
  useFrame(() => {
    const pose = getEarthPose();
    if (sphereRef.current) {
      sphereRef.current.position.set(pose.center[0], pose.center[1], pose.center[2]);
      sphereRef.current.visible = active;
    }
    if (ghostRef.current) {
      ghostRef.current.visible = active && hover !== null;
      if (hover) ghostRef.current.position.set(hover[0], hover[1], hover[2]);
    }
  });

  if (!active) return null;

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHover([e.point.x, e.point.y, e.point.z]);
  };
  const handleOut = () => setHover(null);
  const commitPlacement = async (hit: [number, number, number]) => {
    if (!builder.selectedPrefabId) return;
    const handle = placePrefabAtHit({
      hitPoint: hit,
      prefabId: builder.selectedPrefabId,
      actorId,
    });
    if (handle) await recordLocalPlacement(handle);
  };
  const handlePointerDown = async (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const hit: [number, number, number] = [e.point.x, e.point.y, e.point.z];
    await commitPlacement(hit);
  };

  // Ghost dimensions — fall back to a small marker if no prefab found.
  const w = prefab?.width ?? 0.5;
  const h = prefab?.height ?? 0.5;
  const d = prefab?.depth ?? 0.5;
  const color = prefab?.color ?? '#7ad3ff';

  return (
    <>
      {/* Invisible raycast shell — slightly above the Earth so clicks
          register before hitting decorative meshes. */}
      <mesh
        ref={sphereRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handleMove}
        onPointerOut={handleOut}
      >
        <sphereGeometry args={[EARTH_RADIUS + 0.05, 48, 32]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <group ref={ghostRef}>
        <mesh>
          <boxGeometry args={[w, h, d]} />
          <meshStandardMaterial color={color} transparent opacity={0.45} emissive={color} emissiveIntensity={0.3} />
        </mesh>
      </group>
    </>
  );
}