/**
 * UserPlacementsLayer — renders prefabs placed by users via AssetCaster.
 * Subscribes to `worldPlacementsStore` and wraps each record with
 * `BuilderBlockView` so the engine's tick-derived world transform drives
 * a simple box mesh sized + coloured from the prefab catalog.
 */
import { useEffect, useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import { BuilderBlockView } from '@/components/brain/builder/BuilderBlockView';
import {
  listPlacements,
  subscribePlacements,
  type PlacementRecord,
} from '@/lib/world/worldPlacementsStore';
import { getPrefab } from '@/lib/brain/prefabHouseCatalog';

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
  const pressedRef = useRef<string | null>(null);
  useEffect(() => subscribePlacements(setRecords), []);
  useEffect(() => {
    if (!selectedPlacementId) return;
    if (!records.some((rec) => rec.placementId === selectedPlacementId)) onSelectPlacement(null);
  }, [records, selectedPlacementId, onSelectPlacement]);

  return (
    <>
      {records.map((rec) => {
        const prefab = getPrefab(rec.prefabId);
        if (!prefab) return null;
        const bodyId = `${prefab.id}:${rec.placementId}`;
        return (
          <BuilderBlockView key={bodyId} bodyId={bodyId}>
            {() => {
              const selected = rec.placementId === selectedPlacementId;
              return (
                <group>
                  <mesh
                    position={[0, prefab.height / 2, 0]}
                    castShadow
                    receiveShadow
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      pressedRef.current = rec.placementId;
                    }}
                    onPointerUp={(e) => {
                      e.stopPropagation();
                      if (pressedRef.current === rec.placementId) onSelectPlacement(selected ? null : rec.placementId);
                      pressedRef.current = null;
                    }}
                    onPointerOut={() => {
                      if (pressedRef.current === rec.placementId) pressedRef.current = null;
                    }}
                  >
                    <boxGeometry args={[prefab.width, prefab.height, prefab.depth]} />
                    <meshStandardMaterial
                      color={prefab.color}
                      roughness={0.7}
                      metalness={0.05}
                      emissive={selected ? prefab.color : '#000000'}
                      emissiveIntensity={selected ? 0.28 : 0}
                    />
                  </mesh>
                  {selected && (
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