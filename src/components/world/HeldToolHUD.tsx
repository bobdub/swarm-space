/**
 * HeldToolHUD — bottom-right floating chip showing the tool currently
 * held in the player's hand. Exposes:
 *   • Use   — applies the tool's verb to the currently selected
 *             placement (selectedBlockId in builder state).
 *   • Drop  — re-places the tool back into the world at its original
 *             hit point and clears the hand slot.
 *
 * Pure UI seam; physics + verb logic live in `toolActions.ts`.
 */
import { useEffect, useState } from 'react';
import { Hand, X, Hammer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  getHeldTool,
  setHeldTool,
  subscribeHeldTool,
  type HeldTool,
} from '@/lib/world/heldToolStore';
import { getPrefab } from '@/lib/brain/prefabHouseCatalog';
import { recordLocalPlacement } from '@/lib/world/worldPlacementsStore';
import { applyToolToTarget } from '@/lib/world/toolActions';
import { toast } from 'sonner';
import { getToolTarget, setToolTarget, subscribeToolTarget } from '@/lib/world/toolTargetStore';
import type { ToolTarget } from '@/lib/world/toolTargets';

interface HeldToolHUDProps {
  selectedPlacementId: string | null;
}

export function HeldToolHUD({ selectedPlacementId }: HeldToolHUDProps) {
  const [held, setHeld] = useState<HeldTool | null>(() => getHeldTool());
  const [target, setTarget] = useState<ToolTarget | null>(() => getToolTarget());
  useEffect(() => subscribeHeldTool(setHeld), []);
  useEffect(() => subscribeToolTarget(setTarget), []);

  if (!held) return null;
  const prefab = getPrefab(held.prefabId);
  if (!prefab) return null;

  const onUse = async () => {
    if (!target) {
      toast.message(prefab.label, {
        description: 'Tap something in the world first to target it.',
      });
      return;
    }
    await applyToolToTarget(held.prefabId, target);
  };

  const onDrop = async () => {
    // Re-place at original hit point so the tool comes back into the world.
    await recordLocalPlacement({
      ...held.source,
      createdAt: Date.now(),
    });
    setHeldTool(null);
    setToolTarget(null);
    toast.message(prefab.label, { description: 'Dropped.' });
  };

  return (
    <div
      role="form"
      aria-label="Held tool"
      className="pointer-events-auto absolute bottom-[max(env(safe-area-inset-bottom),96px)] right-3 z-30 flex items-center gap-2 rounded-full border border-primary/40 bg-background/90 px-2 py-1.5 shadow-lg backdrop-blur"
    >
      <span
        className="flex h-7 w-7 items-center justify-center rounded-full border border-border/50"
        style={{ backgroundColor: prefab.color }}
        aria-hidden="true"
      >
        <Hand className="h-3.5 w-3.5 text-foreground/80" />
      </span>
      <span className="text-[11px] font-medium text-foreground/90 max-w-[100px] truncate">
        {prefab.label}
      </span>
      <span className="max-w-[110px] truncate text-[10px] text-foreground/60">
        {target ? target.label : selectedPlacementId ? 'Target locked' : 'No target'}
      </span>
      <Button
        type="button"
        size="sm"
        variant="default"
        onClick={onUse}
        className="h-7 gap-1 px-2 text-[11px]"
      >
        <Hammer className="h-3.5 w-3.5" />
        Use
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={onDrop}
        className="h-7 w-7"
        aria-label="Drop tool"
        title="Drop tool"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export default HeldToolHUD;