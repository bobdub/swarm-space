import type { Vec3 } from '@/lib/brain/earth';
import type { PlacementRecord } from '@/lib/world/worldPlacementsStore';

export type SurfaceTargetKind = 'ground' | 'water';

export type ToolTarget =
  | {
      kind: 'placement';
      id: string;
      label: string;
      placement: PlacementRecord;
    }
  | {
      kind: 'nature';
      id: string;
      label: string;
      natureKind: string;
      blockId: string;
    }
  | {
      kind: 'surface';
      id: string;
      label: string;
      surfaceKind: SurfaceTargetKind;
      point: Vec3;
    };

export function toolTargetFromPlacement(record: PlacementRecord, label: string): ToolTarget {
  return {
    kind: 'placement',
    id: record.placementId,
    label,
    placement: record,
  };
}
