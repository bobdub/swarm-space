/**
 * labMaterials — the gathered world assets as first-class Lab and Forge
 * materials.
 *
 * The Lab brush picker and the Forge deposit shelf used to show a table of
 * chemical symbols. They now show what the player actually gathers:
 * Wood, Stone, Fiber, Water, Honey, Gems and Gold. Each card reads the
 * player's live stock straight from the material bag, and every brush
 * stroke or Forge deposit spends from it:
 *
 *   • Wood / Stone / Water / Fiber go through `materials.ts`
 *     (`materialTotals` / `spendMaterials`), the same lens the Builder uses;
 *   • Honey / Gems / Gold are goods kept under `good:` keys in the bag.
 *
 * `compositionToMolecule` turns what was drawn into a Molecule, so the
 * existing Mint (prefab) and Forge-as-Tool derivations keep working on
 * real element constituents.
 */
import {
  getHarvested,
  recordHarvestForResource,
  recordHarvestMany,
  restoreDraws,
  spendHarvestedDraws,
  subscribeHarvested,
  type BagDraw,
  type BagScope,
  type HarvestOrigin,
} from './harvestedInventory';
import { materialTotals, spendMaterialsDraws, type MaterialId } from '@/lib/world/materials';
import type { Molecule, MoleculeConstituent } from './moleculeCatalog';

export type LabMaterialId = 'wood' | 'stone' | 'fiber' | 'water' | 'honey' | 'gem' | 'gold';

export interface LabMaterial {
  id: LabMaterialId;
  label: string;
  /** What the material is for, shown on its card. */
  role: string;
  /** Brush / swatch colour (concrete hex so a 2D canvas can draw it). */
  color: string;
  icon: string;
  /** Element atoms in ONE unit, used to derive minted prefabs and tools. */
  constituents: MoleculeConstituent[];
  /** Forge heft of one unit (coins hold up to 100). */
  forgeMass: number;
}

export const LAB_MATERIALS: LabMaterial[] = [
  {
    id: 'wood', label: 'Wood', role: 'Main building item', color: '#8B5A2B', icon: '🪵',
    constituents: [{ symbol: 'C', count: 6 }, { symbol: 'H', count: 10 }, { symbol: 'O', count: 5 }],
    forgeMass: 4,
  },
  {
    id: 'stone', label: 'Stone', role: 'Main building item', color: '#78716c', icon: '🪨',
    constituents: [{ symbol: 'Si', count: 3 }, { symbol: 'O', count: 6 }, { symbol: 'Ca', count: 1 }],
    forgeMass: 6,
  },
  {
    id: 'fiber', label: 'Fiber', role: 'Supportive threads', color: '#d4a359', icon: '🧵',
    constituents: [{ symbol: 'C', count: 2 }, { symbol: 'H', count: 4 }],
    forgeMass: 2,
  },
  {
    id: 'water', label: 'Water', role: 'Smelting agent', color: '#38bdf8', icon: '💧',
    constituents: [{ symbol: 'H', count: 2 }, { symbol: 'O', count: 1 }],
    forgeMass: 3,
  },
  {
    id: 'honey', label: 'Honey', role: 'Wax designs', color: '#f59e0b', icon: '🍯',
    constituents: [{ symbol: 'C', count: 6 }, { symbol: 'H', count: 12 }, { symbol: 'O', count: 6 }],
    forgeMass: 5,
  },
  {
    id: 'gem', label: 'Gems', role: 'Bold design & jewelry', color: '#ec4899', icon: '💎',
    constituents: [{ symbol: 'Si', count: 1 }, { symbol: 'O', count: 2 }, { symbol: 'Al', count: 1 }],
    forgeMass: 12,
  },
  {
    // Gold is not in the field's periodic table; iron stands in for the
    // heavy metal, as the Gold Vein earth shell does.
    id: 'gold', label: 'Gold', role: 'Jewelry & ornamental design', color: '#eab308', icon: '🪙',
    constituents: [{ symbol: 'Fe', count: 2 }],
    forgeMass: 20,
  },
];

const BY_ID: Record<LabMaterialId, LabMaterial> = Object.fromEntries(
  LAB_MATERIALS.map((m) => [m.id, m]),
) as Record<LabMaterialId, LabMaterial>;

export function getLabMaterial(id: LabMaterialId): LabMaterial {
  return BY_ID[id];
}

export function isLabMaterialId(id: string): id is LabMaterialId {
  return id in BY_ID;
}

/** Building materials folded from the element bag (`materials.ts`). */
const BAG_MATERIAL: Partial<Record<LabMaterialId, MaterialId>> = {
  wood: 'wood', stone: 'stone', water: 'water', fiber: 'fibre',
};

