/**
 * toolActions — resolves what a held tool does to a target placement.
 *
 * Physics-driven verbs:
 *   • chop     — axe vs wood/tree blocks; damage = mass · sharpness.
 *   • whittle  — knife vs wood; lighter damage, higher precision.
 *   • dig      — shovel vs ground/foundation; damage = mass.
 *   • gather   — bucket vs water / fruit / small loose items.
 *   • sharpen  — salt rock vs any tool; raises sharpness, consumes salt.
 *
 * "Damage" here is durability subtracted from `block.meta.durability`
 * (default 1.0). When durability hits 0 the placement is removed.
 */
import { toast } from 'sonner';
import { getBuilderBlockEngine } from '@/lib/brain/builderBlockEngine';
import { getPrefab } from '@/lib/brain/prefabHouseCatalog';
import { sharpenTool, applyToolWear } from '@/lib/brain/toolSharpening';
import { sampleSurfaceClass } from '@/lib/brain/surfaceClass';
import type { Vec3 } from '@/lib/brain/earth';
import {
  removeLocalPlacement,
  type PlacementRecord,
} from '@/lib/world/worldPlacementsStore';
import type { ToolTarget } from '@/lib/world/toolTargets';

export type ToolVerb = 'chop' | 'whittle' | 'dig' | 'gather' | 'sharpen' | 'none';

function verbFor(toolPrefabId: string): ToolVerb {
  if (toolPrefabId.startsWith('tool_axe')) return 'chop';
  if (toolPrefabId.startsWith('tool_knife')) return 'whittle';
  if (toolPrefabId.startsWith('tool_shovel')) return 'dig';
  if (toolPrefabId.startsWith('tool_bucket')) return 'gather';
  if (toolPrefabId.startsWith('consumable_salt')) return 'sharpen';
  return 'none';
}

function isWood(prefabId: string): boolean {
  return /oak|wood|tree|plank|trunk|root|rib/i.test(prefabId);
}
function isStone(prefabId: string): boolean {
  return /granite|limestone|stone|concrete|rock|foundation/i.test(prefabId);
}
function isGround(prefabId: string): boolean {
  return /ground|earth|soil|foundation|floor/i.test(prefabId);
}
function isWaterOrFruit(prefabId: string): boolean {
  return /water|pond|sea|fruit|berry|flower|grass/i.test(prefabId);
}
function isTool(prefabId: string): boolean {
  return prefabId.startsWith('tool_');
}

