/**
 * UserPlacementsLayer — renders prefabs placed by users via AssetCaster.
 * Subscribes to `worldPlacementsStore` and wraps each record with
 * `BuilderBlockView` so the engine's tick-derived world transform drives
 * a simple box mesh sized + coloured from the prefab catalog.
 */
import { useEffect, useState } from 'react';
import { Html } from '@react-three/drei';
import { BuilderBlockView } from '@/components/brain/builder/BuilderBlockView';
import {
  listPlacements,
  subscribePlacements,
  removeLocalPlacement,
  type PlacementRecord,
} from '@/lib/world/worldPlacementsStore';
import { getPrefab } from '@/lib/brain/prefabHouseCatalog';
import {
  getHeldTool,
  setHeldTool,
  subscribeHeldTool,
  type HeldTool,
} from '@/lib/world/heldToolStore';
import { getToolTarget, setToolTarget, subscribeToolTarget } from '@/lib/world/toolTargetStore';
import { toolTargetFromPlacement, type ToolTarget } from '@/lib/world/toolTargets';

interface UserPlacementsLayerProps {
  selectedPlacementId: string | null;
  onSelectPlacement: (placementId: string | null) => void;
  onEditPlacement: (record: PlacementRecord) => void;
  onDeletePlacement: (record: PlacementRecord) => void;
}

export function UserPlacementsLayer({
  selectedPlacementId,
  onSelectPlacement,
  onEditPlacement,
  onDeletePlacement,
}: UserPlacementsLayerProps) {
  const [records, setRecords] = useState<PlacementRecord[]>(() => listPlacements());
  useEffect(() => subscribePlacements(setRecords), []);
  const [held, setHeld] = useState<HeldTool | null>(() => getHeldTool());
  useEffect(() => subscribeHeldTool(setHeld), []);
  const [toolTarget, setSelectedToolTarget] = useState<ToolTarget | null>(() => getToolTarget());
  useEffect(() => subscribeToolTarget(setSelectedToolTarget), []);
  useEffect(() => {
    if (!selectedPlacementId) return;
    if (!records.some((rec) => rec.placementId === selectedPlacementId)) onSelectPlacement(null);
  }, [records, selectedPlacementId, onSelectPlacement]);
  useEffect(() => {
    if (!toolTarget || toolTarget.kind !== 'placement') return;
    if (!records.some((rec) => rec.placementId === toolTarget.id)) setToolTarget(null);
  }, [records, toolTarget]);

  return (
    <>
      {records.map((rec) => {
        const prefab = getPrefab(rec.prefabId);
        if (!prefab) return null;
        const bodyId = `${prefab.id}:${rec.placementId}`;
        const isHoldable =
          prefab.sectionId === 'tools' || prefab.sectionId === 'consumables';
        return (
          <BuilderBlockView key={bodyId} bodyId={bodyId}>
            {() => {
              const selected = rec.placementId === selectedPlacementId;
              const targeted = toolTarget?.kind === 'placement' && toolTarget.id === rec.placementId;
              const tapWidth = Math.max(prefab.width + 0.42, 0.72);
              const tapHeight = Math.max(prefab.height + 0.42, 1.1);
              const tapDepth = Math.max(prefab.depth + 0.42, 0.72);
              return (
                <group>
                  <mesh
                    position={[0, prefab.height / 2, 0]}
                    castShadow
                    receiveShadow
                  >
                    <boxGeometry args={[prefab.width, prefab.height, prefab.depth]} />
                    <meshStandardMaterial
                      color={prefab.color}
                      roughness={0.7}
                      metalness={0.05}
                      emissive={selected || targeted ? prefab.color : '#000000'}
                      emissiveIntensity={selected ? 0.28 : targeted ? 0.2 : 0}
                      side={2}
                    />
                  </mesh>
                  <mesh
                    position={[0, prefab.height / 2, 0]}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (held) {
                         setToolTarget(
                           targeted ? null : toolTargetFromPlacement(rec, prefab.label),
                         );
                        return;
                      }
                       setToolTarget(null);
                      onSelectPlacement(selected ? null : rec.placementId);
                    }}
                  >
                    <boxGeometry args={[tapWidth, tapHeight, tapDepth]} />
                    <meshBasicMaterial transparent opacity={0} depthWrite={false} side={2} />
                  </mesh>
                  {selected && !held && (
                    <>
                      <mesh position={[0, prefab.height / 2, 0]}>
                        <boxGeometry args={[prefab.width + 0.08, prefab.height + 0.08, prefab.depth + 0.08]} />
                        <meshBasicMaterial color={prefab.color} wireframe transparent opacity={0.7} depthWrite={false} />
                      </mesh>
                      <Html
                        position={[0, prefab.height + 0.7, 0]}
                        center
                        distanceFactor={8}
                        zIndexRange={[100, 0]}
                        style={{ pointerEvents: 'auto', userSelect: 'none' }}
                      >
                        <div
                          onPointerDown={(e) => e.stopPropagation()}
                          style={{
                            display: 'flex',
                            gap: 6,
                            padding: '6px 8px',
                            borderRadius: 999,
                            background: 'hsla(265,70%,8%,0.92)',
                            border: '2px solid hsla(265,80%,65%,0.7)',
                            boxShadow: '0 0 16px hsla(265,80%,65%,0.45)',
                            fontFamily: 'system-ui, sans-serif',
                            fontSize: 12,
                            color: 'white',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {isHoldable && (
                            <button
                              type="button"
                              onClick={() => {
                                setHeldTool({ prefabId: rec.prefabId, source: rec });
                                setToolTarget(null);
                                void removeLocalPlacement(rec.placementId);
                                onSelectPlacement(null);
                              }}
                              style={{ ...btnStyle, color: '#86efac' }}
                            >
                              Pick up
                            </button>
                          )}
                          <button type="button" onClick={() => onEditPlacement(rec)} style={btnStyle}>Edit</button>
                          <button type="button" onClick={() => onDeletePlacement(rec)} style={{ ...btnStyle, color: '#fda4af' }}>Delete</button>
                        </div>
                      </Html>
                    </>
                  )}
                </group>
              );
            }}
          </BuilderBlockView>
        );
      })}
    </>
  );
}

const btnStyle: React.CSSProperties = {
  appearance: 'none',
  border: 'none',
  background: 'hsla(0,0%,100%,0.08)',
  color: 'white',
  borderRadius: 999,
  padding: '4px 10px',
  fontWeight: 700,
  cursor: 'pointer',
  minWidth: 48,
};