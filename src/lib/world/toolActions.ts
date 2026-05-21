import { toast } from 'sonner';
import { getBuilderBlockEngine } from '@/lib/brain/builderBlockEngine';
import { getPrefab } from '@/lib/brain/prefabHouseCatalog';
import { getToolAny } from '@/lib/brain/toolCatalog';
import { applyImpact } from '@/lib/brain/sculpting';
import { sampleSurfaceClass } from '@/lib/brain/surfaceClass';
import { getNatureSpec } from '@/lib/brain/nature/natureCatalog';
import type { Vec3 } from '@/lib/brain/earth';
import { removeLocalPlacement, type PlacementRecord } from '@/lib/world/worldPlacementsStore';
import type { ToolTarget } from '@/lib/world/toolTargets';
import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';
import { emitImpactFx, emitSwingFx } from '@/lib/world/swingFxBus';

export type ToolVerb = 'chop' | 'whittle' | 'dig' | 'gather' | 'sharpen' | 'none';

function verbFor(toolPrefabId: string): ToolVerb {
  if (toolPrefabId.startsWith('tool_axe')) return 'chop';
  if (toolPrefabId.startsWith('tool_knife')) return 'whittle';
  if (toolPrefabId.startsWith('tool_shovel')) return 'dig';
  if (toolPrefabId.startsWith('tool_bucket')) return 'gather';
  if (toolPrefabId.startsWith('consumable_salt')) return 'sharpen';
  return 'none';
}

function unitFrom(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
}

function labelForKind(kind: string): string {
  return kind.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function bondTermForKind(kind: string): number {
  if (/tree|wood|trunk|log|root/.test(kind)) return 0.42;
  if (/stone|rock|mountain|foundation/.test(kind)) return 0.88;
  if (/grass|flower|fish|water/.test(kind)) return 0.18;
  return 0.55;
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
    radius: Math.max(0.42, Math.cbrt(toolMass) * 0.72),
    intensity: probe.intensity,
  });
  return probe;
}

function emitTargetImpact(point: Vec3, up: Vec3, color: string, intensity: number, label: string, success: boolean) {
  emitImpactFx({
    point,
    up,
    color,
    radius: Math.max(0.28, 0.24 + intensity * 1.4),
    intensity,
    label,
    success,
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

  if (!tool) {
    toast.message(toolPrefab.label, { description: 'This tool does not yet resolve through sculpting.' });
    return false;
  }

  const up = unitFrom(point);
  const probe = resolveSwingProbe(point, up, toolPrefab.color, tool.mass);
  const swing = applyImpact({
    tool,
    swingEnergy: Math.max(0.2, tool.mass * (0.3 + probe.intensity * 8)),
    curvatureLoad: probe.curvatureLoad,
    target: {
      kind: 'block',
      block,
      bondTerm: bondTermForKind(blockKind),
    },
    actorId: selfId,
  });

  emitTargetImpact(point, up, toolPrefab.color, probe.intensity, swing.cut ? 'cut' : 'resist', swing.cut);

  if (!swing.cut) {
    toast.message(toolPrefab.label, {
      description: `${label} resisted the strike (${swing.effectiveCut.toFixed(2)}).`,
    });
    return true;
  }

  const durability = typeof block.meta.durability === 'number' ? (block.meta.durability as number) : 1;
  const next = Math.max(0, durability - Math.min(1, swing.effectiveCut * 0.35));
  if (next <= 0) {
    getBuilderBlockEngine().removeBlock(block.bodyId);
    toast.success(toolPrefab.label, { description: `${label} yielded.` });
  } else {
    getBuilderBlockEngine().upgradeBlock(block.bodyId, { meta: { ...block.meta, durability: next } });
    toast.message(toolPrefab.label, { description: `${label} ${(next * 100).toFixed(0)}% intact.` });
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

export async function applyToolToTarget(toolPrefabId: string, target: ToolTarget | null, selfId?: string): Promise<boolean> {
  if (!target) return swingToolInAir(toolPrefabId, selfId);
  if (target.kind === 'placement') return applyToolToPlacement(toolPrefabId, target.placement, selfId);

  const verb = verbFor(toolPrefabId);
  const prefab = getPrefab(toolPrefabId);
  if (!prefab || verb === 'none') return false;

  if (target.kind === 'surface') {
    const up = unitFrom(target.point);
    const probe = resolveSwingProbe(target.point, up, prefab.color, prefab.mass);
    const ok = verb === 'gather' && target.surfaceKind === 'water' && isSurfaceGatherable(target.point);
    emitTargetImpact(target.point, up, prefab.color, probe.intensity, ok ? 'collect' : 'miss', ok);
    if (!ok) {
      toast.message(prefab.label, { description: 'No gatherable water at this impact point.' });
      return false;
    }
    toast.success(prefab.label, { description: 'Collected water.' });
    return true;
  }

  if (verb === 'gather' && (target.natureKind === 'flower' || target.natureKind === 'grass' || target.natureKind === 'fish' || target.natureKind === 'water')) {
    const body = getBrainPhysics().getBody(target.blockId);
    const point = body ? ([body.pos[0], body.pos[1], body.pos[2]] as Vec3) : ([0, 0, 0] as Vec3);
    const up = unitFrom(point);
    const probe = resolveSwingProbe(point, up, prefab.color, prefab.mass);
    emitTargetImpact(point, up, prefab.color, probe.intensity, 'collect', true);
    getBuilderBlockEngine().removeBlock(target.blockId);
    toast.success(prefab.label, { description: `Collected ${labelForKind(target.natureKind).toLowerCase()}.` });
    return true;
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

export async function swingToolInAir(toolPrefabId: string, selfId?: string): Promise<boolean> {
  const prefab = getPrefab(toolPrefabId);
  if (!prefab) return false;
  const reach = toolPrefabId.startsWith('tool_knife') ? 0.95 : toolPrefabId.startsWith('tool_bucket') ? 1.45 : 1.25;
  const swing = pointInFrontOfSelf(selfId, reach);
  if (!swing) {
    toast.message(prefab.label, { description: 'Swing registered.' });
    return true;
  }
  const probe = resolveSwingProbe(swing.point, swing.up, prefab.color, prefab.mass);
  emitTargetImpact(swing.point, swing.up, prefab.color, probe.intensity, 'air', false);
  toast.message(prefab.label, { description: `Swing through air (|𝒞_collide| ${probe.intensity.toFixed(3)}).` });
  return true;
}

export async function swingToolBackIntoWorld(toolPrefabId: string, selfId?: string): Promise<boolean> {
  const ok = await swingToolInAir(toolPrefabId, selfId);
  if (!ok) return false;
  return true;
}

export async function consumeHeldToolDrop(target: PlacementRecord): Promise<void> {
  await removeLocalPlacement(target.placementId);
}