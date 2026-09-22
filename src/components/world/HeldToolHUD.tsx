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
  selfId?: string;
}

export function HeldToolHUD({ selectedPlacementId, selfId }: HeldToolHUDProps) {
  const [held, setHeld] = useState<HeldTool | null>(() => getHeldTool());
  const [target, setTarget] = useState<ToolTarget | null>(() => getToolTarget());
  useEffect(() => subscribeHeldTool(setHeld), []);
  useEffect(() => subscribeToolTarget(setTarget), []);

  if (!held) return null;
  const prefab = getPrefab(held.prefabId);
  if (!prefab) return null;

  const onUse = async () => {
    // Null target → swing in the air in front of the user. selfId lets
    // toolActions probe the UQRC field at the player's forward swing point.
    await applyToolToTarget(held.prefabId, target, selfId);
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
      title={`${prefab.label} — ${target ? target.label : 'swing'}`}
      className="pointer-events-auto absolute right-2 top-1/2 z-30 flex -translate-y-1/2 flex-col items-center gap-1 rounded-full border border-primary/40 bg-background/80 p-1 shadow-md backdrop-blur"
    >
      <Button
        type="button"
        size="icon"
        variant="default"
        onClick={onUse}
        className="h-9 w-9 rounded-full"
        aria-label={`Use ${prefab.label}`}
        title={`Use ${prefab.label}`}
      >
        <Hammer className="h-4 w-4" />
      </Button>
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full border border-border/50"
        style={{ backgroundColor: prefab.color }}
        aria-hidden="true"
      >
        <Hand className="h-3 w-3 text-foreground/80" />
      </span>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={onDrop}
        className="h-6 w-6"
        aria-label={`Drop ${prefab.label}`}
        title="Drop tool"
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

export default HeldToolHUD;