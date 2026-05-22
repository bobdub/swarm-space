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
import { initChemistry, clearChemistry } from './npcChemistry';
import { resolveLocalAnchorId } from './localAnchor';
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

function seedOffset(id: string): { tx: number; tz: number } {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const a = ((h >>> 0) / 0x100000000) * Math.PI * 2;
  const r = 6 + (((h >>> 16) & 0xffff) / 0xffff) * 6;
  return { tx: Math.cos(a) * r, tz: Math.sin(a) * r };
}

function syncNpcBlocks(npc: Npc): void {
  const engine = getBuilderBlockEngine();
  for (const slot of npc.body) {
    engine.upgradeBlock(`${npc.id}:${slot.kind}`, {
      rightOffset: npc.tx + slot.rightOffset,
      forwardOffset: npc.tz + slot.forwardOffset,
      upOffset: slot.upOffset,
      yaw: slot.yaw,
      meta: {
        npcId: npc.id,
        compoundName: slot.compoundName,
        constituents: slot.constituents,
        npcName: npc.name,
        npcSex: npc.sex,
        slotKind: slot.kind,
      },
    });
  }
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export interface SpawnArgs {
  /** Display name. */
  name: string;
  sex: NpcSex;
  /** Earth-local anchor where the body-graph is glued. */
  anchorPeerId: string;
  /** Optional tangent-plane spawn offset relative to the anchor, metres. */
  tx?: number;
  /** Optional tangent-plane spawn offset relative to the anchor, metres. */
  tz?: number;
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
  const anchorPeerId = resolveLocalAnchorId(args.anchorPeerId);
  const baseSeed = typeof args.seed === 'string'
    ? reseedUntilUnique(args.seed, isSeedUnique)
    : args.seed;

  const id = uid('npc');
  const body = buildNpcBodyGraph(baseSeed);
  const offset = (typeof args.tx === 'number' && typeof args.tz === 'number')
    ? { tx: args.tx, tz: args.tz }
    : seedOffset(id);
  const npc: Npc = {
    id,
    name: args.name,
    sex: args.sex,
    seed: baseSeed,
    anchorPeerId,
    tx: offset.tx,
    tz: offset.tz,
    body,
    skills: {},
    ageYears: 0,
    bornAt: new Date().toISOString(),
  };

  const result = register(npc);
  if (!result.ok) return result;

  // Phase 8 — derive chemistry composition + start an empty inventory.
  initChemistry(npc);

  // Place body slots through the builder engine — the only sanctioned
  // world-mutation path for any block (mirrors wetWorkGrowth).
  const engine = getBuilderBlockEngine();
  for (const slot of body) {
    engine.placeBlock({
      id: `${id}:${slot.kind}`,
      kind: `npc:${slot.kind}`,
      anchorPeerId,
      rightOffset: npc.tx + slot.rightOffset,
      forwardOffset: npc.tz + slot.forwardOffset,
        upOffset: slot.upOffset,
      yaw: slot.yaw,
      mass: slot.mass,
      basin: slot.basin,
      meta: {
        npcId: id,
        compoundName: slot.compoundName,
        constituents: slot.constituents,
        npcName: npc.name,
        npcSex: npc.sex,
        slotKind: slot.kind,
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
  clearChemistry(id);
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

export function syncNpcBodyBlocks(npc: Npc): void {
  syncNpcBlocks(npc);
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