/** Goods kept as their own keys in the bag, and their gather kind. */
const GOOD_KIND: Partial<Record<LabMaterialId, string>> = {
  honey: 'honey', gem: 'gem', gold: 'gold',
};

/** Whole units of a material the player holds right now. */
export function labMaterialStock(id: LabMaterialId, totals = materialTotals()): number {
  const bag = BAG_MATERIAL[id];
  if (bag) return totals[bag] ?? 0;
  const good = GOOD_KIND[id];
  return good ? Math.floor(getHarvested(`good:${good}`)) : 0;
}

export function labMaterialStocks(): Record<LabMaterialId, number> {
  const totals = materialTotals();
  const out = {} as Record<LabMaterialId, number>;
  for (const m of LAB_MATERIALS) out[m.id] = labMaterialStock(m.id, totals);
  return out;
}

export function subscribeLabMaterialStocks(fn: (stocks: Record<LabMaterialId, number>) => void): () => void {
  return subscribeHarvested(() => {
    try { fn(labMaterialStocks()); } catch { /* noop */ }
  });
}

/**
 * What each Lab spend drew, per material, newest last. A refund without an
 * explicit origin (a cleared drawing, leaving the Lab) gives the newest
 * reservations back to the bags they came from, so an offline gather never
 * comes back as an online one after the player reconnects.
 */
interface Reservation { units: number; draws: BagDraw[] }
const reservations = new Map<LabMaterialId, Reservation[]>();
const MAX_RESERVATIONS = 500;

function reserve(id: LabMaterialId, units: number, draws: BagDraw[]): void {
  const stack = reservations.get(id) ?? [];
  stack.push({ units, draws });
  if (stack.length > MAX_RESERVATIONS) stack.splice(0, stack.length - MAX_RESERVATIONS);
  reservations.set(id, stack);
}

/**
 * Spend `units` of a material from the bag. False (nothing spent) when
 * short. Coin crafting passes `{ onlineOnly: true }`: a coin is an online
 * asset, so offline gathers never go into one.
 */
export function spendLabMaterial(id: LabMaterialId, units: number, scope?: BagScope): boolean {
  if (!Number.isSafeInteger(units) || units <= 0) return false;
  const bag = BAG_MATERIAL[id];
  const good = GOOD_KIND[id];
  let draws: BagDraw[] | null = null;
  if (bag) draws = spendMaterialsDraws({ [bag]: units }, scope);
  else if (good) draws = spendHarvestedDraws([{ symbol: `good:${good}`, count: units }], scope);
  if (!draws) return false;
  // Online-only spends refund with an explicit 'online' origin.
  if (!scope?.onlineOnly) reserve(id, units, draws);
  return true;
}

/** Take the newest `atoms` worth of draws off a reservation, newest draw first. */
function takeDraws(draws: BagDraw[], atoms: number): BagDraw[] {
  const out: BagDraw[] = [];
  let left = atoms;
  while (left > 0 && draws.length > 0) {
    const last = draws[draws.length - 1];
    const take = Math.min(left, last.count);
    out.push({ key: last.key, count: take });
    last.count -= take;
    left -= take;
    if (last.count <= 0) draws.pop();
  }
  return out;
}

/**
 * Put `units` of a material back in the bag (cancelled crafts, refunds).
 * With an `origin` (an online-only spend refunds 'online') it goes to that
 * bag. Without one, it goes back to the bags the Lab drew it from; any
 * amount the Lab has no record of returns to the offline bag, never the
 * online one.
 */
export function refundLabMaterial(id: LabMaterialId, units: number, origin?: HarvestOrigin): void {
  if (!Number.isSafeInteger(units) || units <= 0) return;
  const bag = BAG_MATERIAL[id];
  const good = GOOD_KIND[id];
  let left = units;
  if (!origin) {
    const stack = reservations.get(id) ?? [];
    const back: BagDraw[] = [];
    while (left > 0 && stack.length > 0) {
      const top = stack[stack.length - 1];
      if (top.units <= left) {
        back.push(...top.draws);
        left -= top.units;
        stack.pop();
      } else {
        const atoms = top.draws.reduce((n, d) => n + d.count, 0);
        const perUnit = top.units > 0 ? atoms / top.units : 0;
        back.push(...takeDraws(top.draws, Math.round(perUnit * left)));
        top.units -= left;
        left = 0;
      }
    }
    restoreDraws(back);
    if (left <= 0) return;
  }
  const to: HarvestOrigin = origin ?? 'offline';
  if (bag) { recordHarvestForResource(bag, left, to); return; }
  // Goods go straight back under their own bag key (one per unit).
  if (good) recordHarvestMany([{ symbol: `good:${good}`, count: left }], to);
}

/** Test seam. */
export function _resetLabReservationsForTest(): void {
  reservations.clear();
}

