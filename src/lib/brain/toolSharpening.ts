/**
 * Tool sharpening — salt-rock honing pass.
 *
 * Pure logic; no field, no React. Consumed by a future input handler that
 * lets a User drag a `salt_rock` consumable onto a placed tool block.
 * NPCs invoke the same path through their `craft` drive.
 */

import { getBuilderBlockEngine } from './builderBlockEngine';

/** Maximum sharpness any tool can hold. */
export const SHARPNESS_MAX = 1.0;

/** Diminishing-returns gain per honing pass. */
const SHARPEN_GAIN = 0.18;

/** Wear when a tool is used against resistance r (0..1). */
export function sharpnessWearFor(resistance01: number): number {
  // Soft wear: a brand-new tool loses ~2% on a soft target, ~10% on hard.
  return Math.max(0.005, Math.min(0.12, 0.02 + resistance01 * 0.10));
}

/**
 * Hone `toolBlockId` by consuming `saltBlockId`. Returns the new sharpness
 * value, or `null` if either block is missing or the salt is the wrong kind.
 */
export function sharpenTool(toolBlockId: string, saltBlockId: string): number | null {
  const engine = getBuilderBlockEngine();
  const tool = engine.getBlock(toolBlockId);
  const salt = engine.getBlock(saltBlockId);
  if (!tool || !salt) return null;
  if (!salt.kind.startsWith('consumable_salt')) return null;

  const current = typeof tool.meta.sharpness === 'number'
    ? (tool.meta.sharpness as number)
    : 0.5;
  const next = Math.min(SHARPNESS_MAX, current + (SHARPNESS_MAX - current) * SHARPEN_GAIN);

  engine.upgradeBlock(tool.id, { meta: { ...tool.meta, sharpness: next } });
  engine.removeBlock(salt.id);
  return next;
}

/** Apply wear to a tool after a single use. Returns the new sharpness. */
export function applyToolWear(toolBlockId: string, resistance01: number): number | null {
  const engine = getBuilderBlockEngine();
  const tool = engine.getBlock(toolBlockId);
  if (!tool) return null;
  const current = typeof tool.meta.sharpness === 'number'
    ? (tool.meta.sharpness as number)
    : 0.5;
  const next = Math.max(0, current - sharpnessWearFor(resistance01));
  engine.upgradeBlock(tool.id, { meta: { ...tool.meta, sharpness: next } });
  return next;
}