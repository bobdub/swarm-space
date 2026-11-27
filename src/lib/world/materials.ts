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
  getHarvested,
  listHarvested,
  subscribeHarvested,
  spendHarvested,
  type BagScope,
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

/**
 * Gathered goods that are not building materials: kept in the bag under
 * `good:` keys (see `harvestedInventory`), shown in the Gathered tally and
 * traded at the Trading Stand, never spent on builds.
 */
export type GatheredGoodId =
  | 'honey' | 'egg' | 'chicken' | 'fish' | 'shark' | 'gem'
  | 'dirt' | 'clay' | 'gold' | 'salt';

export const GATHERED_GOODS: { id: GatheredGoodId; label: string; icon: string }[] = [
  { id: 'honey', label: 'Honey', icon: '🍯' },
  { id: 'egg', label: 'Eggs', icon: '🥚' },
  { id: 'chicken', label: 'Chickens', icon: '🐔' },
  { id: 'fish', label: 'Fish', icon: '🐟' },
  { id: 'shark', label: 'Sharks', icon: '🦈' },
  { id: 'gem', label: 'Gems', icon: '💎' },
  // Dug out of the Earth's shells (see `toolActions.digShell`).
  { id: 'dirt', label: 'Dirt', icon: '🟫' },
  { id: 'clay', label: 'Clay', icon: '🧱' },
  { id: 'gold', label: 'Gold', icon: '🪙' },
  // Beach sand shovelled up on the shore. It is what a Salt Rock costs.
  { id: 'salt', label: 'Salt', icon: '🧂' },
];

const GATHERED_GOOD_IDS = new Set<string>(GATHERED_GOODS.map((g) => g.id));

export function isGatheredGood(id: string): id is GatheredGoodId {
  return GATHERED_GOOD_IDS.has(id);
}

export function gatheredGoodTotals(scope?: BagScope): Record<GatheredGoodId, number> {
  const out = {} as Record<GatheredGoodId, number>;
  for (const g of GATHERED_GOODS) out[g.id] = Math.floor(getHarvested(`good:${g.id}`, scope));
  return out;
}

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

/**
 * A cost line: one of the five materials, or a gathered good (a Salt Rock
 * costs Salt). Goods are drawn from their own `good:<id>` bag key.
 */
export type CostId = MaterialId | GatheredGoodId;
export type MaterialCost = Partial<Record<CostId, number>>;

function emptyTotals(): Record<MaterialId, number> {
  return { wood: 0, stone: 0, water: 0, fibre: 0, food: 0 };
}

/** Whole display units of each material in a list of element entries. */
export function foldMaterialTotals(parts: { symbol: string; count: number }[]): Record<MaterialId, number> {
  const atoms = emptyTotals();
  for (const { symbol, count } of parts) {
    if (symbol.startsWith('good:')) continue;
    atoms[materialOf(symbol)] += count;
  }
  const out = emptyTotals();
  for (const m of MATERIALS) out[m.id] = Math.floor(atoms[m.id] / ATOMS_PER_UNIT[m.id]);
  return out;
}

/**
 * Current player totals, in whole display units: what local play can use
 * by default, the online bag alone with `{ onlineOnly: true }`.
 */
export function materialTotals(scope?: BagScope): Record<MaterialId, number> {
  return foldMaterialTotals(listHarvested(scope));
}

export function subscribeMaterials(fn: (totals: Record<MaterialId, number>) => void): () => void {
  return subscribeHarvested(() => {
    try { fn(materialTotals()); } catch { /* noop */ }
  });
}

// ── Costs ────────────────────────────────────────────────────────────────

const MINERAL_SET = new Set(MINERALS);

/**
 * The starter tools. These are what a player *gathers with*, so they can
 * never cost gathered materials — that would lock the only way out of an
 * empty pack. Everything else keeps its derived cost.
 */
export const STARTER_TOOL_IDS = new Set([
  'tool_knife_stone',
  'tool_axe_stone',
  'tool_shovel_stone',
  'tool_bucket_wood',
  'tool_pick_stone',
  // Claims land with SWARM, not materials, so it is always free to pick up.
  'tool_boundary_marker',
]);

export function isStarterTool(prefabId: string): boolean {
  return STARTER_TOOL_IDS.has(prefabId);
}

/**
 * What a prefab costs, derived entirely from its `constituents` and its
 * bounding volume — no hand-typed numbers.
 *
 * One context rule: in a mineral compound (limestone, glass, terracotta)
 * the carbon belongs to the rock, not to timber, so it counts as Stone.
 */
export function prefabCostFor(prefab: Prefab): MaterialCost {
  // Lab-forged tools were paid for at the bench, stroke by stroke.
  if (isStarterTool(prefab.id) || prefab.id.startsWith('forge:')) return {};
  // Bought with SWARM or Credits (`toolPurchases.ts`), never with materials.
  if (prefab.priceSwarm) return {};
  // A piece made from a gathered good costs that good, not derived atoms.
  if (prefab.goodCost) return { ...prefab.goodCost } as MaterialCost;
  const hasMineral = !prefab.compositeCost && prefab.constituents.some((c) => MINERAL_SET.has(c.symbol));
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

export function costEntries(cost: MaterialCost): { id: CostId; label: string; qty: number }[] {
  return [...MATERIALS, ...GATHERED_GOODS]
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
  missing: { id: CostId; label: string; short: number }[];
}

export function checkAffordable(cost: MaterialCost, totals?: Record<MaterialId, number>, scope?: BagScope): Affordability {
  const haveTotals = totals ?? materialTotals(scope);
  const missing: Affordability['missing'] = [];
  for (const e of costEntries(cost)) {
    const held = isGatheredGood(e.id)
      ? Math.floor(getHarvested(`good:${e.id}`, scope))
      : (haveTotals[e.id] ?? 0);
    const short = e.qty - held;
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
export function spendMaterials(cost: MaterialCost, scope?: BagScope): boolean {
  if (!checkAffordable(cost, undefined, scope).ok) return false;

  const pools = new Map<MaterialId, { symbol: string; count: number }[]>();
  for (const held of listHarvested(scope)) {
    const m = materialOf(held.symbol);
    const arr = pools.get(m) ?? [];
    arr.push({ ...held });
    pools.set(m, arr);
  }

  const parts: { symbol: string; count: number }[] = [];
  for (const e of costEntries(cost)) {
    if (isGatheredGood(e.id)) {
      parts.push({ symbol: `good:${e.id}`, count: e.qty });
      continue;
    }
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
  return spendHarvested(parts, scope);
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
