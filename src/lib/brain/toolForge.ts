/**
 * toolForge — derive a `Tool` (handle/head/binding composite) from a
 * Lab `Molecule`. Pure, deterministic. Phase 4 of the Lab → World
 * scaffold ("Sculpting → Tools").
 *
 * Derivation rules:
 *   • head    = highest atomic-mass non-organic constituent
 *               (Si/Fe/Al/Ca/Mg/Ti preferred). If none, dominant element.
 *   • handle  = best organic candidate (C, then H), else dominant.
 *   • binding = smallest-count remaining constituent, else handle.
 *   • actionKind  = derived from total mass:
 *       small  (≤ 0.4 kg)  → 'whittle'
 *       mid    (≤ 1.5 kg)  → 'chop'
 *       large  (> 1.5 kg)  → 'dig'
 *   • headAspect  = scaled by mineral fraction (more mineral → blunter).
 *
 * No React, no IndexedDB, no field — those live in `toolMintStore.ts`
 * and `tool.bus.ts`.
 */
import type { Molecule, MoleculeConstituent } from '@/lib/remix/moleculeCatalog';
import {
  type Tool,
  type ToolActionKind,
  type ToolPart,
} from './toolCatalog';
import { ELEMENT_COLORS, blendColor } from '@/lib/virtualHub/compoundCatalog';

const ATOMIC_MASS: Record<string, number> = {
  H: 1, He: 4, Li: 7, Be: 9, B: 11, C: 12, N: 14, O: 16, F: 19, Ne: 20,
  Na: 23, Mg: 24, Al: 27, Si: 28, P: 31, S: 32, Cl: 35, Ar: 40,
  K: 39, Ca: 40, Sc: 45, Ti: 48, V: 51, Cr: 52, Fe: 56,
};
const MINERAL = new Set(['Si', 'Fe', 'Al', 'Ca', 'Mg', 'Ti', 'Cr', 'V']);
const ORGANIC = new Set(['C', 'H']);

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }

function pickHead(c: MoleculeConstituent[]): MoleculeConstituent {
  const minerals = c.filter((p) => MINERAL.has(p.symbol));
  const pool = minerals.length ? minerals : c;
  return [...pool].sort(
    (a, b) =>
      (ATOMIC_MASS[b.symbol] ?? 1) * b.count -
      (ATOMIC_MASS[a.symbol] ?? 1) * a.count,
  )[0];
}

function pickHandle(c: MoleculeConstituent[], headSym: string): MoleculeConstituent {
  const organics = c.filter((p) => ORGANIC.has(p.symbol) && p.symbol !== headSym);
  if (organics.length) {
    return organics.sort((a, b) =>
      a.symbol === 'C' ? -1 : b.symbol === 'C' ? 1 : b.count - a.count,
    )[0];
  }
  const others = c.filter((p) => p.symbol !== headSym);
  return others[0] ?? { symbol: 'C', count: 4 };
}

function pickBinding(
  c: MoleculeConstituent[],
  headSym: string,
  handleSym: string,
): MoleculeConstituent {
  const rest = c.filter((p) => p.symbol !== headSym && p.symbol !== handleSym);
  if (rest.length) {
    return [...rest].sort((a, b) => a.count - b.count)[0];
  }
  // Fall back to handle, lower count, so binding is light.
  const handle = c.find((p) => p.symbol === handleSym);
  return { symbol: handle?.symbol ?? 'C', count: Math.max(1, Math.floor((handle?.count ?? 2) / 2)) };
}

function actionKindFromMass(mass: number): ToolActionKind {
  if (mass <= 0.4) return 'whittle';
  if (mass <= 1.5) return 'chop';
  return 'dig';
}

function dimsForAction(kind: ToolActionKind): { width: number; depth: number; height: number; headAspect: number } {
  if (kind === 'whittle') return { width: 0.04, depth: 0.02, height: 0.22, headAspect: 7.5 };
  if (kind === 'chop')    return { width: 0.18, depth: 0.06, height: 0.55, headAspect: 3.5 };
  return                       { width: 0.22, depth: 0.04, height: 0.95, headAspect: 2.0 };
}

function totalAtomicMass(c: MoleculeConstituent[]): number {
  return c.reduce((acc, p) => acc + (ATOMIC_MASS[p.symbol] ?? 1) * p.count, 0);
}

function deriveColor(parts: ToolPart[]): string {
  return blendColor(parts.map(({ symbol, count }) => ({ symbol, count })));
}

/** Derive a Tool from a Molecule. Pure. Throws on unknown elements. */
export function deriveForgedTool(mol: Molecule): Tool {
  if (!mol.constituents.length) {
    throw new Error('[toolForge] Molecule has no constituents.');
  }
  for (const p of mol.constituents) {
    if (!ELEMENT_COLORS[p.symbol]) {
      throw new Error(`[toolForge] Element "${p.symbol}" missing from ELEMENT_COLORS.`);
    }
  }

  const head = pickHead(mol.constituents);
  const handle = pickHandle(mol.constituents, head.symbol);
  const binding = pickBinding(mol.constituents, head.symbol, handle.symbol);

  // Provisional mass to choose action kind (atomic mass × small bounding vol).
  const provisional = totalAtomicMass(mol.constituents) * 0.02 * 0.05;
  const kind = actionKindFromMass(provisional * 4); // expand to action range
  const dims = dimsForAction(kind);

  const parts: ToolPart[] = [
    { role: 'handle',  symbol: handle.symbol,  count: handle.count  },
    { role: 'head',    symbol: head.symbol,    count: head.count    },
    { role: 'binding', symbol: binding.symbol, count: binding.count },
  ];

  const vol = dims.width * dims.depth * dims.height;
  const totalAtomic = parts.reduce((a, p) => a + (ATOMIC_MASS[p.symbol] ?? 1) * p.count, 0);
  const mass = Math.max(0.05, totalAtomic * vol * 0.02);
  const basin = Math.max(0.06, Math.min(0.4, Math.cbrt(vol) * 0.35));
  const headDensity = Math.max(0.5, ((ATOMIC_MASS[head.symbol] ?? 12) * head.count) * 0.06);

  // Sharpness: aspect + mineral bonus + organic penalty.
  const aspectTerm = clamp01((dims.headAspect - 1.5) / 6);
  const mineralBonus = MINERAL.has(head.symbol) ? 0.18 : 0;
  const organicPenalty = ORGANIC.has(head.symbol) ? 0.12 : 0;
  const baseSharpness = clamp01(0.32 + aspectTerm * 0.55 + mineralBonus - organicPenalty);

  const id = `forge:${mol.id}`;
  const labelKind = kind === 'whittle' ? 'Knife' : kind === 'chop' ? 'Axe' : 'Shovel';
  return {
    id,
    label: `${mol.name} ${labelKind}`,
    actionKind: kind,
    parts,
    width: dims.width,
    depth: dims.depth,
    height: dims.height,
    headAspect: dims.headAspect,
    color: deriveColor(parts),
    mass,
    basin,
    baseSharpness,
    headDensity,
  };
}