/**
 * Nature catalog — Building Blocks of the default biome.
 *
 * Each species is a real compound (constituents must exist in
 * `lib/brain/elements.ts` element table, same rule as virtualHub
 * compoundCatalog). Color is blended from element CPK colors so the
 * universe + the biome agree on what each kind looks like.
 *
 * Caps + TTLs are read by `biology.ts` to keep the world bounded.
 */
import { blendColor, type CompoundConstituent } from '@/lib/virtualHub/compoundCatalog';

export type NatureKind =
  | 'water'
  | 'grass'
  | 'flower'
  | 'pollen'
  | 'seed'
  | 'sapling'
  | 'tree'
  | 'fish'
  | 'fry'
  | 'hive'
  | 'queen_bee'
  | 'worker_bee';

export type FishSex = 'female' | 'male';

export interface NatureSpec {
  kind: NatureKind;
  /** Human-readable id for the underlying compound. */
  compoundId: string;
  formula: string;
  constituents: CompoundConstituent[];
  /** Mass used for UQRC body (informational + curvature scaler). */
  mass: number;
  /** Curvature basin depth passed to physics.pinPiece. */
  basin: number;
  /** Population cap enforced by biology applier. */
  cap: number;
  /** Optional time-to-live in seconds (pollen → expire). */
  ttlSec?: number;
  /** Color derived from constituents. */
  color: string;
}

const def = (
  kind: NatureKind,
  compoundId: string,
  formula: string,
  constituents: CompoundConstituent[],
  mass: number,
  basin: number,
  cap: number,
  ttlSec?: number,
): NatureSpec => ({
  kind,
  compoundId,
  formula,
  constituents,
  mass,
  basin,
  cap,
  ttlSec,
  color: blendColor(constituents),
});

export const NATURE_CATALOG: Record<NatureKind, NatureSpec> = {
  // H₂O
  water: def('water', 'water', 'H₂O',
    [{ symbol: 'H', count: 2 }, { symbol: 'O', count: 1 }], 4, 0.15, 1),
  // Cellulose (C₆H₁₀O₅)ₙ — chlorophyll tinted via N for blade color
  grass: def('grass', 'cellulose', '(C₆H₁₀O₅)ₙ',
    [{ symbol: 'C', count: 6 }, { symbol: 'H', count: 10 }, { symbol: 'O', count: 5 }, { symbol: 'N', count: 1 }],
    0.4, 0.02, 200),
  // Anthocyanin-ish
  flower: def('flower', 'anthocyanin', 'C₁₅H₁₁O₆',
    [{ symbol: 'C', count: 15 }, { symbol: 'H', count: 11 }, { symbol: 'O', count: 6 }, { symbol: 'N', count: 1 }],
    0.6, 0.05, 60),
  // Sporopollenin C₉₀H₁₄₄O₂₇ — short-lived
  pollen: def('pollen', 'sporopollenin', 'C₉₀H₁₄₄O₂₇',
    [{ symbol: 'C', count: 90 }, { symbol: 'H', count: 144 }, { symbol: 'O', count: 27 }],
    0.05, 0.005, 80, 12),
  // Tree life-cycle: cellulose + lignin proxy
  seed: def('seed', 'cellulose-lignin', '(C₉H₁₀O₂)+(C₆H₁₀O₅)',
    [{ symbol: 'C', count: 15 }, { symbol: 'H', count: 20 }, { symbol: 'O', count: 7 }],
    0.3, 0.05, 30),
  sapling: def('sapling', 'cellulose-lignin', '(C₉H₁₀O₂)+(C₆H₁₀O₅)',
    [{ symbol: 'C', count: 15 }, { symbol: 'H', count: 20 }, { symbol: 'O', count: 7 }],
    2, 0.12, 30),
  tree: def('tree', 'cellulose-lignin', '(C₉H₁₀O₂)+(C₆H₁₀O₅)',
    [{ symbol: 'C', count: 15 }, { symbol: 'H', count: 20 }, { symbol: 'O', count: 7 }],
    8, 0.25, 30),
  // Fish: keratin proxy (C+H+N+O+S)
  fish: def('fish', 'keratin', '(C·H·N·O·S)',
    [{ symbol: 'C', count: 30 }, { symbol: 'H', count: 48 }, { symbol: 'N', count: 8 }, { symbol: 'O', count: 9 }, { symbol: 'S', count: 1 }],
    1.2, 0.04, 20),
  fry: def('fry', 'keratin', '(C·H·N·O·S)',
    [{ symbol: 'C', count: 30 }, { symbol: 'H', count: 48 }, { symbol: 'N', count: 8 }, { symbol: 'O', count: 9 }, { symbol: 'S', count: 1 }],
    0.3, 0.02, 20),
  // Hive — beeswax C₁₅H₃₁COOC₃₀H₆₁
  hive: def('hive', 'beeswax', 'C₄₆H₉₂O₂',
    [{ symbol: 'C', count: 46 }, { symbol: 'H', count: 92 }, { symbol: 'O', count: 2 }],
    6, 0.30, 1),
  // Bees — chitin proxy (C·H·N·O)
  queen_bee: def('queen_bee', 'chitin', '(C₈H₁₃NO₅)ₙ',
    [{ symbol: 'C', count: 8 }, { symbol: 'H', count: 13 }, { symbol: 'N', count: 1 }, { symbol: 'O', count: 5 }],
    0.2, 0.02, 1),
  worker_bee: def('worker_bee', 'chitin', '(C₈H₁₃NO₅)ₙ',
    [{ symbol: 'C', count: 8 }, { symbol: 'H', count: 13 }, { symbol: 'N', count: 1 }, { symbol: 'O', count: 5 }],
    0.1, 0.01, 40),
};

/** Default starter biome counts (placed deterministically near anchor). */
export const STARTER_BIOME = {
  water: 1,
  grass: 60,
  flower: 18,
  fish_female: 7,
  fish_male: 3,
  seed: 10,
  hive: 1,
  queen_bee: 1,
  worker_bee: 6,
} as const;
