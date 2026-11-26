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
import type { Prefab } from './prefabHouseCatalog';

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
  if (kind === 'mine')    return { width: 0.12, depth: 0.04, height: 0.70, headAspect: 4.5 };
  if (kind === 'gather')  return { width: 0.16, depth: 0.03, height: 0.45, headAspect: 6.0 };
  return                       { width: 0.22, depth: 0.04, height: 0.95, headAspect: 2.0 };
}

/**
 * The purposes a player can stamp into a Lab-forged tool. Each maps to the
 * in-world interaction its swing runs (see `toolActions.verbFor`).
 */
export type ForgeToolAction = 'chop' | 'mine' | 'dig' | 'gather';

export const FORGE_TOOL_ACTIONS: { id: ForgeToolAction; label: string; tool: string; hint: string }[] = [
  { id: 'chop', label: 'Cut', tool: 'Axe', hint: 'Chops trees and fells wood.' },
  { id: 'mine', label: 'Pick', tool: 'Pickaxe', hint: 'Breaks boulders and rock faces, frees minerals.' },
  { id: 'dig', label: 'Dig', tool: 'Shovel', hint: 'Excavates ground and earth terrain.' },
  { id: 'gather', label: 'Gather', tool: 'Sickle', hint: 'Forages herbs, wild flowers and fibres.' },
];

const TOOL_NOUN: Record<ToolActionKind, string> = {
  whittle: 'Knife', chop: 'Axe', mine: 'Pickaxe', dig: 'Shovel', gather: 'Sickle', claim: 'Marker',
};

export interface ForgeToolOptions {
  /** Purpose stamped into the tool. Defaults to the mass-derived kind. */
  actionKind?: ForgeToolAction;
}

function totalAtomicMass(c: MoleculeConstituent[]): number {
  return c.reduce((acc, p) => acc + (ATOMIC_MASS[p.symbol] ?? 1) * p.count, 0);
}

function deriveColor(parts: ToolPart[]): string {
  return blendColor(parts.map(({ symbol, count }) => ({ symbol, count })));
}

/** Derive a Tool from a Molecule. Pure. Throws on unknown elements. */
export function deriveForgedTool(mol: Molecule, opts: ForgeToolOptions = {}): Tool {
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
  const kind: ToolActionKind = opts.actionKind ?? actionKindFromMass(provisional * 4); // expand to action range
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

  // The purpose is part of the id, so one material can be forged into an
  // axe and a pickaxe without the second replacing the first.
  const id = opts.actionKind ? `forge:${mol.id}:${kind}` : `forge:${mol.id}`;
  return {
    id,
    label: `${mol.name} ${TOOL_NOUN[kind]}`,
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
/**
 * The Builder prefab for a forged tool, so it shows on the Tools and Lab
 * tabs and can be equipped like the stone tools. Same id as the tool.
 */
export function forgedToolPrefab(tool: Tool): Prefab {
  const constituents = tool.parts.map(({ symbol, count }) => ({ symbol, count }));
  const vol = Math.max(1e-6, tool.width * tool.depth * tool.height);
  const organic = constituents.filter((c) => ORGANIC.has(c.symbol)).reduce((a, c) => a + c.count, 0);
  const total = Math.max(1, constituents.reduce((a, c) => a + c.count, 0));
  const shellTags = Array.from(new Set(constituents.map((c) => (c.symbol === 'H' ? 0 : MINERAL.has(c.symbol) ? 2 : 1)))).sort();
  return {
    id: tool.id,
    label: tool.label,
    sectionId: 'tools',
    formula: constituents.map((c) => `${c.symbol}${c.count > 1 ? c.count : ''}`).join('·'),
    constituents,
    density: Math.max(0.3, tool.mass / (vol * 1000)),
    width: tool.width,
    depth: tool.depth,
    height: tool.height,
    yawSnapStep: Math.PI / 4,
    color: tool.color,
    mass: tool.mass,
    basin: tool.basin,
    waterResistance: clamp01(0.5 + (1 - organic / total) * 0.4),
    flammability: clamp01((organic / total) * 0.7),
    shellTags,
  };
}

/** True for tools forged in the Lab (already paid for at the bench). */
export function isForgedToolId(id: string): boolean {
  return id.startsWith('forge:');
}
