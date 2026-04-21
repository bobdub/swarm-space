import type { HubPieceKind, HubPieceSection } from "@/types";

export interface BuilderItem {
  kind: HubPieceKind;
  label: string;
  /** Footprint in metres on the XZ plane (used for snapping & ghost preview). */
  width: number;
  depth: number;
  /** Height in metres (Y). */
  height: number;
  /** Y-offset for the piece centre. */
  yCentre: number;
}

export interface BuilderSection {
  id: HubPieceSection;
  label: string;
  items: BuilderItem[];
}

export interface BuilderPrefab {
  id: string;
  label: string;
  sections: BuilderSection[];
}

export const HOUSE_PREFAB: BuilderPrefab = {
  id: "house",
  label: "House",
  sections: [
    {
      id: "walls",
      label: "Walls",
      items: [
        { kind: "wall_short", label: "Short Wall", width: 2, depth: 0.15, height: 2.5, yCentre: 1.25 },
        { kind: "wall_long", label: "Long Wall", width: 4, depth: 0.15, height: 2.5, yCentre: 1.25 },
        { kind: "wall_half", label: "Half Wall", width: 4, depth: 0.15, height: 1.25, yCentre: 0.625 },
      ],
    },
    {
      id: "doors",
      label: "Doors",
      items: [
        { kind: "door_single", label: "Single Door", width: 2, depth: 0.15, height: 2.5, yCentre: 1.25 },
        { kind: "door_double", label: "Double Door", width: 3, depth: 0.15, height: 2.5, yCentre: 1.25 },
      ],
    },
    {
      id: "windows",
      label: "Windows",
      items: [
        { kind: "window_square", label: "Square Window", width: 2, depth: 0.15, height: 2.5, yCentre: 1.25 },
        { kind: "window_wide", label: "Wide Window", width: 4, depth: 0.15, height: 2.5, yCentre: 1.25 },
      ],
    },
    {
      id: "roof",
      label: "Roof",
      items: [
        { kind: "roof_flat", label: "Flat Roof", width: 4, depth: 4, height: 0.1, yCentre: 2.55 },
        { kind: "roof_gable", label: "Gable Roof", width: 4, depth: 4, height: 1.2, yCentre: 3.1 },
      ],
    },
    {
      id: "floor",
      label: "Floor",
      items: [
        { kind: "floor_2", label: "Floor 2x2", width: 2, depth: 2, height: 0.04, yCentre: 0.02 },
        { kind: "floor_4", label: "Floor 4x4", width: 4, depth: 4, height: 0.04, yCentre: 0.02 },
      ],
    },
  ],
};

export const PREFABS: BuilderPrefab[] = [HOUSE_PREFAB];

const ITEM_INDEX = new Map<HubPieceKind, BuilderItem>();
for (const prefab of PREFABS) {
  for (const section of prefab.sections) {
    for (const item of section.items) {
      ITEM_INDEX.set(item.kind, item);
    }
  }
}

export function getBuilderItem(kind: HubPieceKind): BuilderItem | undefined {
  return ITEM_INDEX.get(kind);
}

export function sectionForKind(kind: HubPieceKind): HubPieceSection {
  for (const prefab of PREFABS) {
    for (const section of prefab.sections) {
      if (section.items.some((i) => i.kind === kind)) return section.id;
    }
  }
  return "walls";
}