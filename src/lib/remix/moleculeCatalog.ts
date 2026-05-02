/**
 * ═══════════════════════════════════════════════════════════════════════
 * MOLECULE CATALOG — real molecules for the Elemental Alchemy Lab
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Pure data module. Every constituent symbol MUST exist in the periodic
 * table baked into the field (`SHELL_DEFS ∪ INNER_SYMBOLS` in
 * `src/lib/brain/elements.ts`). Colors and shell tags are derived
 * deterministically via `compoundCatalog.blendColor` so the Lab,
 * Builder Bar, and ElementsVisual all agree on what each thing looks
 * like.
 *
 * SCAFFOLD STAGE — used by `ElementPicker` to populate the search list.
 * The Lab field engine, mint flow, and 2D render are wired in follow-ups.
 */
import { SHELL_DEFS, INNER_SYMBOLS } from '@/lib/brain/elements';
import { ELEMENT_COLORS, blendColor } from '@/lib/virtualHub/compoundCatalog';

export interface MoleculeConstituent {
  symbol: string;
  count: number;
}

export interface MoleculeSpec {
  id: string;
  name: string;
  formula: string;
  constituents: MoleculeConstituent[];
}

export interface Molecule extends MoleculeSpec {
  /** Hex color blended from constituent element colors. */
  color: string;
  /** Shell tags inferred from constituent shells. */
  shellTags: number[];
}

export interface ElementEntry {
  symbol: string;
  shell: number;
  color: string;
  /** Atomic-mass proxy (g/mol). */
  atomicMass: number;
  /** Approximate covalent radius in Å — render-time only. */
  atomicRadius: number;
}

// ─────────────────────────────────────────────────────────────────────
//  Periodic guardrail (single source of truth = elements.ts)
// ─────────────────────────────────────────────────────────────────────

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

/** Atomic-mass proxies — keep in sync with `prefabHouseCatalog.ts`. */
const ATOMIC_MASS: Record<string, number> = {
  H: 1, He: 4,
  Li: 7, Be: 9, B: 11, C: 12, N: 14, O: 16, F: 19, Ne: 20,
  Na: 23, Mg: 24, Al: 27, Si: 28, P: 31, S: 32, Cl: 35, Ar: 40,
  K: 39, Ca: 40, Sc: 45, Ti: 48, V: 51, Cr: 52, Fe: 56,
};

/** Approximate covalent radii (Å) — render-time only. */
const ATOMIC_RADIUS: Record<string, number> = {
  H: 0.31, He: 0.28,
  Li: 1.28, Be: 0.96, B: 0.84, C: 0.76, N: 0.71, O: 0.66, F: 0.57, Ne: 0.58,
  Na: 1.66, Mg: 1.41, Al: 1.21, Si: 1.11, P: 1.07, S: 1.05, Cl: 1.02, Ar: 1.06,
  K: 2.03, Ca: 1.76, Sc: 1.7, Ti: 1.6, V: 1.53, Cr: 1.39, Fe: 1.32,
};

