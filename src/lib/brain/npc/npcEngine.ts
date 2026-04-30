/**
 * npcEngine — singleton API surface for NPC lifecycle.
 *
 * SCAFFOLD STAGE — exposes spawn / despawn / step but does NOT register
 * any timer or auto-run. Boot wiring (8 Hz step loop, body rendering,
 * field sampling bridge) lands in the follow-up patch, mirroring the
 * weighted-coin scheduler discipline.
 *
 * Invariants:
 *   - Only this module places NPC body blocks via builderBlockEngine.
 *   - Never writes field.axes / body.pos / pin templates directly.
 *   - Population cap and personality uniqueness enforced via npcRegistry.
 */
import { getBuilderBlockEngine } from '@/lib/brain/builderBlockEngine';
import { reseedUntilUnique, seedFromString } from './personalitySeed';
import { buildNpcBodyGraph } from './npcBody';
import {
  isSeedUnique,
  register,
  unregister,
  update,
  getNpc,
  listNpcs,
  npcCount,
  subscribe as subscribeRegistry,
} from './npcRegistry';
import type { Npc, NpcSex, PersonalitySeed } from './npcTypes';

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export interface SpawnArgs {
  /** Display name. */
  name: string;
  sex: NpcSex;
  /** Earth-local anchor where the body-graph is glued. */
  anchorPeerId: string;
  /** Either a base string (will be seeded + uniqueness-rerolled) or a precomputed seed. */
  seed: string | PersonalitySeed;
}

export type SpawnResult =
  | { ok: true; npc: Npc }
  | { ok: false; reason: 'cap-reached' | 'duplicate-personality' };

/**
 * Spawn a new NPC. Routes every body slot through
 * `BuilderBlockEngine.placeBlock` — same path used by trees and
 * habitats. No field writes happen here.
 */
export function spawnNpc(args: SpawnArgs): SpawnResult {
  const baseSeed = typeof args.seed === 'string'
    ? reseedUntilUnique(args.seed, isSeedUnique)
    : args.seed;

  const id = uid('npc');
  const body = buildNpcBodyGraph(baseSeed);
  const npc: Npc = {
    id,
    name: args.name,
    sex: args.sex,
    seed: baseSeed,
    anchorPeerId: args.anchorPeerId,
    body,
    skills: {},
    ageYears: 0,
    bornAt: new Date().toISOString(),
  };

  const result = register(npc);
  if (!result.ok) return result;

  // Place body slots through the builder engine — the only sanctioned
  // world-mutation path for any block (mirrors wetWorkGrowth).
  const engine = getBuilderBlockEngine();
  for (const slot of body) {
    engine.placeBlock({
      id: `${id}:${slot.kind}`,
      kind: `npc:${slot.kind}`,
      anchorPeerId: args.anchorPeerId,
      rightOffset: slot.rightOffset,
      forwardOffset: slot.forwardOffset,
      yaw: slot.yaw,
      mass: slot.mass,
      basin: slot.basin,
      meta: {
        npcId: id,
        compoundName: slot.compoundName,
        constituents: slot.constituents,
      },
    });
  }

  return { ok: true, npc };
}

/** Despawn — remove every body slot block, unregister the NPC. */
export function despawnNpc(id: string): boolean {
  const npc = getNpc(id);
  if (!npc) return false;
  const engine = getBuilderBlockEngine();
  for (const slot of npc.body) {
    engine.removeBlock(`${id}:${slot.kind}`);
  }
  return unregister(id);
}

/**
 * Engine step — placeholder for the future 8 Hz tick.
 *
 * In the boot patch this will:
 *   1. age every NPC by `dtSeconds / brainYearSeconds`
 *   2. sample drive signals around each body
 *   3. update relational edges + skills
 *   4. issue `upgradeBlock` calls for posture changes
 * Today it is a no-op so the API surface is stable.
 */
export function step(_dtSeconds: number): void {
  // intentional no-op in scaffold
}

// Re-export read API so consumers don't reach into the registry directly.
export { getNpc, listNpcs, npcCount };

/** Subscribe to registry changes (spawn / despawn / update). */
export function subscribe(fn: (list: Npc[]) => void): () => void {
  return subscribeRegistry(fn);
}

/** Convenience: build a deterministic seed without spawning. */
export function previewSeed(baseString: string): PersonalitySeed {
  return seedFromString(baseString);
}