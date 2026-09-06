/**
 * materials — plain-words layer over the chemical `harvestedInventory`.
 *
 * The world still gathers and spends real elements (C, H, O, Si, Ca…) so
 * persistence, NPC harvest and the Remix lab are untouched. This module is
 * a *lens*: it folds the element bag into five things a player can name —
 * Wood, Stone, Water, Fibre, Food — and folds a prefab's `constituents`
 * back out into a cost in the same five.
 *
 * Nothing here writes element counts directly; every spend goes through
 * `spendHarvested`, so existing amounts carry over untouched.
 */
import {
  listHarvested,
  subscribeHarvested,
  spendHarvested,
} from '@/lib/remix/harvestedInventory';
import { getPrefab, type Prefab } from '@/lib/brain/prefabHouseCatalog';

export type MaterialId = 'wood' | 'stone' | 'water' | 'fibre' | 'food';

export interface MaterialDef {
  id: MaterialId;
  label: string;
  /** Small glyph used on tiles and the totals strip. */
  icon: string;
  color: string;
}

export const MATERIALS: MaterialDef[] = [
  { id: 'wood', label: 'Wood', icon: '🪵', color: 'hsl(28, 55%, 52%)' },
  { id: 'stone', label: 'Stone', icon: '🪨', color: 'hsl(210, 8%, 62%)' },
  { id: 'water', label: 'Water', icon: '💧', color: 'hsl(200, 80%, 58%)' },
  { id: 'fibre', label: 'Fibre', icon: '🧵', color: 'hsl(48, 62%, 60%)' },
  { id: 'food', label: 'Food', icon: '🍎', color: 'hsl(348, 70%, 60%)' },
];

export const MATERIAL_LABEL: Record<MaterialId, string> = {
  wood: 'Wood', stone: 'Stone', water: 'Water', fibre: 'Fibre', food: 'Food',
};

/** Which display material each element folds into. */
const ELEMENT_MATERIAL: Record<string, MaterialId> = {
  C: 'wood',
  H: 'fibre',
  O: 'water',
  N: 'food',
};