function shellTagsOf(c: MoleculeConstituent[]): number[] {
  const set = new Set<number>();
  for (const { symbol } of c) {
    const n = ELEMENT_SHELL[symbol];
    if (n !== undefined) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

function validate(spec: MoleculeSpec): void {
  for (const { symbol } of spec.constituents) {
    if (!PERIODIC_SYMBOLS.has(symbol)) {
      throw new Error(
        `[moleculeCatalog] Unknown element "${symbol}" in molecule "${spec.id}". ` +
          `Add it to elements.ts SHELL_DEFS / INNER_SYMBOLS first.`,
      );
    }
    if (!ELEMENT_COLORS[symbol]) {
      throw new Error(
        `[moleculeCatalog] Element "${symbol}" missing from ELEMENT_COLORS palette.`,
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
//  Common molecules (Lab v1 picker)
// ─────────────────────────────────────────────────────────────────────

const SPECS: MoleculeSpec[] = [
  // ─── Basics: starter craft materials ─────────────────────────────
  // Wood — cellulose backbone (C₆H₁₀O₅)ₙ. Default brush in the Lab.
  { id: 'cellulose_wood', name: 'Wood (Cellulose)', formula: '(C₆H₁₀O₅)ₙ',
    constituents: [{ symbol: 'C', count: 6 }, { symbol: 'H', count: 10 }, { symbol: 'O', count: 5 }] },
  // Stone — silica + minor iron (granite proxy).
  { id: 'stone_granite', name: 'Stone (Granite)', formula: 'SiO₂·Fe',
    constituents: [{ symbol: 'Si', count: 3 }, { symbol: 'O', count: 6 }, { symbol: 'Fe', count: 1 }] },
  // Tree vine — lignified cellulose (slightly denser C/H than plain wood).
  { id: 'vine_lignin', name: 'Tree Vine (Lignin)', formula: 'C₉H₁₀O₂',
    constituents: [{ symbol: 'C', count: 9 }, { symbol: 'H', count: 10 }, { symbol: 'O', count: 2 }] },

  { id: 'h2o', name: 'Water', formula: 'H₂O',
    constituents: [{ symbol: 'H', count: 2 }, { symbol: 'O', count: 1 }] },
  { id: 'o2', name: 'Dioxygen', formula: 'O₂',
    constituents: [{ symbol: 'O', count: 2 }] },
  { id: 'n2', name: 'Dinitrogen', formula: 'N₂',
    constituents: [{ symbol: 'N', count: 2 }] },
  { id: 'co2', name: 'Carbon Dioxide', formula: 'CO₂',
    constituents: [{ symbol: 'C', count: 1 }, { symbol: 'O', count: 2 }] },
  { id: 'ch4', name: 'Methane', formula: 'CH₄',
    constituents: [{ symbol: 'C', count: 1 }, { symbol: 'H', count: 4 }] },
  { id: 'nh3', name: 'Ammonia', formula: 'NH₃',
    constituents: [{ symbol: 'N', count: 1 }, { symbol: 'H', count: 3 }] },
  { id: 'glucose', name: 'Glucose', formula: 'C₆H₁₂O₆',
    constituents: [{ symbol: 'C', count: 6 }, { symbol: 'H', count: 12 }, { symbol: 'O', count: 6 }] },
  { id: 'nacl', name: 'Halite (Salt)', formula: 'NaCl',
    constituents: [{ symbol: 'Na', count: 1 }, { symbol: 'Cl', count: 1 }] },
  { id: 'glycine', name: 'Glycine', formula: 'C₂H₅NO₂',
    constituents: [{ symbol: 'C', count: 2 }, { symbol: 'H', count: 5 }, { symbol: 'N', count: 1 }, { symbol: 'O', count: 2 }] },
  { id: 'sio2', name: 'Silica', formula: 'SiO₂',
    constituents: [{ symbol: 'Si', count: 1 }, { symbol: 'O', count: 2 }] },
  { id: 'fe2o3', name: 'Hematite', formula: 'Fe₂O₃',
    constituents: [{ symbol: 'Fe', count: 2 }, { symbol: 'O', count: 3 }] },
];

const MOLECULES: Molecule[] = SPECS.map((s) => {
  validate(s);
  return {
    ...s,
    color: blendColor(s.constituents),
    shellTags: shellTagsOf(s.constituents),
  };
});

const ELEMENT_ENTRIES: ElementEntry[] = (() => {
  const out: ElementEntry[] = [];
  for (const sym of PERIODIC_SYMBOLS) {
    const color = ELEMENT_COLORS[sym];
    if (!color) continue; // skip lanthanide/actinide stubs without palette entry
    out.push({
      symbol: sym,
      shell: ELEMENT_SHELL[sym] ?? 4,
      color,
      atomicMass: ATOMIC_MASS[sym] ?? 0,
      atomicRadius: ATOMIC_RADIUS[sym] ?? 1,
    });
  }
  return out.sort((a, b) => a.shell - b.shell || a.symbol.localeCompare(b.symbol));
})();

export function listElements(): ElementEntry[] {
  return ELEMENT_ENTRIES.slice();
}

export function listMolecules(): Molecule[] {
  return MOLECULES.slice();
}

export function getMolecule(id: string): Molecule | undefined {
  return MOLECULES.find((m) => m.id === id);
}

/** Search elements + molecules by symbol / name / formula. */
export function searchPeriodic(query: string): {
  elements: ElementEntry[];
  molecules: Molecule[];
} {
  const q = query.trim().toLowerCase();
  if (!q) return { elements: ELEMENT_ENTRIES.slice(0, 24), molecules: MOLECULES.slice() };
  const elements = ELEMENT_ENTRIES.filter((e) => e.symbol.toLowerCase().includes(q));
  const molecules = MOLECULES.filter(
    (m) =>
      m.name.toLowerCase().includes(q) ||
      m.formula.toLowerCase().includes(q) ||
      m.id.includes(q),
  );
  return { elements, molecules };
}

/** Test seam — exposes the periodic guardrail without importing privates. */
export function _periodicSymbolsForTest(): Set<string> { return PERIODIC_SYMBOLS; }