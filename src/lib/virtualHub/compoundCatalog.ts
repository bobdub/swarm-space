/**
 * Builder pieces as real chemical compounds.
 *
 * Each HubPieceKind maps to a real building-material compound. Constituent
 * symbols MUST exist in the periodic table baked into the field
 * (`SHELL_DEFS` ∪ `INNER_SYMBOLS` in `lib/brain/elements.ts`). Colors are
 * derived deterministically from constituents using a shared
 * `ELEMENT_COLORS` palette also consumed by `ElementsVisual.tsx`, so the
 * universe and the builder agree on what each element looks like.
 */
import type { HubPieceKind } from "@/types";

export interface CompoundConstituent {
  symbol: string;
  count: number;
}

export interface Compound {
  id: string;
  name: string;
  formula: string;
  constituents: CompoundConstituent[];
  /** Hex color derived from constituents (deterministic). */
  color: string;
  /** Approximate density g/cm³ — informational only. */
  density: number;
  /** UQRC shell tags inferred from constituent shells. */
  shellTags: number[];
}

/**
 * Per-element colors. Single source of truth shared with ElementsVisual.tsx.
 * Hex strings (THREE.Color compatible). Approximate CPK with shell-aware tweaks.
 */
export const ELEMENT_COLORS: Record<string, string> = {
  // n=0
  H: "#f5f5f5",
  // n=1
  Li: "#cc80ff", Be: "#c2ff00", B: "#ffb5b5", He: "#d9ffff",
  // n=2
  Na: "#ab5cf2", Mg: "#8aff00", Al: "#bfa6a6", Si: "#f0c8a0",
  P: "#ff8000", C: "#3a3a3a", N: "#3050f8", O: "#ff3030", F: "#90e050", Ne: "#b3e3f5",
  // n=3
  K: "#8f40d4", Ca: "#3dff00", Sc: "#e6e6e6", Ti: "#bfc2c7", V: "#a6a6ab",
  S: "#ffff30", Cl: "#1ff01f", Cr: "#8a99c7", Fe: "#e06633", Ar: "#80d1e3",
};

const ELEMENT_SHELL: Record<string, number> = {
  H: 0,
  Li: 1, Be: 1, B: 1, He: 1,
  Na: 2, Mg: 2, Al: 2, Si: 2, P: 2, C: 2, N: 2, O: 2, F: 2, Ne: 2,
  K: 3, Ca: 3, Sc: 3, Ti: 3, V: 3, S: 3, Cl: 3, Cr: 3, Fe: 3, Ar: 3,
};

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Deterministic weighted blend of constituent element colors. */
export function blendColor(constituents: CompoundConstituent[]): string {
  let r = 0, g = 0, b = 0, total = 0;
  for (const { symbol, count } of constituents) {
    const hex = ELEMENT_COLORS[symbol];
    if (!hex) continue;
    const [cr, cg, cb] = hexToRgb(hex);
    r += cr * count;
    g += cg * count;
    b += cb * count;
    total += count;
  }
  if (total === 0) return "#888888";
  return rgbToHex(r / total, g / total, b / total);
}

