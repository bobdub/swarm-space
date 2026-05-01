/**
 * ═══════════════════════════════════════════════════════════════════════
 * TOOL CATALOG — sharpened base tools as composite UQRC bodies
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Each tool is a real composite of three sub-parts (handle + head + binding)
 * built from elements that already exist in `elements.ts`. Mass, basin,
 * and head-sharpness are derived from the parts — no free numbers.
 *
 * Mirrors `prefabHouseCatalog.ts` so the Builder Bar can render Tools the
 * same way it renders House prefabs (single tab, single placement path
 * through `getBuilderBlockEngine().placeBlock`).
 */

import { SHELL_DEFS, INNER_SYMBOLS } from './elements';
import { ELEMENT_COLORS, blendColor } from '@/lib/virtualHub/compoundCatalog';

export type ToolActionKind = 'whittle' | 'chop' | 'dig';

export interface ToolPart {
  role: 'handle' | 'head' | 'binding';
  symbol: string;
  count: number;
}

export interface ToolSpec {
  id: string;
  label: string;
  /** Drives the in-world predicate's allow gate; not the only gate. */
  actionKind: ToolActionKind;
  parts: ToolPart[];
  /** Bounding dimensions, metres. */
  width: number;
  depth: number;
  height: number;
  /** Rough head aspect (length / thickness). Sharper > 6, blunter < 2. */
  headAspect: number;
}

export interface ToolDerived {
  color: string;
  mass: number;
  basin: number;
  /** 0..1, baseline at mint. Wear/sharpening mutates `block.meta.sharpness`. */
  baseSharpness: number;
  /** g/cm³ approx of the head only — feeds the resistance predicate. */
  headDensity: number;
}

export interface Tool extends ToolSpec, ToolDerived {}

// ────────────────────────────────────────────────────────────────────────
//  Periodic guardrail (mirrors prefabHouseCatalog)
// ────────────────────────────────────────────────────────────────────────

const PERIODIC_SYMBOLS: Set<string> = (() => {
  const set = new Set<string>();
  for (const shell of SHELL_DEFS) for (const s of shell.symbols) set.add(s);
  for (const s of INNER_SYMBOLS) set.add(s);
  return set;
})();

const ATOMIC_MASS: Record<string, number> = {
  H: 1, C: 12, N: 14, O: 16, Na: 23, Mg: 24, Al: 27, Si: 28, P: 31, S: 32,
  K: 39, Ca: 40, Ti: 48, V: 51, Cr: 52, Fe: 56,
};

function clamp01(x: number): number { return Math.max(0, Math.min(1, x)); }

function validate(spec: ToolSpec): void {
  for (const p of spec.parts) {
    if (!PERIODIC_SYMBOLS.has(p.symbol)) {
      throw new Error(
        `[toolCatalog] Unknown element "${p.symbol}" in tool "${spec.id}". ` +
          `Add it to elements.ts first.`,
      );
    }
    if (!ELEMENT_COLORS[p.symbol]) {
      throw new Error(`[toolCatalog] Element "${p.symbol}" missing from ELEMENT_COLORS.`);
    }
  }
}

function partMass(p: ToolPart): number {
  return (ATOMIC_MASS[p.symbol] ?? 1) * p.count;
}

function deriveColor(spec: ToolSpec): string {
  return blendColor(spec.parts.map(({ symbol, count }) => ({ symbol, count })));
}

function deriveMass(spec: ToolSpec): number {
  // crude g → kg, scaled by bounding volume so big stone heads weigh more.
  const vol = spec.width * spec.depth * spec.height;
  const totalAtomic = spec.parts.reduce((acc, p) => acc + partMass(p), 0);
  return Math.max(0.05, totalAtomic * vol * 0.02);
}

function deriveBasin(spec: ToolSpec): number {
  const r = Math.cbrt(spec.width * spec.depth * spec.height) * 0.35;
  return Math.max(0.06, Math.min(0.4, r));
}

function deriveHeadDensity(spec: ToolSpec): number {
  const head = spec.parts.find((p) => p.role === 'head');
  if (!head) return 1.0;
  // Stone (Si/O) ≈ 2.7, Iron ≈ 7.8; scale atomic mass into a g/cm³ proxy.
  return Math.max(0.5, ((ATOMIC_MASS[head.symbol] ?? 12) * head.count) * 0.06);
}

function deriveBaseSharpness(spec: ToolSpec): number {
  // Sharpness baseline = head aspect normalized + mineral bonus.
  const head = spec.parts.find((p) => p.role === 'head');
  const aspectTerm = clamp01((spec.headAspect - 1.5) / 6);
  const mineralBonus = head && (head.symbol === 'Si' || head.symbol === 'Fe') ? 0.15 : 0;
  return clamp01(0.35 + aspectTerm * 0.55 + mineralBonus);
}

// ────────────────────────────────────────────────────────────────────────
//  Specs (Phase 1 — three sharpened base tools)
// ────────────────────────────────────────────────────────────────────────

const SPECS: ToolSpec[] = [
  {
    id: 'tool_knife_stone',
    label: 'Stone Knife',
    actionKind: 'whittle',
    parts: [
      { role: 'handle',  symbol: 'C',  count: 6 },  // oak (cellulose proxy)
      { role: 'head',    symbol: 'Si', count: 3 },  // flint / stone
      { role: 'binding', symbol: 'C',  count: 2 },  // vine
    ],
    width: 0.04, depth: 0.02, height: 0.22,
    headAspect: 7.5,
  },
  {
    id: 'tool_axe_stone',
    label: 'Stone Axe',
    actionKind: 'chop',
    parts: [
      { role: 'handle',  symbol: 'C',  count: 12 },
      { role: 'head',    symbol: 'Si', count: 6 },
      { role: 'binding', symbol: 'C',  count: 3 },
    ],
    width: 0.18, depth: 0.06, height: 0.55,
    headAspect: 3.5,
  },
  {
    id: 'tool_shovel_stone',
    label: 'Stone Shovel',
    actionKind: 'dig',
    parts: [
      { role: 'handle',  symbol: 'C',  count: 14 },
      { role: 'head',    symbol: 'Si', count: 8 },
      { role: 'binding', symbol: 'C',  count: 3 },
    ],
    width: 0.22, depth: 0.04, height: 0.95,
    headAspect: 2.0,
  },
];

const TOOLS: Tool[] = SPECS.map((s) => {
  validate(s);
  return {
    ...s,
    color: deriveColor(s),
    mass: deriveMass(s),
    basin: deriveBasin(s),
    baseSharpness: deriveBaseSharpness(s),
    headDensity: deriveHeadDensity(s),
  };
});

const BY_ID: Record<string, Tool> = (() => {
  const out: Record<string, Tool> = {};
  for (const t of TOOLS) out[t.id] = t;
  return out;
})();

export function listTools(): Tool[] { return [...TOOLS]; }
export function getTool(id: string): Tool | undefined { return BY_ID[id]; }