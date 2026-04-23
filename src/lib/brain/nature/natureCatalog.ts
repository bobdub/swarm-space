/**
 * NATURE_CATALOG — static species data for Phase 2 of
 * `docs/BRAIN_NATURE_PHASES.md`. Pure content: mass, basin, real
 * compound constituents (so colors derive from the periodic-table
 * palette already shared with `compoundCatalog` / `ElementsVisual`).
 *
 * NO behavior here. Lifecycle / motion belongs to Phase 3's
 * BiologyEngine. This module only describes what each species *is*.
 */
import { blendColor, type CompoundConstituent } from '@/lib/virtualHub/compoundCatalog';

export type NatureKind =
  | 'water'
  | 'grass'
  | 'flower'
  | 'tree'
  | 'fish'
  | 'hive'
  | 'bee'
  | 'queen_bee'
  | 'mountain';

export interface NatureSpec {
  kind: NatureKind;
  /** Human label for HUD / debug. */
  label: string;
  /** Real chemical proxy — drives the rendered color via `blendColor`. */
  constituents: CompoundConstituent[];
  /** UQRC body mass passed to the BuilderBlockEngine. */
  mass: number;
  /** Curvature basin radius (Phase 1 engine: `pinPiece(world, basin)`). */
  basin: number;
  /** Hard population cap — Phase 3 BiologyEngine will enforce. */
  cap: number;
  /** Optional TTL in seconds (Phase 3). */
  ttlSec?: number;
  /** Pre-blended hex color so renderers don't recompute every frame. */
  color: string;
}

function spec(
  kind: NatureKind,
  label: string,
  constituents: CompoundConstituent[],
  mass: number,
  basin: number,
  cap: number,
  ttlSec?: number,
): NatureSpec {
  return { kind, label, constituents, mass, basin, cap, ttlSec, color: blendColor(constituents) };
}

/**
 * Real chemistry, simplified:
 *   water  = H2O
 *   grass  = cellulose-ish (C, H, O) with N for chlorophyll tint
 *   flower = leaf blend + a touch of P/K/Ca for pigment
 *   tree   = oak / cellulose-dominant
 *   fish   = water-rich tissue (H, O, C, N)
 *   hive   = beeswax (C, H, O) skewed waxy
 *   bee    = chitin (C, H, N, O) — yellow/black handled at render time
 */
export const NATURE_CATALOG: Record<NatureKind, NatureSpec> = {
  water: spec('water', 'Water', [
    { symbol: 'H', count: 2 }, { symbol: 'O', count: 1 },
  ], 2, 0.15, 9999),
  grass: spec('grass', 'Grass', [
    { symbol: 'C', count: 6 }, { symbol: 'H', count: 10 }, { symbol: 'O', count: 5 }, { symbol: 'N', count: 1 },
  ], 1, 0.08, 9999),
  flower: spec('flower', 'Flower', [
    { symbol: 'C', count: 4 }, { symbol: 'H', count: 6 }, { symbol: 'O', count: 3 },
    { symbol: 'N', count: 1 }, { symbol: 'K', count: 1 },
  ], 1, 0.10, 60),
  tree: spec('tree', 'Tree', [
    { symbol: 'C', count: 6 }, { symbol: 'H', count: 10 }, { symbol: 'O', count: 5 },
  ], 8, 0.25, 30),
  fish: spec('fish', 'Fish', [
    { symbol: 'H', count: 12 }, { symbol: 'O', count: 6 }, { symbol: 'C', count: 4 }, { symbol: 'N', count: 1 },
  ], 3, 0.12, 20),
  hive: spec('hive', 'Hive', [
    { symbol: 'C', count: 46 }, { symbol: 'H', count: 92 }, { symbol: 'O', count: 2 },
  ], 6, 0.20, 4),
  bee: spec('bee', 'Bee', [
    { symbol: 'C', count: 8 }, { symbol: 'H', count: 13 }, { symbol: 'N', count: 1 }, { symbol: 'O', count: 5 },
  ], 0.5, 0.05, 40),
  queen_bee: spec('queen_bee', 'Queen Bee', [
    { symbol: 'C', count: 8 }, { symbol: 'H', count: 13 }, { symbol: 'N', count: 1 }, { symbol: 'O', count: 5 },
    { symbol: 'Fe', count: 1 },
  ], 1, 0.07, 4),
  // Mountain — silicate / basalt-like crust uplifted at convergent plate
  // boundaries. Mass + basin are large because mountains are *terrain*,
  // not creatures: the deep basin makes them a long-lived UQRC pin.
  mountain: spec('mountain', 'Mountain', [
    { symbol: 'Si', count: 1 }, { symbol: 'O', count: 2 },
    { symbol: 'Al', count: 1 }, { symbol: 'Fe', count: 1 },
  ], 50, 1.2, 9999),
};

export function getNatureSpec(kind: NatureKind): NatureSpec {
  return NATURE_CATALOG[kind];
}