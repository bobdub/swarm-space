/**
 * npcChemistry — per-NPC composition (from body constituents) plus a
 * small physical inventory ledger. Pure module-level state; no I/O.
 *
 * Composition is derived once on spawn from `Npc.body[].constituents`,
 * which are already periodic-table validated by npcBody. Inventory is
 * the realised yield of wet-work interactions (water, food, wood, ...).
 */
import type { Npc, NpcBodySlot } from './npcTypes';

export type InventoryKind = 'water' | 'food' | 'wood' | 'fiber' | 'hides';

export type Composition = Record<string, number>;
export type Inventory = Record<InventoryKind, number>;

const _composition = new Map<string, Composition>();
const _inventory = new Map<string, Inventory>();

function emptyInventory(): Inventory {
  return { water: 0, food: 0, wood: 0, fiber: 0, hides: 0 };
}

/** Build composition from a body graph — atom counts summed across slots. */
export function compositionFromBody(body: NpcBodySlot[]): Composition {
  const out: Composition = {};
  for (const slot of body) {
    for (const c of slot.constituents) {
      out[c.symbol] = (out[c.symbol] ?? 0) + (c.count ?? 0);
    }
  }
  return out;
}

/** Initialise chemistry + empty inventory for a freshly spawned NPC. */
export function initChemistry(npc: Npc): void {
  _composition.set(npc.id, compositionFromBody(npc.body));
  if (!_inventory.has(npc.id)) _inventory.set(npc.id, emptyInventory());
}

export function clearChemistry(npcId: string): void {
  _composition.delete(npcId);
  _inventory.delete(npcId);
}

export function getComposition(npcId: string): Composition {
  return { ...(_composition.get(npcId) ?? {}) };
}

export function getInventory(npcId: string): Inventory {
  return { ...(_inventory.get(npcId) ?? emptyInventory()) };
}

function ensureInv(npcId: string): Inventory {
  let inv = _inventory.get(npcId);
  if (!inv) { inv = emptyInventory(); _inventory.set(npcId, inv); }
  return inv;
}

/** Add to a kind. Returns the new total. */
export function deposit(npcId: string, kind: InventoryKind, qty: number): number {
  const inv = ensureInv(npcId);
  inv[kind] = Math.max(0, inv[kind] + qty);
  return inv[kind];
}

/** Remove from a kind. Returns true iff the full quantity was available. */
export function consume(npcId: string, kind: InventoryKind, qty: number): boolean {
  const inv = ensureInv(npcId);
  if (inv[kind] < qty) return false;
  inv[kind] -= qty;
  return true;
}

/** Test seam. */
export function _resetChemistryForTest(): void {
  _composition.clear();
  _inventory.clear();
}