// ── Strokes → composition → Molecule ─────────────────────────────────────

/** Canvas pixels of stroke that use up one unit of material. */
export const PX_PER_UNIT = 100;

export function unitsForStroke(lengthPx: number): number {
  if (!Number.isFinite(lengthPx) || lengthPx <= 0) return 0;
  return Math.max(1, Math.round(lengthPx / PX_PER_UNIT));
}

export type LabComposition = Partial<Record<LabMaterialId, number>>;

export function compositionTotal(c: LabComposition): number {
  return Object.values(c).reduce((a, n) => a + (n ?? 0), 0);
}

/** Material with the most units drawn (ties: palette order). */
export function dominantMaterial(c: LabComposition): LabMaterial | null {
  let best: LabMaterial | null = null;
  let bestUnits = 0;
  for (const m of LAB_MATERIALS) {
    const u = c[m.id] ?? 0;
    if (u > bestUnits) { best = m; bestUnits = u; }
  }
  return best;
}

const SHELL_OF: Record<string, number> = {
  H: 0, C: 2, N: 2, O: 2, Si: 2, Al: 2, Ca: 3, Fe: 3,
};

const SUBSCRIPT = '₀₁₂₃₄₅₆₇₈₉';
function sub(n: number): string {
  return n > 1 ? String(n).split('').map((d) => SUBSCRIPT[Number(d)]).join('') : '';
}

/** "Wood & Stone" style default name for a drawing. */
export function defaultCreationName(c: LabComposition): string {
  const used = LAB_MATERIALS.filter((m) => (c[m.id] ?? 0) > 0)
    .sort((a, b) => (c[b.id] ?? 0) - (c[a.id] ?? 0))
    .slice(0, 2)
    .map((m) => m.label);
  return used.length ? used.join(' & ') : 'Creation';
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'creation';
}

/**
 * Turn what was drawn into a Molecule. Proportions are kept, but large
 * drawings are scaled down to at most ~8 units per material so a tool head
 * stays a tool head and not a boulder.
 */
export function compositionToMolecule(
  c: LabComposition,
  name: string = defaultCreationName(c),
  now: number = Date.now(),
): Molecule | null {
  const total = compositionTotal(c);
  if (total <= 0) return null;
  const largest = Math.max(...LAB_MATERIALS.map((m) => c[m.id] ?? 0));
  const scale = largest > 8 ? 8 / largest : 1;

  const atoms = new Map<string, number>();
  for (const m of LAB_MATERIALS) {
    const units = c[m.id] ?? 0;
    if (units <= 0) continue;
    const scaled = Math.max(1, Math.round(units * scale));
    for (const part of m.constituents) {
      atoms.set(part.symbol, (atoms.get(part.symbol) ?? 0) + part.count * scaled);
    }
  }
  const constituents = [...atoms.entries()].map(([symbol, count]) => ({ symbol, count }));
  const formula = constituents.map((p) => `${p.symbol}${sub(p.count)}`).join('');
  const shellTags = [...new Set(constituents.map((p) => SHELL_OF[p.symbol] ?? 2))].sort((a, b) => a - b);
  const dominant = dominantMaterial(c);
  const label = name.trim() || defaultCreationName(c);
  return {
    id: `lab_${slug(label)}_${now.toString(36)}`,
    name: label,
    formula,
    constituents,
    color: dominant?.color ?? '#a47148',
    shellTags,
  };
}

// ── Forge payloads ───────────────────────────────────────────────────────

/** Key a material uses inside a coin's craft buffer and sealed payload. */
export const MATERIAL_KEY_PREFIX = 'mat:';

export function materialKey(id: LabMaterialId): string {
  return `${MATERIAL_KEY_PREFIX}${id}`;
}

export function materialFromKey(key: string): LabMaterial | null {
  if (!key.startsWith(MATERIAL_KEY_PREFIX)) return null;
  const id = key.slice(MATERIAL_KEY_PREFIX.length);
  return isLabMaterialId(id) ? BY_ID[id] : null;
}

/**
 * Bag entries for `units` of a material, exactly as gathering one unit
 * records it (see `recordHarvestForResource`). Used when a sealed coin is
 * smelted back into a project's pool.
 */
export function materialBagParts(id: LabMaterialId, units: number): { symbol: string; count: number }[] {
  if (!Number.isFinite(units) || units <= 0) return [];
  switch (id) {
    case 'wood': return [{ symbol: 'C', count: 2 * units }];
    case 'stone': return [{ symbol: 'Si', count: 2 * units }];
    case 'water': return [{ symbol: 'O', count: 3 * units }];
    case 'fiber': return [{ symbol: 'H', count: 4 * units }];
    default: return [{ symbol: `good:${GOOD_KIND[id] ?? id}`, count: units }];
  }
}
