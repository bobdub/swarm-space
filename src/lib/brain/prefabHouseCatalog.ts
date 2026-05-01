/**
 * ═══════════════════════════════════════════════════════════════════════
 * PREFAB HOUSE CATALOG — UQRC building blocks for the Brain Builder Bar
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Every prefab is a real chemical compound whose constituents MUST exist
 * in the periodic table baked into the field (`SHELL_DEFS ∪ INNER_SYMBOLS`
 * in `src/lib/brain/elements.ts`). Mass, water-resistance, flammability,
 * and curvature-basin radius are derived from the constituents — never
 * free-floating numbers.
 *
 * UQRC anchors:
 *   • Color  = deterministic blend of element colors (`compoundCatalog`).
 *   • Mass   = Σ(atomic-mass-proxy · count) · volume · density.
 *   • Basin  = (w·d·h)^(1/3) · 0.35, clamped — heavier pieces own a
 *              wider curvature well written by `pinSupportBasin`.
 *   • H₂O   = inferred from n=2 closure (oxide formers) minus soluble
 *             alkali (Na, K).  Range 0..1.
 *   • Fire  = weighted (C+H) mass fraction minus mineral mass (Si, Ca,
 *             Fe, Al). Range 0..1.
 *
 * The catalog is a pure data module; it never touches the field, the
 * physics engine, or React. Placement flows through
 * `getBuilderBlockEngine().placeBlock(...)`.
 */
import { SHELL_DEFS, INNER_SYMBOLS } from '@/lib/brain/elements';
import { ELEMENT_COLORS, blendColor } from '@/lib/virtualHub/compoundCatalog';

export type PrefabSectionId =
  | 'foundations'
  | 'floors'
  | 'walls'
  | 'doors'
  | 'windows'
  | 'roofs'
  | 'tools'
  | 'consumables';

export interface PrefabConstituent {
  symbol: string;
  count: number;
}

export interface PrefabSpec {
  /** Stable id used as the BuilderBlock kind suffix. */
  id: string;
  label: string;
  sectionId: PrefabSectionId;
  /** Compound formula (display only). */
  formula: string;
  /** Real elements composing this prefab. */
  constituents: PrefabConstituent[];
  /** Bulk density, g/cm³ (informational + mass derivation). */
  density: number;
  /** Bounding dimensions in metres (width, depth, height). */
  width: number;
  depth: number;
  height: number;
  /** Yaw snap step in radians — π/2 by default for orthogonal builds. */
  yawSnapStep: number;
}

export interface PrefabDerived {
  /** Hex color blended from constituent element colors. */
  color: string;
  /** UQRC body mass, kg. */
  mass: number;
  /** Curvature-basin radius (metres) for `pinSupportBasin`. */
  basin: number;
  /** 0..1 — higher is more water-tolerant. */
  waterResistance: number;
  /** 0..1 — higher is more flammable. */
  flammability: number;
  /** Shell tags inferred from constituents (n = 0..3). */
  shellTags: number[];
}

export interface Prefab extends PrefabSpec, PrefabDerived {}

// ─────────────────────────────────────────────────────────────────────────
//  Periodic-table guardrail
// ─────────────────────────────────────────────────────────────────────────

const PERIODIC_SYMBOLS: Set<string> = (() => {
  const set = new Set<string>();
  for (const shell of SHELL_DEFS) for (const s of shell.symbols) set.add(s);
  for (const s of INNER_SYMBOLS) set.add(s);
  return set;
})();

const ELEMENT_SHELL: Record<string, number> = (() => {
  const out: Record<string, number> = {};
  for (const shell of SHELL_DEFS) for (const s of shell.symbols) out[s] = shell.n;
  for (const s of INNER_SYMBOLS) out[s] = 4;
  return out;
})();

