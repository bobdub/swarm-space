/**
 * HeldToolHUD — bottom-right floating chip showing the tool currently
 * held in the player's hand. Exposes:
 *   • Use   — applies the tool's verb to the currently selected
 *             placement (selectedBlockId in builder state).
 *   • Drop  — puts the tool down in front of the player and clears the
 *             hand slot. A village NPC without that kind of tool may
 *             walk over and collect it.
 *
 * Pure UI seam; physics + verb logic live in `toolActions.ts`.
 */
import { useEffect, useState } from 'react';
import { Hand, X, Flag } from 'lucide-react';
import { toolIconFor } from '@/components/world/toolIcon';
import { Button } from '@/components/ui/button';
import {
  getHeldTool,
  setHeldTool,
  subscribeHeldTool,
  type HeldTool,
} from '@/lib/world/heldToolStore';
import { getPrefab } from '@/lib/brain/prefabHouseCatalog';
import { applyToolToTarget, dropHeldToolOnGround } from '@/lib/world/toolActions';
import { getToolTarget, setToolTarget, subscribeToolTarget } from '@/lib/world/toolTargetStore';
import type { ToolTarget } from '@/lib/world/toolTargets';
import {
  BLOCK_PRICE_SWARM,
  blockStatus,
  isBoundaryMarker,
  setMarkerHold,
  subscribeMarkerHold,
  type MarkerHoldState,
} from '@/lib/world/boundaryMarker';

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
  if (isBoundaryMarker(held.prefabId)) {
    return <BoundaryMarkerHUD selfId={selfId} label={prefab.label} color={prefab.color} />;
  }

  const ToolIcon = toolIconFor(held.prefabId);

  const onUse = async () => {
    // Null target → swing in the air in front of the user. selfId lets
    // toolActions probe the UQRC field at the player's forward swing point.
    await applyToolToTarget(held.prefabId, target, selfId);
  };

  const onDrop = async () => {
    // Put it down at the player's feet; village NPCs may come for it.
    await dropHeldToolOnGround(held, selfId);
    setHeldTool(null);
    setToolTarget(null);
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
        <ToolIcon className="h-4 w-4" aria-hidden="true" data-testid="held-tool-icon" />
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

const STATUS_TEXT = {
  free: `Hold to claim · ${BLOCK_PRICE_SWARM} SWARM`,
  own: 'Your block',
  foreign: "Another player's block",
  commons: 'Communal land',
  water: "Water can't be claimed",
} as const;

/**
 * Boundary marker chip: shows what the targeted block is and offers a
 * hold-to-claim button for the block in front of the player (touch and
 * gamepad players). Pointer players can also press and hold the block
 * itself in the world (BoundaryMarkerLayer).
 */
function BoundaryMarkerHUD({ selfId, label, color }: { selfId?: string; label: string; color: string }) {
  const [hold, setHold] = useState<MarkerHoldState | null>(null);
  useEffect(() => subscribeMarkerHold(setHold), []);
  useEffect(() => () => setMarkerHold({ hudPressed: false }), []);

  const status = hold?.target && selfId ? blockStatus(hold.target.cx, hold.target.cz, selfId).status : null;
  const text = hold?.busy
    ? 'Claiming…'
    : status
      ? STATUS_TEXT[status]
      : 'Point at a block';
  const pct = Math.round((hold?.progress ?? 0) * 100);
  const press = (down: boolean) => setMarkerHold({ hudPressed: down });

  const onDrop = () => {
    setMarkerHold({ hudPressed: false });
    setHeldTool(null);
    setToolTarget(null);
  };

  return (
    <div
      role="form"
      aria-label="Boundary marker"
      data-testid="boundary-marker-hud"
      className="pointer-events-auto absolute right-2 top-1/2 z-30 flex -translate-y-1/2 flex-col items-center gap-1 rounded-2xl border border-primary/40 bg-background/80 p-1.5 shadow-md backdrop-blur"
    >
      <button
        type="button"
        aria-label={`Hold to claim this block with the ${label}`}
        title="Press and hold to claim the highlighted block"
        data-testid="boundary-marker-hold"
        disabled={hold?.busy || status !== 'free'}
        onPointerDown={(e) => { e.preventDefault(); press(true); }}
        onPointerUp={() => press(false)}
        onPointerLeave={() => press(false)}
        onPointerCancel={() => press(false)}
        onContextMenu={(e) => e.preventDefault()}
        className="relative flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
        style={{
          touchAction: 'none',
          background: pct > 0
            ? `conic-gradient(#22c55e ${pct * 3.6}deg, hsl(var(--primary)) 0deg)`
            : undefined,
        }}
      >
        <Flag className="h-4 w-4" />
      </button>
      <span className="max-w-[92px] text-center text-[10px] leading-tight text-foreground/90" data-testid="boundary-marker-status">
        {text}
      </span>
      <span
        className="flex h-5 w-5 items-center justify-center rounded-full border border-border/50"
        style={{ backgroundColor: color }}
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
        aria-label={`Put away ${label}`}
        title="Put away"
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}

export default HeldToolHUD;