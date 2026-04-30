/**
 * npcBody — pure builder of a 6-slot NPC body-graph.
 *
 * Each slot is a real chemical compound whose constituent symbols MUST
 * exist in `SHELL_DEFS ∪ INNER_SYMBOLS` (`src/lib/brain/elements.ts`).
 * Validated at module load — same discipline as `prefabHouseCatalog`
 * and `moleculeCatalog`.
 *
 * The returned slots are CONSUMED by `npcEngine.spawnNpc`, which calls
 * `builderBlockEngine.placeBlock` for each. No physics / field writes
 * happen in this file.
 */
import { SHELL_DEFS, INNER_SYMBOLS } from '@/lib/brain/elements';
import type { CompoundConstituent } from '@/lib/virtualHub/compoundCatalog';
import type { NpcBodySlot, PersonalitySeed } from './npcTypes';

// ── Periodic guardrail ────────────────────────────────────────────────
const VALID_SYMBOLS: ReadonlySet<string> = new Set<string>([
  ...SHELL_DEFS.flatMap((s) => s.symbols),
  ...INNER_SYMBOLS,
]);

function assertValid(constituents: CompoundConstituent[], where: string): void {
  for (const { symbol } of constituents) {
    if (!VALID_SYMBOLS.has(symbol)) {
      throw new Error(`[npcBody] '${symbol}' in ${where} is not in SHELL_DEFS ∪ INNER_SYMBOLS`);
    }
  }
}

// ── Slot compound recipes (real chemistry only) ──────────────────────
interface SlotRecipe {
  compoundName: string;
  constituents: CompoundConstituent[];
  mass: number;
  basin: number;
}

const RECIPES: Record<string, SlotRecipe> = {
  // Core: water-rich cytoplasm + protein matrix
  core: {
    compoundName: 'cytoplasm',
    constituents: [
      { symbol: 'H', count: 8 }, { symbol: 'O', count: 4 },
      { symbol: 'C', count: 6 }, { symbol: 'N', count: 1 },
    ],
    mass: 14,
    basin: 0.55,
  },
  // Head: bone (Ca/P) + lens (Si/O) for photosensitive eyes
  head: {
    compoundName: 'cranium-and-lens',
    constituents: [
      { symbol: 'Ca', count: 3 }, { symbol: 'P', count: 2 }, { symbol: 'O', count: 4 },
      { symbol: 'Si', count: 1 }, { symbol: 'C', count: 2 }, { symbol: 'H', count: 2 },
    ],
    mass: 5,
    basin: 0.32,
  },
  // Limbs: keratin/protein lattice (C/H/N/O/S)
  arm: {
    compoundName: 'keratin-arm',
    constituents: [
      { symbol: 'C', count: 5 }, { symbol: 'H', count: 7 },
      { symbol: 'N', count: 1 }, { symbol: 'O', count: 1 }, { symbol: 'S', count: 1 },
    ],
    mass: 3,
    basin: 0.22,
  },
  leg: {
    compoundName: 'bone-and-muscle',
    constituents: [
      { symbol: 'Ca', count: 2 }, { symbol: 'P', count: 1 }, { symbol: 'O', count: 3 },
      { symbol: 'C', count: 4 }, { symbol: 'H', count: 6 }, { symbol: 'N', count: 1 },
    ],
    mass: 4,
    basin: 0.28,
  },
};

// Module-load validation — fail loudly if a recipe drifts off the periodic table.
for (const [name, r] of Object.entries(RECIPES)) {
  assertValid(r.constituents, `recipe '${name}'`);
}

/**
 * Build the 6-slot body-graph for an NPC. Pure — same seed always
 * returns the same layout. Personality lightly biases mass / basin so
 * curious NPCs have slightly larger heads, warmer NPCs slightly larger
 * cores, etc., without changing chemistry.
 */
export function buildNpcBodyGraph(seed: PersonalitySeed): NpcBodySlot[] {
  const headBoost = 1 + 0.1 * Math.max(0, seed.curiosity);
  const coreBoost = 1 + 0.1 * Math.max(0, seed.relationalWarmth);
  const limbBoost = 1 + 0.08 * Math.max(0, seed.riskTolerance);

  const slot = (
    kind: NpcBodySlot['kind'],
    recipeKey: keyof typeof RECIPES,
    rightOffset: number,
    forwardOffset: number,
    yaw: number,
    boost: number,
  ): NpcBodySlot => {
    const r = RECIPES[recipeKey];
    return {
      kind,
      compoundName: r.compoundName,
      constituents: r.constituents,
      mass: +(r.mass * boost).toFixed(3),
      basin: r.basin,
      rightOffset,
      forwardOffset,
      yaw,
    };
  };

  return [
    slot('core', 'core', 0.0, 0.0, 0, coreBoost),
    slot('head', 'head', 0.0, 0.0, 0, headBoost),
    slot('arm_l', 'arm', -0.5, 0.0, +Math.PI / 2, limbBoost),
    slot('arm_r', 'arm', +0.5, 0.0, -Math.PI / 2, limbBoost),
    slot('leg_l', 'leg', -0.25, -0.1, 0, limbBoost),
    slot('leg_r', 'leg', +0.25, -0.1, 0, limbBoost),
  ];
}