/** Atomic-mass proxies (g/mol) for the elements present in the field. */
const ATOMIC_MASS: Record<string, number> = {
  H: 1, He: 4,
  Li: 7, Be: 9, B: 11, C: 12, N: 14, O: 16, F: 19, Ne: 20,
  Na: 23, Mg: 24, Al: 27, Si: 28, P: 31, S: 32, Cl: 35, Ar: 40,
  K: 39, Ca: 40, Sc: 45, Ti: 48, V: 51, Cr: 52, Fe: 56,
};

const MINERAL_SYMBOLS = new Set(['Si', 'Ca', 'Fe', 'Al', 'Mg', 'Ti']);
const SOLUBLE_SYMBOLS = new Set(['Na', 'K']);
const OXIDE_CLOSER = new Set(['O', 'Ne']); // n=2 closure participants

// ─────────────────────────────────────────────────────────────────────────
//  Prefab specs (House)
// ─────────────────────────────────────────────────────────────────────────

const SPECS: PrefabSpec[] = [
  // Foundations — granite slab (Si + O + Fe trace)
  {
    id: 'foundation_granite',
    label: 'Granite Foundation',
    sectionId: 'foundations',
    formula: 'SiO₂·Fe',
    constituents: [{ symbol: 'Si', count: 3 }, { symbol: 'O', count: 6 }, { symbol: 'Fe', count: 1 }],
    density: 2.7,
    width: 2.4, depth: 2.4, height: 0.3,
    yawSnapStep: Math.PI / 2,
  },
  // Floors — calcium silicate hydrate
  {
    id: 'floor_concrete',
    label: 'Concrete Floor',
    sectionId: 'floors',
    formula: 'CaO·SiO₂·H₂O',
    constituents: [{ symbol: 'Ca', count: 1 }, { symbol: 'Si', count: 1 }, { symbol: 'O', count: 4 }, { symbol: 'H', count: 2 }],
    density: 2.4,
    width: 2.0, depth: 2.0, height: 0.15,
    yawSnapStep: Math.PI / 2,
  },
  // Walls
  {
    id: 'wall_limestone',
    label: 'Limestone Wall',
    sectionId: 'walls',
    formula: 'CaCO₃',
    constituents: [{ symbol: 'Ca', count: 1 }, { symbol: 'C', count: 1 }, { symbol: 'O', count: 3 }],
    density: 2.7,
    width: 2.0, depth: 0.2, height: 2.4,
    yawSnapStep: Math.PI / 2,
  },
  {
    id: 'wall_oak',
    label: 'Oak Plank Wall',
    sectionId: 'walls',
    formula: '(C₆H₁₀O₅)ₙ',
    constituents: [{ symbol: 'C', count: 6 }, { symbol: 'H', count: 10 }, { symbol: 'O', count: 5 }],
    density: 0.75,
    width: 2.0, depth: 0.15, height: 2.4,
    yawSnapStep: Math.PI / 2,
  },
  // Doors
  {
    id: 'door_oak',
    label: 'Oak Door',
    sectionId: 'doors',
    formula: '(C₆H₁₀O₅)ₙ',
    constituents: [{ symbol: 'C', count: 6 }, { symbol: 'H', count: 10 }, { symbol: 'O', count: 5 }],
    density: 0.75,
    width: 0.9, depth: 0.08, height: 2.1,
    yawSnapStep: Math.PI / 2,
  },
  // Windows — soda-lime glass
  {
    id: 'window_pane',
    label: 'Glass Pane',
    sectionId: 'windows',
    formula: 'Na₂O·CaO·6SiO₂',
    constituents: [{ symbol: 'Na', count: 2 }, { symbol: 'Ca', count: 1 }, { symbol: 'Si', count: 6 }, { symbol: 'O', count: 14 }],
    density: 2.5,
    width: 1.2, depth: 0.05, height: 1.2,
    yawSnapStep: Math.PI / 2,
  },
  // Roofs
  {
    id: 'roof_terracotta',
    label: 'Terracotta Roof',
    sectionId: 'roofs',
    formula: 'Fe₂O₃·Al₂O₃·SiO₂',
    constituents: [{ symbol: 'Fe', count: 2 }, { symbol: 'Al', count: 2 }, { symbol: 'Si', count: 1 }, { symbol: 'O', count: 8 }],
    density: 2.0,
    width: 2.4, depth: 2.4, height: 0.2,
    yawSnapStep: Math.PI / 2,
  },
  // Tools — each tool placed in-world becomes a usable composite block.
  // Sub-part metadata (handle/head/binding) lives in `toolCatalog.ts`;
  // here we just publish the bounding compound so the Builder Bar can
  // render and place it through the same path as House prefabs.
  {
    id: 'tool_knife_stone',
    label: 'Stone Knife',
    sectionId: 'tools',
    formula: 'C₈·SiO₂',
    constituents: [{ symbol: 'C', count: 8 }, { symbol: 'Si', count: 3 }, { symbol: 'O', count: 6 }],
    density: 1.6,
    width: 0.04, depth: 0.02, height: 0.22,
    yawSnapStep: Math.PI / 4,
  },
  {
    id: 'tool_axe_stone',
    label: 'Stone Axe',
    sectionId: 'tools',
    formula: 'C₁₅·SiO₂',
    constituents: [{ symbol: 'C', count: 15 }, { symbol: 'Si', count: 6 }, { symbol: 'O', count: 12 }],
    density: 1.7,
    width: 0.18, depth: 0.06, height: 0.55,
    yawSnapStep: Math.PI / 4,
  },
  {
    id: 'tool_shovel_stone',
    label: 'Stone Shovel',
    sectionId: 'tools',
    formula: 'C₁₇·SiO₂',
    constituents: [{ symbol: 'C', count: 17 }, { symbol: 'Si', count: 8 }, { symbol: 'O', count: 16 }],
    density: 1.7,
    width: 0.22, depth: 0.04, height: 0.95,
    yawSnapStep: Math.PI / 4,
  },
  // Consumables — salt rock for honing tools.
  {
    id: 'consumable_salt_rock',
    label: 'Salt Rock',
    sectionId: 'consumables',
    formula: 'NaCl',
    constituents: [{ symbol: 'Na', count: 1 }, { symbol: 'Cl', count: 1 }],
    density: 2.16,
    width: 0.10, depth: 0.10, height: 0.08,
    yawSnapStep: Math.PI / 2,
  },
];

