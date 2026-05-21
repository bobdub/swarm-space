/**
 * UserPlacementsLayer — renders prefabs placed by users via AssetCaster.
 * Subscribes to `worldPlacementsStore` and wraps each record with
 * `BuilderBlockView` so the engine's tick-derived world transform drives
 * a simple box mesh sized + coloured from the prefab catalog.
 */
import { useEffect, useState } from 'react';
import { BuilderBlockView } from '@/components/brain/builder/BuilderBlockView';
import {
  listPlacements,
  subscribePlacements,
  type PlacementRecord,
} from '@/lib/world/worldPlacementsStore';
import { getPrefab } from '@/lib/brain/prefabHouseCatalog';

export function UserPlacementsLayer() {
  const [records, setRecords] = useState<PlacementRecord[]>(() => listPlacements());
  useEffect(() => subscribePlacements(setRecords), []);

  return (
    <>
      {records.map((rec) => {
        const prefab = getPrefab(rec.prefabId);
        if (!prefab) return null;
        const bodyId = `${prefab.id}:${rec.placementId}`;
        return (
          <BuilderBlockView key={bodyId} bodyId={bodyId}>
            {() => (
              <mesh position={[0, prefab.height / 2, 0]} castShadow receiveShadow>
                <boxGeometry args={[prefab.width, prefab.height, prefab.depth]} />
                <meshStandardMaterial color={prefab.color} roughness={0.7} metalness={0.05} />
              </mesh>
            )}
          </BuilderBlockView>
        );
      })}
    </>
  );
}