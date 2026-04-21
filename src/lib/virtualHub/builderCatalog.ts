import type { HubPieceKind, HubPieceSection } from "@/types";
import { getCompound } from "./compoundCatalog";

export interface BuilderItem {
  kind: HubPieceKind;
  label: string;
  /** Resolved compound id (e.g. "limestone", "steel"). */
  compoundId: string;
  /** Display formula for tiles & hover labels. */
  formula: string;
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

function withCompound(
  kind: HubPieceKind,
  dims: { width: number; depth: number; height: number; yCentre: number },
): BuilderItem {
  const c = getCompound(kind);
  return {
    kind,
    label: c.name,
    compoundId: c.id,
    formula: c.formula,
    ...dims,
  };
}

export const HOUSE_PREFAB: BuilderPrefab = {
  id: "house",
  label: "House",
  sections: [
    {
      id: "walls",
      label: "Walls",
      items: [
        withCompound("wall_short", { width: 2, depth: 0.15, height: 2.5, yCentre: 1.25 }),
        withCompound("wall_long", { width: 4, depth: 0.15, height: 2.5, yCentre: 1.25 }),
        withCompound("wall_half", { width: 4, depth: 0.15, height: 1.25, yCentre: 0.625 }),
      ],
    },
    {
      id: "doors",
      label: "Doors",
      items: [
        withCompound("door_single", { width: 2, depth: 0.15, height: 2.5, yCentre: 1.25 }),
        withCompound("door_double", { width: 3, depth: 0.15, height: 2.5, yCentre: 1.25 }),
      ],
    },
    {
      id: "windows",
      label: "Windows",
      items: [
        withCompound("window_square", { width: 2, depth: 0.15, height: 2.5, yCentre: 1.25 }),
        withCompound("window_wide", { width: 4, depth: 0.15, height: 2.5, yCentre: 1.25 }),
      ],
    },
    {
      id: "roof",
      label: "Roof",
      items: [
        withCompound("roof_flat", { width: 4, depth: 4, height: 0.1, yCentre: 2.55 }),
        withCompound("roof_gable", { width: 4, depth: 4, height: 1.2, yCentre: 3.1 }),
      ],
    },
    {
      id: "floor",
      label: "Floor",
      items: [
        withCompound("floor_2", { width: 2, depth: 2, height: 0.04, yCentre: 0.02 }),
        withCompound("floor_4", { width: 4, depth: 4, height: 0.04, yCentre: 0.02 }),
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