// ─────────────────────────────────────────────────────────────────────────
//  Derivation
// ─────────────────────────────────────────────────────────────────────────

function massFractions(c: PrefabConstituent[]): { total: number; frac: Record<string, number> } {
  let total = 0;
  const acc: Record<string, number> = {};
  for (const { symbol, count } of c) {
    const m = (ATOMIC_MASS[symbol] ?? 1) * count;
    acc[symbol] = (acc[symbol] ?? 0) + m;
    total += m;
  }
  const frac: Record<string, number> = {};
  if (total > 0) for (const k of Object.keys(acc)) frac[k] = acc[k] / total;
  return { total, frac };
}

function volumeM3(s: PrefabSpec): number {
  return s.width * s.depth * s.height;
}

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }

function deriveMass(s: PrefabSpec): number {
  // density g/cm³ → kg/m³ = ×1000.
  return volumeM3(s) * s.density * 1000;
}

function deriveBasin(s: PrefabSpec): number {
  const r = Math.cbrt(volumeM3(s)) * 0.35;
  return Math.max(0.18, Math.min(0.9, r));
}

function deriveWaterResistance(c: PrefabConstituent[]): number {
  const { frac } = massFractions(c);
  let oxide = 0, soluble = 0;
  for (const [sym, f] of Object.entries(frac)) {
    if (OXIDE_CLOSER.has(sym)) oxide += f;
    if (SOLUBLE_SYMBOLS.has(sym)) soluble += f;
  }
  // baseline 0.4, +oxide closure boost, − soluble penalty.
  return clamp01(0.4 + oxide * 0.9 - soluble * 1.2);
}