function shellTagsOf(constituents: CompoundConstituent[]): number[] {
  const set = new Set<number>();
  for (const { symbol } of constituents) {
    const n = ELEMENT_SHELL[symbol];
    if (n !== undefined) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

interface CompoundDef {
  id: string;
  name: string;
  formula: string;
  constituents: CompoundConstituent[];
  density: number;
}

const DEFS: Record<HubPieceKind, CompoundDef> = {
  // Floors — calcium silicate hydrate (concrete)
  floor_2: {
    id: "concrete",
    name: "Concrete Slab",
    formula: "CaO·SiO₂·H₂O",
    constituents: [{ symbol: "Ca", count: 1 }, { symbol: "Si", count: 1 }, { symbol: "O", count: 4 }, { symbol: "H", count: 2 }],
    density: 2.4,
  },
  floor_4: {
    id: "concrete",
    name: "Concrete Slab",
    formula: "CaO·SiO₂·H₂O",
    constituents: [{ symbol: "Ca", count: 1 }, { symbol: "Si", count: 1 }, { symbol: "O", count: 4 }, { symbol: "H", count: 2 }],
    density: 2.4,
  },
  // Walls
  wall_short: {
    id: "kaolinite",
    name: "Adobe Wall",
    formula: "Al₂O₃·2SiO₂·2H₂O",
    constituents: [{ symbol: "Al", count: 2 }, { symbol: "Si", count: 2 }, { symbol: "O", count: 9 }, { symbol: "H", count: 4 }],
    density: 2.6,
  },
  wall_long: {
    id: "limestone",
    name: "Limestone Wall",
    formula: "CaCO₃",
    constituents: [{ symbol: "Ca", count: 1 }, { symbol: "C", count: 1 }, { symbol: "O", count: 3 }],
    density: 2.7,
  },
  wall_half: {
    id: "gypsum",
    name: "Gypsum Panel",
    formula: "CaSO₄·2H₂O",
    constituents: [{ symbol: "Ca", count: 1 }, { symbol: "S", count: 1 }, { symbol: "O", count: 6 }, { symbol: "H", count: 4 }],
    density: 2.3,
  },
  // Doors
  door_single: {
    id: "cellulose",
    name: "Oak Door",
    formula: "(C₆H₁₀O₅)ₙ",
    constituents: [{ symbol: "C", count: 6 }, { symbol: "H", count: 10 }, { symbol: "O", count: 5 }],
    density: 0.75,
  },
  door_double: {
    id: "steel",
    name: "Steel Door",
    formula: "Fe·C·Cr",
    constituents: [{ symbol: "Fe", count: 18 }, { symbol: "C", count: 1 }, { symbol: "Cr", count: 1 }],
    density: 7.85,
  },
  // Windows
  window_square: {
    id: "soda_lime_glass",
    name: "Soda-Lime Pane",
    formula: "Na₂O·CaO·6SiO₂",
    constituents: [{ symbol: "Na", count: 2 }, { symbol: "Ca", count: 1 }, { symbol: "Si", count: 6 }, { symbol: "O", count: 14 }],
    density: 2.5,
  },
  window_wide: {
    id: "borosilicate",
    name: "Borosilicate Pane",
    formula: "B₂O₃·SiO₂",
    constituents: [{ symbol: "B", count: 2 }, { symbol: "Si", count: 1 }, { symbol: "O", count: 5 }],
    density: 2.23,
  },
  // Roof
  roof_flat: {
    id: "bitumen_aluminium",
    name: "Bitumen-Al Roof",
    formula: "Al + (CₙH₂ₙ₊₂)",
    constituents: [{ symbol: "Al", count: 4 }, { symbol: "C", count: 12 }, { symbol: "H", count: 26 }],
    density: 1.8,
  },
  roof_gable: {
    id: "terracotta",
    name: "Terracotta Tile",
    formula: "Fe₂O₃·Al₂O₃·SiO₂",
    constituents: [{ symbol: "Fe", count: 2 }, { symbol: "Al", count: 2 }, { symbol: "Si", count: 1 }, { symbol: "O", count: 8 }],
    density: 2.0,
  },
};

const TABLE: Record<HubPieceKind, Compound> = (() => {
  const out = {} as Record<HubPieceKind, Compound>;
  for (const k of Object.keys(DEFS) as HubPieceKind[]) {
    const d = DEFS[k];
    out[k] = {
      id: d.id,
      name: d.name,
      formula: d.formula,
      constituents: d.constituents,
      color: blendColor(d.constituents),
      density: d.density,
      shellTags: shellTagsOf(d.constituents),
    };
  }
  return out;
})();

export const COMPOUND_TABLE: Record<HubPieceKind, Compound> = TABLE;

export function getCompound(kind: HubPieceKind): Compound {
  return COMPOUND_TABLE[kind];
}
