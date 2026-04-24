/**
 * ═══════════════════════════════════════════════════════════════════════
 * COSMO CHEMISTRY — chemical registry for non-builder bodies
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Sister registry to `compoundCatalog` (which binds builder pieces). This
 * one binds every visible cosmic / geological body in `/brain` — Sun,
 * Moon, galactic core, named stars, atmosphere, water, volcano vent gas —
 * to real constituent symbols already present in `SHELL_DEFS` ∪
 * `INNER_SYMBOLS`.
 *
 * Colour flows through the SAME `blendColor()` used by the builder so
 * the universe shares one palette. No new elements introduced; "Ni" is
 * proxied by Fe (same shell, same metal family) since the periodic table
 * baked into the field stops at the n=3 d-block subset.
 *
 * NO field-engine changes. This module is colour + metadata only.
 * Determinism preserved (static data, no PRNG, no time term).
 */
import { blendColor, ELEMENT_COLORS, type CompoundConstituent } from "@/lib/virtualHub/compoundCatalog";

export type CosmoBodyKind =
  | "sun"
  | "moon"
  | "galactic_core"
  | "star_main_sequence"
  | "star_dim"
  | "atmosphere"
  | "water"
  | "vent_gas";

export interface CosmoCompound {
  id: string;
  name: string;
  formula: string;
  constituents: CompoundConstituent[];
  /** Hex colour blended deterministically from constituents. */
  color: string;
  /** Approximate bulk density g/cm³ — informational only. */
  density: number;
}

const DEFS: Record<CosmoBodyKind, Omit<CosmoCompound, "color">> = {
  sun: {
    id: "stellar_plasma",
    name: "Solar Plasma",
    formula: "H + He",
    constituents: [
      { symbol: "H", count: 91 },
      { symbol: "He", count: 9 },
    ],
    density: 1.4,
  },
  moon: {
    id: "lunar_regolith",
    name: "Lunar Regolith",
    formula: "SiO₂ + FeO + MgO + Al₂O₃ + CaO",
    constituents: [
      { symbol: "Si", count: 21 },
      { symbol: "O", count: 43 },
      { symbol: "Fe", count: 6 },
      { symbol: "Mg", count: 6 },
      { symbol: "Al", count: 7 },
      { symbol: "Ca", count: 8 },
    ],
    density: 3.34,
  },
  galactic_core: {
    // Iron-peak collapse remnant. Ni proxied by Fe (same shell n=3).
    id: "iron_core",
    name: "Iron-Peak Core",
    formula: "Fe + Cr (Ni→Fe proxy)",
    constituents: [
      { symbol: "Fe", count: 70 },
      { symbol: "Cr", count: 20 },
      { symbol: "S", count: 5 },
      { symbol: "Si", count: 5 },
    ],
    density: 8.0,
  },
  star_main_sequence: {
    id: "ms_star",
    name: "Main-Sequence Star",
    formula: "H + He (low metallicity)",
    constituents: [
      { symbol: "H", count: 73 },
      { symbol: "He", count: 25 },
      { symbol: "O", count: 1 },
      { symbol: "C", count: 1 },
    ],
    density: 1.4,
  },
  star_dim: {
    // K/M-class proxy — cooler, more metal-line absorption → redder tint.
    id: "dim_star",
    name: "Dim Cool Star",
    formula: "H + He + Fe-line absorption",
    constituents: [
      { symbol: "H", count: 60 },
      { symbol: "He", count: 25 },
      { symbol: "Fe", count: 8 },
      { symbol: "Ca", count: 4 },
      { symbol: "O", count: 3 },
    ],
    density: 1.6,
  },
  atmosphere: {
    id: "earth_air",
    name: "Atmosphere",
    formula: "N₂ + O₂ + Ar + CO₂",
    constituents: [
      { symbol: "N", count: 78 },
      { symbol: "O", count: 21 },
      { symbol: "Ar", count: 1 },
      { symbol: "C", count: 1 },
    ],
    density: 0.0012,
  },
  water: {
    id: "water_h2o",
    name: "Water",
    formula: "H₂O",
    constituents: [
      { symbol: "H", count: 2 },
      { symbol: "O", count: 1 },
    ],
    density: 1.0,
  },
  vent_gas: {
    // Stratovolcano emission blend — H₂O dominant, CO₂ + SO₂ trace.
    id: "vent_gas",
    name: "Volcanic Vent Gas",
    formula: "H₂O + CO₂ + SO₂",
    constituents: [
      { symbol: "H", count: 12 },
      { symbol: "O", count: 14 },
      { symbol: "C", count: 3 },
      { symbol: "S", count: 2 },
    ],
    density: 0.002,
  },
};

export const COSMO_COMPOUNDS: Record<CosmoBodyKind, CosmoCompound> = (() => {
  const out = {} as Record<CosmoBodyKind, CosmoCompound>;
  for (const k of Object.keys(DEFS) as CosmoBodyKind[]) {
    const d = DEFS[k];
    out[k] = { ...d, color: blendColor(d.constituents) };
  }
  return out;
})();

export function getCosmoCompound(kind: CosmoBodyKind): CosmoCompound {
  return COSMO_COMPOUNDS[kind];
}

/**
 * Hex → [r,g,b] in 0..1 — used by Three.js consumers that need to feed
 * a vec3 into a shader uniform.
 */
export function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

/**
 * Star tint as a function of brightness. Hot/bright stars sit close to
 * the main-sequence H/He blend (whiter); dim stars lean toward the
 * Fe-line dim-star blend (redder). Pure render-time lerp — no PRNG.
 */
export function starTint(brightness: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, brightness));
  const hot = hexToRgb01(COSMO_COMPOUNDS.star_main_sequence.color);
  const cool = hexToRgb01(COSMO_COMPOUNDS.star_dim.color);
  return [
    cool[0] * (1 - t) + hot[0] * t,
    cool[1] * (1 - t) + hot[1] * t,
    cool[2] * (1 - t) + hot[2] * t,
  ];
}

// Re-export for consumers that need raw element colours.
export { ELEMENT_COLORS };