const MINERALS = ['Li', 'Be', 'B', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Fe', 'He'];
for (const s of MINERALS) ELEMENT_MATERIAL[s] = 'stone';

/** Atoms per one displayed unit of each material. */
const ATOMS_PER_UNIT: Record<MaterialId, number> = {
  wood: 2, stone: 2, water: 3, fibre: 4, food: 2,
};

function materialOf(symbol: string): MaterialId {
  return ELEMENT_MATERIAL[symbol] ?? 'stone';
}

export type MaterialCost = Partial<Record<MaterialId, number>>;

function emptyTotals(): Record<MaterialId, number> {
  return { wood: 0, stone: 0, water: 0, fibre: 0, food: 0 };
}

/** Current player totals, in whole display units. */
export function materialTotals(): Record<MaterialId, number> {
  const atoms = emptyTotals();
  for (const { symbol, count } of listHarvested()) {
    atoms[materialOf(symbol)] += count;
  }
  const out = emptyTotals();
  for (const m of MATERIALS) out[m.id] = Math.floor(atoms[m.id] / ATOMS_PER_UNIT[m.id]);
  return out;
}

export function subscribeMaterials(fn: (totals: Record<MaterialId, number>) => void): () => void {
  return subscribeHarvested(() => {
    try { fn(materialTotals()); } catch { /* noop */ }
  });
}

// ── Costs ────────────────────────────────────────────────────────────────

const MINERAL_SET = new Set(MINERALS);

/**
 * What a prefab costs, derived entirely from its `constituents` and its
 * bounding volume — no hand-typed numbers.
 *
 * One context rule: in a mineral compound (limestone, glass, terracotta)
 * the carbon belongs to the rock, not to timber, so it counts as Stone.
 */
export function prefabCostFor(prefab: Prefab): MaterialCost {
  const hasMineral = prefab.constituents.some((c) => MINERAL_SET.has(c.symbol));
  const atoms = emptyTotals();
  for (const c of prefab.constituents) {
    const bucket = hasMineral && c.symbol === 'C' ? 'stone' : materialOf(c.symbol);
    atoms[bucket] += c.count;
  }
  const volume = Math.max(0.02, prefab.width * prefab.depth * prefab.height);
  const size = Math.min(4, Math.max(0.6, volume / 0.5));
  const cost: MaterialCost = {};
  for (const m of MATERIALS) {
    const units = Math.ceil((atoms[m.id] * size) / ATOMS_PER_UNIT[m.id]);
    if (units > 0) cost[m.id] = units;
  }
  return cost;
}

export function prefabCost(prefabId: string): MaterialCost {
  const prefab = getPrefab(prefabId);
  return prefab ? prefabCostFor(prefab) : {};
}

export function costEntries(cost: MaterialCost): { id: MaterialId; label: string; qty: number }[] {
  return MATERIALS
    .filter((m) => (cost[m.id] ?? 0) > 0)
    .map((m) => ({ id: m.id, label: m.label, qty: cost[m.id] as number }));
}

/** "Wood 4 · Stone 2" */
export function formatCost(cost: MaterialCost): string {
  const parts = costEntries(cost).map((e) => `${e.label} ${e.qty}`);
  return parts.length ? parts.join(' · ') : 'Free';
}

export interface Affordability {
  ok: boolean;
  missing: { id: MaterialId; label: string; short: number }[];
}

export function checkAffordable(cost: MaterialCost, totals = materialTotals()): Affordability {
  const missing: Affordability['missing'] = [];
  for (const e of costEntries(cost)) {
    const short = e.qty - (totals[e.id] ?? 0);
    if (short > 0) missing.push({ id: e.id, label: e.label, short });
  }
  return { ok: missing.length === 0, missing };
}

/** "Needs 2 more Wood, 1 more Stone" */
export function describeMissing(missing: Affordability['missing']): string {
  if (!missing.length) return '';
  return `Needs ${missing.map((m) => `${m.short} more ${m.label}`).join(', ')}`;
}

/**
 * Spend a material cost by drawing the equivalent atoms out of the element
 * bag. Elements inside a material are drained largest-pile first so the
 * player never loses a rare symbol while a common one sits unused.
 */
export function spendMaterials(cost: MaterialCost): boolean {
  if (!checkAffordable(cost).ok) return false;

  const pools = new Map<MaterialId, { symbol: string; count: number }[]>();
  for (const held of listHarvested()) {
    const m = materialOf(held.symbol);
    const arr = pools.get(m) ?? [];
    arr.push({ ...held });
    pools.set(m, arr);
  }

  const parts: { symbol: string; count: number }[] = [];
  for (const e of costEntries(cost)) {
    let need = e.qty * ATOMS_PER_UNIT[e.id];
    const pool = (pools.get(e.id) ?? []).sort((a, b) => b.count - a.count);
    for (const p of pool) {
      if (need <= 0) break;
      const take = Math.min(need, p.count);
      if (take > 0) {
        parts.push({ symbol: p.symbol, count: take });
        need -= take;
      }
    }
    if (need > 0) return false;
  }
  return spendHarvested(parts);
}

/**
 * How long a piece takes to raise, in seconds. Scales with the bounding
 * volume and the total material cost, so a plank wall is a few seconds and
 * a roof section takes noticeably longer.
 */
export function buildSeconds(prefabId: string): number {
  const prefab = getPrefab(prefabId);
  if (!prefab) return 3;
  const volume = prefab.width * prefab.depth * prefab.height;
  const units = costEntries(prefabCostFor(prefab)).reduce((a, e) => a + e.qty, 0);
  return Math.min(18, Math.max(2.5, 1.5 + volume * 1.6 + units * 0.35));
}
