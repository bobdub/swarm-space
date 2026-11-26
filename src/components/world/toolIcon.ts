/**
 * toolIcon — maps a held tool to the icon shown on its Use button, so the
 * HUD shows an axe for the axe, a pick for the pick, and so on. Anything
 * without a known action (or a non-tool prefab) falls back to the hammer.
 */
import { Axe, Flag, Hammer, Pickaxe, Shovel, Slice, Wheat, type LucideIcon } from 'lucide-react';
import { getToolAny, type ToolActionKind } from '@/lib/brain/toolCatalog';

const ACTION_ICONS: Record<ToolActionKind, LucideIcon> = {
  whittle: Slice,
  chop: Axe,
  dig: Shovel,
  mine: Pickaxe,
  gather: Wheat,
  claim: Flag,
};

export function toolIconFor(prefabId: string): LucideIcon {
  const kind = getToolAny(prefabId)?.actionKind;
  return (kind && ACTION_ICONS[kind]) || Hammer;
}