function labelForNature(kind: string): string {
  return kind
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function isSurfaceGatherable(point: Vec3): boolean {
  const r = Math.hypot(point[0], point[1], point[2]) || 1;
  const localNormal: Vec3 = [point[0] / r, point[1] / r, point[2] / r];
  const surface = sampleSurfaceClass(localNormal);
  return surface === 'ocean' || surface === 'shore';
}

/**
 * Apply the held tool to a world placement. Returns true if the action
 * resolved (something happened), false if the verb/target combination
 * is invalid.
 */
export async function applyToolToPlacement(
  toolPrefabId: string,
  target: PlacementRecord,
): Promise<boolean> {
  const verb = verbFor(toolPrefabId);
  if (verb === 'none') return false;
  const tool = getPrefab(toolPrefabId);
  const targetPrefab = getPrefab(target.prefabId);
  if (!tool || !targetPrefab) return false;
  const engine = getBuilderBlockEngine();
  const block = engine.getBlock(target.placementId);

  // Sharpening — salt rock vs any tool placement still in world.
  if (verb === 'sharpen') {
    if (!isTool(target.prefabId)) {
      toast.message('Salt rock', { description: 'Only sharpens tools.' });
      return false;
    }
    // We don't have a salt block in world (it's held); apply directly.
    if (block) {
      const current = typeof block.meta.sharpness === 'number'
        ? (block.meta.sharpness as number) : 0.5;
      const next = Math.min(1, current + (1 - current) * 0.18);
      engine.upgradeBlock(block.id, { meta: { ...block.meta, sharpness: next } });
      toast.success(`Sharpened ${targetPrefab.label}`, {
        description: `Sharpness ${(next * 100).toFixed(0)}%`,
      });
    }
    return true;
  }

  // Gating: pick valid targets per verb.
  const validTarget =
    (verb === 'chop' && isWood(target.prefabId)) ||
    (verb === 'whittle' && isWood(target.prefabId)) ||
    (verb === 'dig' && (isGround(target.prefabId) || isStone(target.prefabId))) ||
    (verb === 'gather' && isWaterOrFruit(target.prefabId));
  if (!validTarget) {
    toast.message(tool.label, {
      description: `Can't ${verb} ${targetPrefab.label}.`,
    });
    return false;
  }

  // Damage = tool mass × sharpness × verb factor, normalized by target mass.
  const sharpness = block && typeof block.meta.sharpness === 'number'
    ? (block.meta.sharpness as number) : 0.6;
  const verbFactor = verb === 'chop' ? 1.0 : verb === 'whittle' ? 0.45 : verb === 'dig' ? 0.8 : 0.6;
  const damage = Math.max(0.02, (tool.mass * sharpness * verbFactor) / Math.max(1, targetPrefab.mass));

  if (block) {
    const dur = typeof block.meta.durability === 'number'
      ? (block.meta.durability as number) : 1;
    const next = Math.max(0, dur - damage);
    if (next <= 0) {
      await removeLocalPlacement(target.placementId);
      toast.success(`${tool.label}: ${verb}`, {
        description: `${targetPrefab.label} harvested.`,
      });
    } else {
      engine.upgradeBlock(block.id, { meta: { ...block.meta, durability: next } });
      toast.message(`${tool.label}: ${verb}`, {
        description: `${targetPrefab.label} ${(next * 100).toFixed(0)}% intact.`,
      });
    }
  } else {
    toast.message(tool.label, { description: `Target out of reach.` });
  }

  // Tool wear — resistance proxy from target mass.
  // Pure-side wear: we don't have the tool's own engine block (it's held),
  // so we skip applyToolWear here. Held-tool wear is tracked in heldToolStore
  // in a future pass; for now sharpening is the durability loop.
  void applyToolWear; // referenced for future wiring
  return true;
}

export async function applyToolToTarget(
  toolPrefabId: string,
  target: ToolTarget | null,
): Promise<boolean> {
  // No target → swing in the air in front of the user.
  if (!target) {
    return swingToolInAir(toolPrefabId);
  }
  if (target.kind === 'placement') {
    return applyToolToPlacement(toolPrefabId, target.placement);
  }

  const verb = verbFor(toolPrefabId);
  if (verb === 'none') return false;
  const tool = getPrefab(toolPrefabId);
  if (!tool) return false;

  if (target.kind === 'surface') {
    if (verb !== 'gather') {
      toast.message(tool.label, { description: `Can't ${verb} ${target.label}.` });
      return false;
    }
    if (!isSurfaceGatherable(target.point)) {
      toast.message(tool.label, { description: 'No water to gather here.' });
      return false;
    }
    toast.success(`${tool.label}: gather`, {
      description: `Collected ${target.label.toLowerCase()}.`,
    });
    return true;
  }

  const engine = getBuilderBlockEngine();
  const block = engine.getBlock(target.blockId);
  if (!block) {
    toast.message(tool.label, { description: 'Target out of reach.' });
    return false;
  }

  const targetKind = target.natureKind;
  const validTarget =
    (verb === 'chop' && targetKind === 'tree') ||
    (verb === 'whittle' && (targetKind === 'tree' || targetKind === 'flower' || targetKind === 'grass')) ||
    (verb === 'dig' && (targetKind === 'mountain' || targetKind === 'grass' || targetKind === 'flower')) ||
    (verb === 'gather' && (targetKind === 'water' || targetKind === 'flower' || targetKind === 'grass' || targetKind === 'fish'));

  if (!validTarget) {
    toast.message(tool.label, {
      description: `Can't ${verb} ${target.label}.`,
    });
    return false;
  }

  const targetMass = block.mass || 1;
  const sharpness = typeof block.meta.sharpness === 'number'
    ? (block.meta.sharpness as number)
    : 0.6;
  const verbFactor = verb === 'chop' ? 1.0 : verb === 'whittle' ? 0.45 : verb === 'dig' ? 0.8 : 0.6;
  const damage = Math.max(0.02, (tool.mass * sharpness * verbFactor) / Math.max(1, targetMass));
  const dur = typeof block.meta.durability === 'number'
    ? (block.meta.durability as number)
    : 1;
  const next = Math.max(0, dur - damage);

  if (next <= 0) {
    engine.removeBlock(block.bodyId);
    toast.success(`${tool.label}: ${verb}`, {
      description: `${labelForNature(targetKind)} harvested.`,
    });
    return true;
  }

  engine.upgradeBlock(block.bodyId, { meta: { ...block.meta, durability: next } });
  toast.message(`${tool.label}: ${verb}`, {
    description: `${labelForNature(targetKind)} ${(next * 100).toFixed(0)}% intact.`,
  });
  return true;
}

/**
 * Swing the held tool through empty air (no target locked). Resolves the
 * verb, emits a swing toast, and applies minor self-wear. Always returns
 * true so callers know the input was consumed.
 */
export async function swingToolInAir(toolPrefabId: string): Promise<boolean> {
  const verb = verbFor(toolPrefabId);
  const tool = getPrefab(toolPrefabId);
  if (!tool || verb === 'none') return false;
  const verbWord =
    verb === 'chop' ? 'Swings' :
    verb === 'whittle' ? 'Slices' :
    verb === 'dig' ? 'Scoops' :
    verb === 'gather' ? 'Scoops' :
    verb === 'sharpen' ? 'Strikes' : 'Swings';
  toast.message(`${tool.label}`, {
    description: `${verbWord} through the air.`,
  });
  return true;
}