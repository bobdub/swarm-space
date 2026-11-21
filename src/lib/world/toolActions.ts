import { toast } from 'sonner';
import { getBuilderBlockEngine } from '@/lib/brain/builderBlockEngine';
import { getPrefab } from '@/lib/brain/prefabHouseCatalog';
import { getToolAny } from '@/lib/brain/toolCatalog';
import { applyImpact, emitCellCarved } from '@/lib/brain/sculpting';
import { sampleSurfaceClass } from '@/lib/brain/surfaceClass';
import { getNatureSpec } from '@/lib/brain/nature/natureCatalog';
import { EARTH_RADIUS, getEarthPose, getEarthPoseTime, quatRotate, worldPosToLocalNormal, type Vec3 } from '@/lib/brain/earth';
import {
  HITS_TO_FELL,
  TOPPLE_MS,
  STUMP_FADE_MS,
  registerTreeHit,
  clearTreeChop,
  isTreeFelled,
} from '@/lib/world/treeChopStore';
import { spawnDrop } from '@/lib/world/worldDropsStore';
import { isTreeGrown, pickFruit, fruitAt, isFruitPicked } from '@/lib/brain/nature/natureGrowth';
import { hiveBuildProgress } from '@/lib/brain/nature/hiveRehome';
import { canCollectHoney, collectHoney } from '@/lib/world/honeyStore';
import { recordNatureEvent } from '@/lib/world/natureEventsStore';
import {
  HITS_TO_BREAK,
  BREAK_MS,
  registerStoneHit,
  clearStoneMine,
  isStoneBroken,
} from '@/lib/world/stoneMineStore';
import { recordPlayerHarvest } from '@/lib/world/playerHarvest';
import { swingProgress, swingResisted, swingSuccess } from '@/lib/world/swingFeedback';
import { playerSwingEnergy } from '@/lib/world/swingEnergy';

import { recordLocalPlacement, removeLocalPlacement, type PlacementRecord } from '@/lib/world/worldPlacementsStore';
import { placePrefabAtHit } from '@/lib/world/placementController';
import { canBuildAtWorldPoint } from '@/lib/world/landPermissions';
import type { ToolTarget } from '@/lib/world/toolTargets';
import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';
import { emitImpactFx, emitSwingFx, type ImpactMaterial } from '@/lib/world/swingFxBus';
import {
  carveCell,
  shellAtDepth,
  DIG_STEP_M,
} from '@/lib/world/carvedCellsStore';
import { getToolTarget, setToolTarget } from '@/lib/world/toolTargetStore';
import { weatherCurvatureBoost } from '@/lib/world/weather';
import { tryCatchNearbyHen } from '@/lib/world/henHunting';


export type ToolVerb = 'chop' | 'whittle' | 'dig' | 'mine' | 'gather' | 'sharpen' | 'none';

function verbFor(toolPrefabId: string): ToolVerb {
  if (toolPrefabId.startsWith('tool_axe')) return 'chop';
  if (toolPrefabId.startsWith('tool_knife')) return 'whittle';
  if (toolPrefabId.startsWith('tool_shovel')) return 'dig';
  if (toolPrefabId.startsWith('tool_pick')) return 'mine';
  if (toolPrefabId.startsWith('tool_bucket')) return 'gather';
  if (toolPrefabId.startsWith('consumable_salt')) return 'sharpen';
  return 'none';
}

/** Nature kinds made of rock. Only a pick can break them. */
export const ROCK_KINDS: ReadonlySet<string> = new Set(['stone', 'mountain', 'volcano']);

/**
 * Rock is pick work. Returns null when the tool may strike `natureKind`,
 * otherwise the line to show the player. An axe edge only bounces off
 * stone, so the Stone Axe (and every other non-pick) is refused here,
 * before any swing energy is spent.
 */
export function rockToolRefusal(toolPrefabId: string, natureKind: string, toolLabel: string): string | null {
  if (!ROCK_KINDS.has(natureKind)) return null;
  if (verbFor(toolPrefabId) === 'mine') return null;
  return `${toolLabel} can't break stone. Use a Stone Pick.`;
}

