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
    }
  | {
      /** Bare ground resolved down to an Earth shell — diggable. */
      kind: 'shell';
      id: string;
      label: string;
      /** World-space hit point on the ground. */
      point: Vec3;
      /** Earth-LOCAL unit normal (spin invariant) of the dig cell. */
      localNormal: Vec3;
      /** Quantised dig cell key. */
      cellKey: string;
      /** Current pit depth (m) before this swing. */
      depth: number;
      /** Shell id at the current pit floor. */
      shellId: string;
    };


export function toolTargetFromPlacement(record: PlacementRecord, label: string): ToolTarget {
  return {
    kind: 'placement',
    id: record.placementId,
    label,
    placement: record,
  };
}