function deriveFlammability(c: PrefabConstituent[]): number {
  const { frac } = massFractions(c);
  const carbon = frac['C'] ?? 0;
  const hydrogen = frac['H'] ?? 0;
  let mineral = 0;
  for (const [sym, f] of Object.entries(frac)) if (MINERAL_SYMBOLS.has(sym)) mineral += f;
  return clamp01((carbon * 0.85 + hydrogen * 1.5) - mineral * 0.6);
}

function deriveShellTags(c: PrefabConstituent[]): number[] {
  const set = new Set<number>();
  for (const { symbol } of c) {
    const n = ELEMENT_SHELL[symbol];
    if (n !== undefined) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

function validateConstituents(spec: PrefabSpec): void {
  for (const { symbol } of spec.constituents) {
    if (!PERIODIC_SYMBOLS.has(symbol)) {
      throw new Error(
        `[prefabHouseCatalog] Unknown element "${symbol}" in prefab "${spec.id}". ` +
          `Add it to elements.ts SHELL_DEFS / INNER_SYMBOLS or remove it from the prefab.`,
      );
    }
    if (!ELEMENT_COLORS[symbol]) {
      throw new Error(
        `[prefabHouseCatalog] Element "${symbol}" missing from ELEMENT_COLORS palette.`,
      );
    }
  }
}

const PREFABS: Prefab[] = SPECS.map((s) => {
  validateConstituents(s);
  return {
    ...s,
    color: blendColor(s.constituents),
    mass: deriveMass(s),
    basin: deriveBasin(s),
    waterResistance: deriveWaterResistance(s.constituents),
    flammability: deriveFlammability(s.constituents),
    shellTags: deriveShellTags(s.constituents),
  };
});

const BY_ID: Record<string, Prefab> = (() => {
  const out: Record<string, Prefab> = {};
  for (const p of PREFABS) out[p.id] = p;
  return out;
})();

export const PREFAB_SECTIONS: { id: PrefabSectionId; label: string }[] = [
  { id: 'foundations', label: 'Foundations' },
  { id: 'floors', label: 'Floors' },
  { id: 'walls', label: 'Walls' },
  { id: 'doors', label: 'Doors' },
  { id: 'windows', label: 'Windows' },
  { id: 'roofs', label: 'Roofs' },
  { id: 'tools', label: 'Tools' },
  { id: 'consumables', label: 'Consumables' },
];

// ─────────────────────────────────────────────────────────────────────────
//  Runtime-registered prefabs (additive overlay; never persisted here).
//  Used by the Remix Lab to drop minted assets into the Builder Bar.
// ─────────────────────────────────────────────────────────────────────────
const RUNTIME: Map<string, Prefab> = new Map();
const RUNTIME_LISTENERS = new Set<() => void>();

function notifyRuntime(): void {
  for (const fn of RUNTIME_LISTENERS) {
    try { fn(); } catch { /* listener errors are non-fatal */ }
  }
}

export function registerCustomPrefab(prefab: Prefab): void {
  validateConstituents(prefab);
  RUNTIME.set(prefab.id, prefab);
  notifyRuntime();
}

export function unregisterCustomPrefab(id: string): void {
  if (RUNTIME.delete(id)) notifyRuntime();
}

export function subscribeCustomPrefabs(fn: () => void): () => void {
  RUNTIME_LISTENERS.add(fn);
  return () => { RUNTIME_LISTENERS.delete(fn); };
}

export function listPrefabs(): Prefab[] {
  return [...PREFABS, ...RUNTIME.values()];
}

export function listPrefabsBySection(sectionId: PrefabSectionId): Prefab[] {
  return listPrefabs().filter((p) => p.sectionId === sectionId);
}

export function getPrefab(id: string): Prefab | undefined {
  return RUNTIME.get(id) ?? BY_ID[id];
}

/** Test seam — exposes the periodic guardrail without importing privates. */
export function _periodicSymbolsForTest(): Set<string> { return PERIODIC_SYMBOLS; }