function unitFrom(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

function labelForKind(kind: string): string {
  return kind.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

export function bondTermForKind(kind: string): number {
  if (/tree|wood|trunk|log|root/.test(kind)) return 0.42;
  if (/stone|rock|mountain|foundation/.test(kind)) return 0.88;
  if (/grass|flower|fish|water/.test(kind)) return 0.18;
  return 0.55;
}

/** Which particle burst a struck thing produces. */
function materialForKind(kind: string): ImpactMaterial {
  if (/tree|wood|trunk|log|root|plank|door/.test(kind)) return 'wood';
  if (/stone|rock|mountain|foundation|brick|wall/.test(kind)) return 'stone';
  if (/flower|grass|leaf|hive|bee/.test(kind)) return 'flora';
  if (/water|fish|pond|ocean/.test(kind)) return 'water';
  if (/lava|magma/.test(kind)) return 'lava';
  return 'soil';
}

function materialForShell(shellId: string): ImpactMaterial {
  if (shellId.startsWith('lava')) return 'lava';
  if (/aquifer/.test(shellId)) return 'water';
  if (/grass/.test(shellId)) return 'flora';
  if (/bedrock|obsidian|diamond|gold|platinum|mineral|coal/.test(shellId)) return 'stone';
  return 'soil';
}

function isSurfaceGatherable(point: Vec3): boolean {
  const r = Math.hypot(point[0], point[1], point[2]) || 1;
  const localNormal: Vec3 = [point[0] / r, point[1] / r, point[2] / r];
  const surface = sampleSurfaceClass(localNormal);
  return surface === 'ocean' || surface === 'shore';
}

function resolveSwingProbe(point: Vec3, up: Vec3, color: string, toolMass: number) {
  const probe = getBrainPhysics().sampleSwingAt(point, Math.max(0.02, toolMass * 0.05));
  emitSwingFx({
    variant: 'swing',
    point,
    up,
    color,
    radius: Math.max(1.1, Math.cbrt(toolMass) * 1.8),
    intensity: probe.intensity,
  });
  return probe;
}

function emitTargetImpact(
  point: Vec3,
  up: Vec3,
  color: string,
  intensity: number,
  label: string,
  success: boolean,
  material: ImpactMaterial = 'air',
) {
  emitImpactFx({
    point,
    up,
    color,
    radius: Math.max(0.75, 0.7 + intensity * 3.2),
    intensity,
    label,
    success,
    material,
  });
}


function pointInFrontOfSelf(selfId: string | undefined, reach: number): { point: Vec3; up: Vec3 } | null {
  if (!selfId) return null;
  const physics = getBrainPhysics();
  const body = physics.getBody(selfId);
  const intent = physics.getIntent(selfId);
  const forward = intent?.basis?.forward;
  if (!body || !forward) return null;
  const up = intent?.basis?.up ?? unitFrom(body.pos);
  return {
    point: [
      body.pos[0] + forward[0] * reach,
      body.pos[1] + forward[1] * reach,
      body.pos[2] + forward[2] * reach,
    ],
    up,
  };
}

/**
 * Land gate for a swing. Sculpting, digging and striking placed blocks
 * are all world mutations, so they honour the same plot ownership rule
 * as placement.
 */
function landBlocks(point: Vec3, selfId?: string): boolean {
  if (!selfId) return false;
  const perm = canBuildAtWorldPoint(point, selfId);
  if (perm.ok) return false;
  toast.error(perm.reason ?? 'You cannot alter this land.');
  return true;
}

async function applyImpactToBlock(params: {
  toolPrefabId: string;
  blockId: string;
  blockKind: string;
  label: string;
  point: Vec3;
  selfId?: string;
}): Promise<boolean> {
  const { toolPrefabId, blockId, blockKind, label, point, selfId } = params;
  const toolPrefab = getPrefab(toolPrefabId);
  const tool = getToolAny(toolPrefabId);
  const block = getBuilderBlockEngine().getBlock(blockId);
  if (!toolPrefab || !block) return false;
  if (landBlocks(point, selfId)) return false;

  if (!tool) {
    toast.message(toolPrefab.label, { description: 'This tool does not yet resolve through sculpting.' });
    return false;
  }

  const up = unitFrom(point);
  const probe = resolveSwingProbe(point, up, toolPrefab.color, tool.mass);
  const swing = applyImpact({
    tool,
    swingEnergy: playerSwingEnergy(tool.mass, probe.intensity),
    curvatureLoad: probe.curvatureLoad,
    target: {
      kind: 'block',
      block,
      bondTerm: bondTermForKind(blockKind),
    },
    actorId: selfId,
  });

  emitTargetImpact(
    point,
    up,
    toolPrefab.color,
    probe.intensity,
    swing.cut ? 'cut' : 'resist',
    swing.cut,
    materialForKind(blockKind),
  );


  if (!swing.cut) {
    swingResisted(toolPrefabId, toolPrefab.label, label);
    return true;
  }

  const durability = typeof block.meta.durability === 'number' ? (block.meta.durability as number) : 1;
  const next = Math.max(0, durability - Math.min(1, swing.effectiveCut * 0.35));
  if (next <= 0) {
    getBuilderBlockEngine().removeBlock(block.bodyId);
    swingSuccess(toolPrefabId, toolPrefab.label, `${label} yielded.`);
  } else {
    getBuilderBlockEngine().upgradeBlock(block.bodyId, { meta: { ...block.meta, durability: next } });
    swingProgress(toolPrefabId, toolPrefab.label, `${label} ${(next * 100).toFixed(0)}% intact.`);
  }
  return true;
}

export async function applyToolToPlacement(toolPrefabId: string, target: PlacementRecord, selfId?: string): Promise<boolean> {
  const prefab = getPrefab(target.prefabId);
  if (!prefab) return false;
  if (toolPrefabId.startsWith('consumable_salt')) {
    toast.message('Salt Rock', { description: 'Sharpening held/world tools is the next pass.' });
    return false;
  }
  const hit = target.hitPoint;
  return applyImpactToBlock({
    toolPrefabId,
    blockId: target.placementId,
    blockKind: target.prefabId,
    label: prefab.label,
    point: hit,
    selfId,
  });
}

/** What one bucket/hand gather of a nature block adds to the Gathered tally. */
export const GATHER_YIELD: Record<string, 'water' | 'food' | 'fibre'> = {
  water: 'water',
  fish: 'food',
  flower: 'fibre',
  grass: 'fibre',
};

const GATHER_LABEL: Record<'water' | 'food' | 'fibre', string> = {
  water: 'Water',
  food: 'Food',
  fibre: 'Fibre',
};

/** Is there fruit or honey to take? Other gatherables are always ready. */
function gatherReady(block: { kind: string; bodyId: string; id: string; meta: Record<string, unknown> }): boolean {
  const now = Date.now();
  if (block.kind === 'tree') {
    const f = fruitAt(block.bodyId, now);
    return f.ripe && !isFruitPicked(block.bodyId, f.crop);
  }
  if (block.kind === 'hive') {
    return hiveBuildProgress(block.meta?.builtAt, now) >= 1 && canCollectHoney(block.id, now);
  }
  return true;
}

function clearTargetIfBlock(blockId: string): void {
  const cur = getToolTarget();
  if (cur && cur.kind === 'nature' && cur.blockId === blockId) setToolTarget(null);
}

/** Reach (m, surface distance from the avatar) per nature kind a verb can work. */
const AUTO_REACH: Record<ToolVerb, Record<string, number>> = {
  chop: { tree: 4.2 },
  mine: { stone: 3.4, mountain: 14, volcano: 18 },
  // Trees (for fruit) and the hive (for honey) are only offered when there
  // is something to take — see `gatherReady`.
  gather: { flower: 2.8, grass: 2.8, fish: 3.2, water: 3.2, tree: 4.2, hive: 3.6 },
  whittle: {},
  dig: {},
  sharpen: {},
  none: {},
};

/**
 * Proximity target: when the player swings without having tapped a
 * target, pick the nearest workable nature block in front of / around
 * them. This is what makes "walk up to a tree and swing" work.
 */
export function resolveNearbyTarget(toolPrefabId: string, selfId?: string): ToolTarget | null {
  if (!selfId) return null;
  const reachTable = AUTO_REACH[verbFor(toolPrefabId)];
  if (!reachTable || Object.keys(reachTable).length === 0) return null;
  const physics = getBrainPhysics();
  const self = physics.getBody(selfId);
  if (!self) return null;
  const forward = physics.getIntent(selfId)?.basis?.forward;
  let best: { block: ReturnType<ReturnType<typeof getBuilderBlockEngine>['listBlocks']>[number]; score: number } | null = null;
  for (const block of getBuilderBlockEngine().listBlocks((b) => b.kind in reachTable)) {
    if (block.kind === 'tree' && isTreeFelled(block.bodyId)) continue;
    // Seedlings are too young to chop or to bear fruit.
    if (block.kind === 'tree' && !isTreeGrown(block, Date.now())) continue;
    if (verbFor(toolPrefabId) === 'gather' && !gatherReady(block)) continue;
    if (block.kind === 'stone' && isStoneBroken(block.bodyId)) continue;
    const body = physics.getBody(block.bodyId);
    if (!body) continue;
    const dx = body.pos[0] - self.pos[0];
    const dy = body.pos[1] - self.pos[1];
    const dz = body.pos[2] - self.pos[2];
    const d = Math.hypot(dx, dy, dz);
    if (!Number.isFinite(d) || d > reachTable[block.kind]) continue;
    // Prefer things in front: facing bonus up to 40% of distance.
    const facing = forward && d > 1e-3 ? (dx * forward[0] + dy * forward[1] + dz * forward[2]) / d : 0;
    const score = d * (1 - 0.4 * Math.max(0, facing));
    if (!best || score < best.score) best = { block, score };
  }
  if (!best) return null;
  const kind = best.block.kind;
  return {
    kind: 'nature',
    id: best.block.bodyId,
    label: getNatureSpec(kind as Parameters<typeof getNatureSpec>[0])?.label ?? labelForKind(kind),
    natureKind: kind,
    blockId: best.block.bodyId,
  };
}

/**
 * A knife swung with a shark in reach drives it off (it dives away for a
 * minute; see `sea/sharks.ts`). True when it did.
 */
async function knifeAtShark(toolPrefabId: string, selfId?: string): Promise<boolean> {
  if (!toolPrefabId.startsWith('tool_knife') || !selfId) return false;
  const body = getBrainPhysics().getBody(selfId);
  if (!body) return false;
  const n = worldPosToLocalNormal(body.pos, getEarthPose());
  // Loaded on demand: the sea modules pull in terrain and sea life.
  const { knifeShark } = await import('@/lib/brain/sea/sharks');
  if (!knifeShark(n, getEarthPoseTime(), Date.now())) return false;
  toast.success('You drove the shark off!', { id: 'shark-warning', description: 'It dives away and keeps clear for a minute.' });
  return true;
}

export async function applyToolToTarget(toolPrefabId: string, target: ToolTarget | null, selfId?: string): Promise<boolean> {
  if (await knifeAtShark(toolPrefabId, selfId)) return true;
  // A knife swung within reach of a free-range hen catches her, unless it
  // is aimed at something the player built.
  if (target?.kind !== 'placement' && tryCatchNearbyHen(toolPrefabId, selfId)) return true;
  if (!target) target = resolveNearbyTarget(toolPrefabId, selfId);
  if (!target) return swingToolInAir(toolPrefabId, selfId);
  if (target.kind === 'placement') return applyToolToPlacement(toolPrefabId, target.placement, selfId);

  const verb = verbFor(toolPrefabId);
  const prefab = getPrefab(toolPrefabId);
  if (!prefab || verb === 'none') return false;

  if (target.kind === 'surface') {
    const up = unitFrom(target.point);
    const probe = resolveSwingProbe(target.point, up, prefab.color, prefab.mass);
    const ok = verb === 'gather' && target.surfaceKind === 'water' && isSurfaceGatherable(target.point);
    emitTargetImpact(target.point, up, prefab.color, probe.intensity, ok ? 'collect' : 'miss', ok, 'water');
    if (!ok) {
      swingProgress(toolPrefabId, prefab.label, 'No gatherable water at this impact point.');
      return false;
    }
    recordPlayerHarvest('water', 1);
    swingSuccess(toolPrefabId, prefab.label, 'Collected water · +1 Water.');
    return true;
  }

  if (target.kind === 'shell') return digShell(toolPrefabId, target, selfId);



  // Fruit from a grown tree, honey from the hive. Neither is used up: the
  // tree ripens a new crop and the hive refills by tomorrow.
  if (verb === 'gather' && (target.natureKind === 'tree' || target.natureKind === 'hive')) {
    return gatherFromLiving(toolPrefabId, prefab.label, prefab.color, prefab.mass, target.natureKind, target.blockId);
  }

  const gathered = verb === 'gather' ? GATHER_YIELD[target.natureKind] : undefined;
  if (gathered) {
    // A stale target (already collected) must not pay out a second time.
    if (!getBuilderBlockEngine().getBlock(target.blockId)) {
      clearTargetIfBlock(target.blockId);
      return false;
    }
    const body = getBrainPhysics().getBody(target.blockId);
    const point = body ? ([body.pos[0], body.pos[1], body.pos[2]] as Vec3) : ([0, 0, 0] as Vec3);
    const up = unitFrom(point);
    const probe = resolveSwingProbe(point, up, prefab.color, prefab.mass);
    emitTargetImpact(point, up, prefab.color, probe.intensity, 'collect', true, materialForKind(target.natureKind));
    getBuilderBlockEngine().removeBlock(target.blockId);
    clearTargetIfBlock(target.blockId);
    recordPlayerHarvest(gathered, 1);
    swingSuccess(
      toolPrefabId,
      prefab.label,
      `Collected ${labelForKind(target.natureKind).toLowerCase()} · +1 ${GATHER_LABEL[gathered]}.`,
    );
    return true;
  }

  // Any tool but a bucket breaks the honey hive; the bees go and build a
  // new one in another tree.
  if (target.natureKind === 'hive') {
    return chopHive(toolPrefabId, prefab.label, prefab.color, prefab.mass, target.blockId, selfId);
  }

  // Trees take several cuts: each accepted swing shakes the trunk, and the
  // last one topples it and scatters wood on the ground.
  if (verb === 'chop' && target.natureKind === 'tree') {
    return chopTree(toolPrefabId, target.blockId, selfId);
  }

  // Rock is pick-only: the Stone Axe and every other tool is turned away.
  const rockRefusal = rockToolRefusal(toolPrefabId, target.natureKind, prefab.label);
  if (rockRefusal) {
    const body = getBrainPhysics().getBody(target.blockId);
    const point = body ? ([body.pos[0], body.pos[1], body.pos[2]] as Vec3) : ([0, 0, 0] as Vec3);
    const up = unitFrom(point);
    const probe = resolveSwingProbe(point, up, prefab.color, prefab.mass);
    emitTargetImpact(point, up, prefab.color, probe.intensity, 'wrong tool', false, 'stone');
    swingProgress(toolPrefabId, prefab.label, rockRefusal);
    return false;
  }

  // Loose boulders break apart under a pick, like a tree under an axe.
  if (verb === 'mine' && target.natureKind === 'stone') {
    return mineStone(toolPrefabId, target.blockId, selfId);
  }

  // Rock faces yield stone to a pick, chip by chip. The mountain stays —
  // only loose stone comes away.
  if (verb === 'mine' && (target.natureKind === 'mountain' || target.natureKind === 'volcano')) {
    return mineRock(toolPrefabId, target.blockId, target.natureKind, selfId);
  }





  const body = getBrainPhysics().getBody(target.blockId);
  const point = body ? ([body.pos[0], body.pos[1], body.pos[2]] as Vec3) : ([0, 0, 0] as Vec3);
  return applyImpactToBlock({
    toolPrefabId,
    blockId: target.blockId,
    blockKind: target.natureKind,
    label: getNatureSpec(target.natureKind as Parameters<typeof getNatureSpec>[0])?.label ?? labelForKind(target.natureKind),
    point,
    selfId,
  });
}

function gatherFromLiving(
  toolPrefabId: string,
  toolLabel: string,
  color: string,
  mass: number,
  kind: 'tree' | 'hive',
  blockId: string,
): boolean {
  const block = getBuilderBlockEngine().getBlock(blockId);
  if (!block) {
    clearTargetIfBlock(blockId);
    return false;
  }
  const body = getBrainPhysics().getBody(blockId);
  const point = body ? ([body.pos[0], body.pos[1], body.pos[2]] as Vec3) : ([0, 0, 0] as Vec3);
  const up = unitFrom(point);
  const probe = resolveSwingProbe(point, up, color, mass);
  const now = Date.now();

  if (kind === 'tree') {
    const pick = pickFruit(block, now);
    if (!pick.ok) {
      emitTargetImpact(point, up, color, probe.intensity, 'no fruit', false, 'flora');
      const why = pick.reason === 'young'
        ? 'This tree is too young to bear fruit.'
        : pick.reason === 'picked'
          ? 'You picked this tree already. More fruit will grow.'
          : 'The fruit is still green. Come back when it is red.';
      swingProgress(toolPrefabId, toolLabel, why);
      return false;
    }
    emitTargetImpact(point, up, color, probe.intensity, 'collect', true, 'flora');
    recordPlayerHarvest('food', pick.count);
    swingSuccess(toolPrefabId, toolLabel, `Picked ${pick.count} fruit · +${pick.count} Food.`);
    return true;
  }

  if (hiveBuildProgress(block.meta?.builtAt, now) < 1) {
    emitTargetImpact(point, up, color, probe.intensity, 'building', false, 'flora');
    swingProgress(toolPrefabId, toolLabel, 'The bees are still building this hive. No honey yet.');
    return false;
  }
  const honey = collectHoney(block.id, now);
  if (honey <= 0) {
    emitTargetImpact(point, up, color, probe.intensity, 'empty', false, 'flora');
    swingProgress(toolPrefabId, toolLabel, 'You took honey today already. The bees will have more tomorrow.');
    return false;
  }
  emitTargetImpact(point, up, color, probe.intensity, 'collect', true, 'flora');
  recordPlayerHarvest('food', honey);
  swingSuccess(toolPrefabId, toolLabel, `Collected honey · +${honey} Food.`);
  return true;
}

function chopHive(
  toolPrefabId: string,
  toolLabel: string,
  color: string,
  mass: number,
  blockId: string,
  selfId?: string,
): boolean {
  const block = getBuilderBlockEngine().getBlock(blockId);
  if (!block) {
    clearTargetIfBlock(blockId);
    return false;
  }
  const body = getBrainPhysics().getBody(blockId);
  const point = body ? ([body.pos[0], body.pos[1], body.pos[2]] as Vec3) : ([0, 0, 0] as Vec3);
  // Same land rule as any other strike: no breaking things on land you can't alter.
  if (landBlocks(point, selfId)) return false;
  const up = unitFrom(point);
  const probe = resolveSwingProbe(point, up, color, mass);
  const now = Date.now();
  if (hiveBuildProgress(block.meta?.builtAt, now) < 1) {
    emitTargetImpact(point, up, color, probe.intensity, 'building', false, 'flora');
    swingProgress(toolPrefabId, toolLabel, 'The bees are still building this hive.');
    return false;
  }
  emitTargetImpact(point, up, color, probe.intensity, 'break', true, 'flora');
  // Shared with every peer: the comb falls and the colony moves house.
  recordNatureEvent('hive-down', block.bodyId, block.anchorPeerId, block.rightOffset, block.forwardOffset, now);
  clearTargetIfBlock(blockId);
  swingSuccess(toolPrefabId, toolLabel, 'The hive breaks. The bees fly off to build a new one in another tree.');
  return true;
}

/** Earth-local unit direction of a world-space point. */
function localDirFromWorld(point: Vec3): Vec3 {
  const pose = getEarthPose();
  const dx = point[0] - pose.center[0];
  const dy = point[1] - pose.center[1];
  const dz = point[2] - pose.center[2];
  const r = Math.hypot(dx, dy, dz) || 1;
  return quatRotate(pose.invSpinQuat, [dx / r, dy / r, dz / r]);
}

/** Nudge an Earth-local direction sideways by a small tangent distance (m). */
function offsetLocalDir(dir: Vec3, ax: number, az: number): Vec3 {
  const ref: Vec3 = Math.abs(dir[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
  let rx = ref[1] * dir[2] - ref[2] * dir[1];
  let ry = ref[2] * dir[0] - ref[0] * dir[2];
  let rz = ref[0] * dir[1] - ref[1] * dir[0];
  const rn = Math.hypot(rx, ry, rz) || 1;
  rx /= rn; ry /= rn; rz /= rn;
  const fx = dir[1] * rz - dir[2] * ry;
  const fy = dir[2] * rx - dir[0] * rz;
  const fz = dir[0] * ry - dir[1] * rx;
  const s = 1 / EARTH_RADIUS;
  const px = dir[0] + (rx * ax + fx * az) * s;
  const py = dir[1] + (ry * ax + fy * az) * s;
  const pz = dir[2] + (rz * ax + fz * az) * s;
  const n = Math.hypot(px, py, pz) || 1;
  return [px / n, py / n, pz / n];
}

/** Wood pieces a felled tree scatters; each is worth exactly 1 Wood. */
export const WOOD_PER_TREE = 3;
/** Fibre (bark and leaves) a felled tree scatters; each is worth 1 Fibre. */
export const FIBRE_PER_TREE = 2;

/**
 * Chop a tree. Every swing still runs the shared `applyImpact` predicate,
 * so a blunt edge or a heavy curvature load is refused exactly as it is
 * anywhere else. Accepted cuts accumulate: the trunk shakes, and on the
 * final hit it topples, drops wood, and the stump fades away.
 */
async function chopTree(toolPrefabId: string, blockId: string, selfId?: string): Promise<boolean> {
  const toolPrefab = getPrefab(toolPrefabId);
  const tool = getToolAny(toolPrefabId);
  const block = getBuilderBlockEngine().getBlock(blockId);
  if (!toolPrefab || !block) return false;
  // Already falling: its wood is on the way, further swings do nothing.
  if (isTreeFelled(blockId)) {
    clearTargetIfBlock(blockId);
    return false;
  }
  if (!isTreeGrown(block, Date.now())) {
    swingProgress(toolPrefabId, toolPrefab.label, 'This tree is still growing. Let it grow up first.');
    return false;
  }

  const body = getBrainPhysics().getBody(blockId);
  const point: Vec3 = body ? [body.pos[0], body.pos[1], body.pos[2]] : [0, 0, 0];
  if (landBlocks(point, selfId)) return false;

  const up = unitFrom(point);
  const probe = resolveSwingProbe(point, up, toolPrefab.color, tool?.mass ?? toolPrefab.mass);

  if (!tool) {
    emitTargetImpact(point, up, toolPrefab.color, probe.intensity, 'miss', false, 'wood');
    toast.message(toolPrefab.label, { description: 'This tool cannot fell a tree.' });
    return false;
  }

  const swing = applyImpact({
    tool,
    swingEnergy: playerSwingEnergy(tool.mass, probe.intensity),
    curvatureLoad: probe.curvatureLoad,
    target: { kind: 'block', block, bondTerm: bondTermForKind('tree') },
    actorId: selfId,
  });

  emitTargetImpact(
    point,
    up,
    toolPrefab.color,
    probe.intensity,
    swing.cut ? 'chop' : 'resist',
    swing.cut,
    'wood',
  );

  if (!swing.cut) {
    swingResisted(toolPrefabId, toolPrefab.label, 'The trunk');
    return true;
  }

  const state = registerTreeHit(blockId);

  if (state.hits < HITS_TO_FELL) {
    const left = HITS_TO_FELL - state.hits;
    swingProgress(toolPrefabId, toolPrefab.label, `The tree shakes — ${left} more ${left === 1 ? 'swing' : 'swings'}.`);
    return true;
  }

  // Felled. Tell every peer, so the tree comes down (and any hive in it
  // moves) for everyone. Wood lands a moment later, once the trunk is down.
  recordNatureEvent('fell', block.bodyId, block.anchorPeerId, block.rightOffset, block.forwardOffset, state.toppledAt ?? Date.now());
  clearTargetIfBlock(blockId);
  swingSuccess(toolPrefabId, 'Timber!', `The tree comes down · ${WOOD_PER_TREE} wood and ${FIBRE_PER_TREE} fibre to pick up.`);
  const treeDir = localDirFromWorld(point);
  window.setTimeout(() => {
    for (let i = 0; i < WOOD_PER_TREE; i++) {
      const angle = (i / WOOD_PER_TREE) * Math.PI * 2;
      spawnDrop({
        kind: 'wood',
        qty: 1,
        localDir: offsetLocalDir(treeDir, Math.cos(angle) * 1.4, Math.sin(angle) * 1.4),
        upOffset: 0,
      });
    }
    // Bark and leaves fall along the trunk, a little further out.
    for (let i = 0; i < FIBRE_PER_TREE; i++) {
      const angle = ((i + 0.5) / FIBRE_PER_TREE) * Math.PI * 2;
      spawnDrop({
        kind: 'fibre',
        qty: 1,
        localDir: offsetLocalDir(treeDir, Math.cos(angle) * 2.3, Math.sin(angle) * 2.3),
        upOffset: 0,
      });
    }
  }, TOPPLE_MS);
  window.setTimeout(() => {
    try { getBuilderBlockEngine().removeBlock(blockId); } catch { /* already gone */ }
    clearTreeChop(blockId);
  }, TOPPLE_MS + STUMP_FADE_MS);
  return true;
}

/** Loose stone pieces a boulder of `size` (≈0.55..1.05) breaks into. */
export function stoneYieldFor(size: unknown): number {
  const s = typeof size === 'number' && Number.isFinite(size) ? size : 0.8;
  return Math.max(2, Math.min(4, Math.round(1 + s * 2.4)));
}

/**
 * Mine a granite boulder with a pick. Every bite still runs the shared
 * `applyImpact` predicate. Accepted bites accumulate: the boulder jolts
 * and chips smaller, and on the final one it cracks apart, scattering
 * stone drops that the player picks up like wood from a felled tree.
 */
async function mineStone(toolPrefabId: string, blockId: string, selfId?: string): Promise<boolean> {
  const toolPrefab = getPrefab(toolPrefabId);
  const tool = getToolAny(toolPrefabId);
  const block = getBuilderBlockEngine().getBlock(blockId);
  if (!toolPrefab || !block) return false;
  // Already breaking apart: its stone is on the ground, further bites do nothing.
  if (isStoneBroken(blockId)) {
    clearTargetIfBlock(blockId);
    return false;
  }

  const body = getBrainPhysics().getBody(blockId);
  const point: Vec3 = body ? [body.pos[0], body.pos[1], body.pos[2]] : [0, 0, 0];
  if (landBlocks(point, selfId)) return false;

  const up = unitFrom(point);
  const probe = resolveSwingProbe(point, up, toolPrefab.color, tool?.mass ?? toolPrefab.mass);

  if (!tool) {
    emitTargetImpact(point, up, toolPrefab.color, probe.intensity, 'miss', false, 'stone');
    swingProgress(toolPrefabId, toolPrefab.label, 'This tool cannot break stone.');
    return false;
  }

  const swing = applyImpact({
    tool,
    swingEnergy: playerSwingEnergy(tool.mass, probe.intensity),
    curvatureLoad: probe.curvatureLoad,
    target: { kind: 'block', block, bondTerm: bondTermForKind('stone') },
    actorId: selfId,
  });

  emitTargetImpact(
    point,
    up,
    toolPrefab.color,
    probe.intensity,
    swing.cut ? 'mine' : 'resist',
    swing.cut,
    'stone',
  );

  if (!swing.cut) {
    swingResisted(toolPrefabId, toolPrefab.label, 'The stone');
    return true;
  }

  const state = registerStoneHit(blockId);
  if (state.hits < HITS_TO_BREAK) {
    const left = HITS_TO_BREAK - state.hits;
    swingProgress(toolPrefabId, toolPrefab.label, `The stone cracks — ${left} more ${left === 1 ? 'swing' : 'swings'}.`);
    return true;
  }

  // Broken. Stone scatters as the boulder falls apart.
  clearTargetIfBlock(blockId);
  const pieces = stoneYieldFor(block.meta.size);
  swingSuccess(toolPrefabId, toolPrefab.label, `The stone breaks apart · ${pieces} stone to pick up.`);
  const stoneDir = localDirFromWorld(point);
  for (let i = 0; i < pieces; i++) {
    const angle = (i / pieces) * Math.PI * 2;
    spawnDrop({
      kind: 'stone',
      qty: 1,
      localDir: offsetLocalDir(stoneDir, Math.cos(angle) * 1.1, Math.sin(angle) * 1.1),
      upOffset: 0,
    });
  }
  window.setTimeout(() => {
    try { getBuilderBlockEngine().removeBlock(blockId); } catch { /* already gone */ }
    clearStoneMine(blockId);
  }, BREAK_MS);
  return true;
}

/**
 * Mine a rock face. Same shared `applyImpact` predicate as every other
 * swing — a blunt head or a heavy curvature load is refused identically.
 * An accepted bite chips stone loose onto the ground; the rock itself
 * stays standing.
 */
async function mineRock(
  toolPrefabId: string,
  blockId: string,
  kind: string,
  selfId?: string,
): Promise<boolean> {
  const toolPrefab = getPrefab(toolPrefabId);
  const tool = getToolAny(toolPrefabId);
  const block = getBuilderBlockEngine().getBlock(blockId);
  if (!toolPrefab || !block) return false;

  const body = getBrainPhysics().getBody(blockId);
  const point: Vec3 = body ? [body.pos[0], body.pos[1], body.pos[2]] : [0, 0, 0];
  if (landBlocks(point, selfId)) return false;

  const up = unitFrom(point);
  const probe = resolveSwingProbe(point, up, toolPrefab.color, tool?.mass ?? toolPrefab.mass);

  if (!tool) {
    emitTargetImpact(point, up, toolPrefab.color, probe.intensity, 'miss', false, 'stone');
    toast.message(toolPrefab.label, { description: 'This tool cannot break rock.' });
    return false;
  }

  const swing = applyImpact({
    tool,
    swingEnergy: playerSwingEnergy(tool.mass, probe.intensity),
    curvatureLoad: probe.curvatureLoad,
    target: { kind: 'block', block, bondTerm: bondTermForKind(kind) },
    actorId: selfId,
  });

  emitTargetImpact(
    point,
    up,
    toolPrefab.color,
    probe.intensity,
    swing.cut ? 'mine' : 'resist',
    swing.cut,
    'stone',
  );

  if (!swing.cut) {
    swingResisted(toolPrefabId, toolPrefab.label, 'The rock');
    return true;
  }

  const rockDir = localDirFromWorld(point);
  spawnDrop({
    kind: 'stone',
    qty: 1,
    localDir: offsetLocalDir(rockDir, (Math.random() - 0.5) * 2.2, (Math.random() - 0.5) * 2.2),
    upOffset: 0,
  });
  swingSuccess(toolPrefabId, toolPrefab.label, 'Stone chips loose.');
  return true;
}



/**
 * Dig one step into the Earth shells at a ground cell.
 *
 * Goes through the SAME `applyImpact` predicate as every other cut, so
 * shell density / bond / local curvature (now including weather load)
 * decide whether the spade bites. A successful cut deepens the pit and
 * publishes `cell-carved` for the renderer + persistence layers.
 */
async function digShell(
  toolPrefabId: string,
  target: Extract<ToolTarget, { kind: 'shell' }>,
  selfId?: string,
): Promise<boolean> {
  const prefab = getPrefab(toolPrefabId);
  const tool = getToolAny(toolPrefabId);
  if (!prefab) return false;
  if (landBlocks(target.point, selfId)) return false;

  const up = unitFrom(target.point);
  const probe = resolveSwingProbe(target.point, up, prefab.color, prefab.mass);

  if (!tool) {
    emitTargetImpact(target.point, up, prefab.color, probe.intensity, 'miss', false, 'soil');
    toast.message(prefab.label, { description: 'This tool cannot break ground.' });
    return false;
  }

  const shell = shellAtDepth(target.depth);
  if (!shell) {
    toast.message(prefab.label, { description: 'The ground here will not yield further.' });
    return false;
  }

  const material = materialForShell(shell.id);
  const swing = applyImpact({
    tool,
    swingEnergy: playerSwingEnergy(tool.mass, probe.intensity),
    // Storms load the field: digging in rain is measurably harder.
    curvatureLoad: probe.curvatureLoad + weatherCurvatureBoost(target.localNormal),
    target: {
      kind: 'shell',
      shell,
      rFrac: 1 - target.depth / EARTH_RADIUS,
      cellKey: target.cellKey,
    },
    actorId: selfId,
  });

  emitTargetImpact(
    target.point,
    up,
    prefab.color,
    probe.intensity,
    swing.cut ? shell.label : (swing.reason === 'sharpness_below_threshold' ? 'too dull' : 'resist'),
    swing.cut,
    material,
  );

  if (!swing.cut) {
    const hint = swing.reason === 'lava_burns_tool'
      ? 'lava burns the tool'
      : swing.reason === 'sharpness_below_threshold'
        ? `needs a sharper edge (≥ ${shell.sharpnessThreshold.toFixed(2)})`
        : swing.reason === 'wrong_action_kind'
          ? `${prefab.label} is the wrong tool`
          : undefined;
    swingResisted(toolPrefabId, prefab.label, shell.label, hint);
    return true;
  }

  const carved = carveCell(target.localNormal, DIG_STEP_M * Math.min(2, swing.effectiveCut));
  if (!carved) {
    toast.message(prefab.label, { description: 'This pit has reached its floor.' });
    return true;
  }

  emitCellCarved({ cellKey: carved.cellKey, shellId: carved.shellId, swing });

  const floor = shellAtDepth(carved.depth);

  // Keep the target live so repeated swings deepen the same pit.
  setToolTarget({
    ...target,
    depth: carved.depth,
    shellId: carved.shellId,
    label: `${floor?.label ?? 'Bedrock'} (n=${floor?.n ?? shell.n})`,
  });
  return true;
}



export async function swingToolInAir(toolPrefabId: string, selfId?: string): Promise<boolean> {
  const prefab = getPrefab(toolPrefabId);
  if (!prefab) return false;
  if (await knifeAtShark(toolPrefabId, selfId)) return true;
  const reach = toolPrefabId.startsWith('tool_knife') ? 0.95 : toolPrefabId.startsWith('tool_bucket') ? 1.45 : 1.25;
  const swing = pointInFrontOfSelf(selfId, reach);
  if (!swing) {
    return true;
  }
  const probe = resolveSwingProbe(swing.point, swing.up, prefab.color, prefab.mass);
  emitTargetImpact(swing.point, swing.up, prefab.color, probe.intensity, 'air', false);
  return true;
}

export async function swingToolBackIntoWorld(toolPrefabId: string, selfId?: string): Promise<boolean> {
  const ok = await swingToolInAir(toolPrefabId, selfId);
  if (!ok) return false;
  return true;
}

/**
 * Put the held tool down on the ground just in front of the player, as a
 * new placement (fresh id, so it never collides with the tombstone left
 * when it was picked up). Village NPCs can then come and collect it (see
 * npc/npcTools). Tools equipped straight from the bar carry no real spot
 * of their own, so the player's position is the only sensible place.
 * Falls back to the original spot when the player has no body yet.
 */
export async function dropHeldToolOnGround(
  held: { prefabId: string; source: PlacementRecord },
  selfId?: string,
): Promise<PlacementRecord> {
  const spot = pointInFrontOfSelf(selfId, 0.7);
  if (spot) {
    const now = Date.now();
    const handle = placePrefabAtHit({
      hitPoint: spot.point,
      prefabId: held.prefabId,
      actorId: selfId ?? held.source.actorId,
      yaw: held.source.yaw ?? 0,
      noLabour: true,
      placementId: `drop:${held.prefabId}:${now.toString(36)}:${Math.floor(Math.random() * 1e6).toString(36)}`,
    });
    if (handle) return recordLocalPlacement(handle);
  }
  return recordLocalPlacement({ ...held.source, createdAt: Date.now() });
}

export async function consumeHeldToolDrop(target: PlacementRecord): Promise<void> {
  await removeLocalPlacement(target.placementId);
}