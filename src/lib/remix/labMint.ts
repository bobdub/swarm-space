/**
 * labMint — derive a placeable Prefab from a Lab Molecule.
 *
 * Phase 1 (Lab → World) bridge. Pure, deterministic. Uses the same UQRC
 * derivation contract as `prefabHouseCatalog.ts`:
 *   • Mass  = Σ(atomic-mass · count) · volume · density (kg/m³ scaled)
 *   • Basin = (w·d·h)^(1/3) · 0.35  clamped 0.18..0.9
 *   • H₂O  = 0.4 + (O,Ne mass-frac · 0.9) − (Na,K mass-frac · 1.2)
 *   • Fire = (C·0.85 + H·1.5) − (Si,Ca,Fe,Al,Mg,Ti · 0.6)
 *
 * No React, no field, no IndexedDB — those live in `mintedPrefabsStore`.
 */
import type { Molecule } from './moleculeCatalog';
import type {
  Prefab,
  PrefabConstituent,
  PrefabSectionId,
} from '@/lib/brain/prefabHouseCatalog';
import { classifySize } from '@/lib/brain/assetSizing';

/** Atomic-mass proxy (g/mol). Mirrors prefabHouseCatalog. */
const ATOMIC_MASS: Record<string, number> = {
  H: 1, He: 4,
  Li: 7, Be: 9, B: 11, C: 12, N: 14, O: 16, F: 19, Ne: 20,
  Na: 23, Mg: 24, Al: 27, Si: 28, P: 31, S: 32, Cl: 35, Ar: 40,
  K: 39, Ca: 40, Sc: 45, Ti: 48, V: 51, Cr: 52, Fe: 56,
};
const MINERAL = new Set(['Si', 'Ca', 'Fe', 'Al', 'Mg', 'Ti']);
const SOLUBLE = new Set(['Na', 'K']);
const OXIDE = new Set(['O', 'Ne']);

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }

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

/** Default bulk density (g/cm³) inferred from dominant constituent. */
function inferDensity(c: PrefabConstituent[]): number {
  const { frac } = massFractions(c);
  // Wood-ish if mostly C+H+O with little mineral, else stoneish.
  const mineral = (frac['Si'] ?? 0) + (frac['Ca'] ?? 0) + (frac['Fe'] ?? 0) + (frac['Al'] ?? 0);
  const organic = (frac['C'] ?? 0) + (frac['H'] ?? 0);
  if (organic > 0.4 && mineral < 0.2) return 0.85; // wood/lignin
  if (mineral > 0.4) return 2.4; // stone-ish
  return 1.4; // generic compound
}

export interface LabMintOptions {
  /** Bounding dimensions (m). Defaults to a small holdable block. */
  width?: number;
  depth?: number;
  height?: number;
  /** Builder Bar section. Defaults inferred from size. */
  section?: PrefabSectionId;
}

/** Derive a runtime Prefab from a Molecule. Pure. */
export function deriveMintedPrefab(mol: Molecule, opts: LabMintOptions = {}): Prefab {
  const width = opts.width ?? 0.4;
  const depth = opts.depth ?? 0.4;
  const height = opts.height ?? 0.4;
  const density = inferDensity(mol.constituents);
  const volume = width * depth * height;
  const mass = volume * density * 1000;
  const basin = Math.max(0.18, Math.min(0.9, Math.cbrt(volume) * 0.35));

  const { frac } = massFractions(mol.constituents);
  let oxide = 0, soluble = 0, mineral = 0;
  for (const [s, f] of Object.entries(frac)) {
    if (OXIDE.has(s)) oxide += f;
    if (SOLUBLE.has(s)) soluble += f;
    if (MINERAL.has(s)) mineral += f;
  }
  const waterResistance = clamp01(0.4 + oxide * 0.9 - soluble * 1.2);
  const carbon = frac['C'] ?? 0;
  const hydrogen = frac['H'] ?? 0;
  const flammability = clamp01(carbon * 0.85 + hydrogen * 1.5 - mineral * 0.6);

  // Section inference via shared sizing tier.
  const tier = classifySize({ width, depth, height, mass });
  const section: PrefabSectionId =
    opts.section ??
    (tier === 'tool' ? 'tools' : tier === 'structure' ? 'walls' : 'consumables');

  return {
    id: `mint:${mol.id}`,
    label: mol.name,
    sectionId: section,
    formula: mol.formula,
    constituents: mol.constituents,
    density,
    width, depth, height,
    yawSnapStep: Math.PI / 2,
    color: mol.color,
    mass,
    basin,
    waterResistance,
    flammability,
    shellTags: mol.shellTags.slice(),
  };
}