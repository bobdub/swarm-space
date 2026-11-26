/**
 * Mesh ⇄ Cell switcher for the wifi status popover.
 *
 * With no cells it falls back to the read-only mode chip. Once the user has
 * created or joined a cell, it offers a one-click switch between the main
 * mesh and a cell, a cell picker when there are several, and the selected
 * cell's invite link.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link2, Loader2, Share2, Users, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { NetworkModeToggle } from '@/components/NetworkModeToggle';
import { subscribeToConnectionState, type NetworkMode } from '@/lib/p2p/connectionState';
import {
  enterUserCell,
  exitUserCell,
  onActiveCellChange,
  onCellsChange,
  type UserCell,
} from '@/lib/p2p/userCell';
import { getSwarmMeshStandalone } from '@/lib/p2p/swarmMesh.standalone';
import { canNativeShare, copyCellInvite, myCellInviteUrl, shareCellInvite } from '@/lib/p2p/cellShare';

/** The cell the switcher targets: the active one, else the most recently entered. */
function pickDefaultCell(cells: UserCell[], active: UserCell | null): UserCell | null {
  if (active) return cells.find(c => c.cellId === active.cellId) ?? active;
  if (cells.length === 0) return null;
  return [...cells].sort((a, b) => (b.lastEnteredAt ?? b.createdAt) - (a.lastEnteredAt ?? a.createdAt))[0];
}

export function CellNetworkSwitcher({ className }: { className?: string }) {
  const [cells, setCells] = useState<UserCell[]>([]);
  const [active, setActive] = useState<UserCell | null>(null);
  const [mode, setMode] = useState<NetworkMode>('swarm');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const u1 = onCellsChange(setCells);
    const u2 = onActiveCellChange(setActive);
    const u3 = subscribeToConnectionState(state => setMode(state.mode));
    return () => { u1(); u2(); u3(); };
  }, []);

  const inCell = mode === 'builder' && !!active;
  const selected = useMemo(() => {
    const chosen = selectedId ? cells.find(c => c.cellId === selectedId) : null;
    return chosen ?? pickDefaultCell(cells, inCell ? active : null);
  }, [cells, selectedId, active, inCell]);

  if (cells.length === 0) {
    return <NetworkModeToggle variant="compact" className={cn('w-full justify-center', className)} />;
  }

  const goMesh = async () => {
    if (!inCell || busy) return;
    setBusy(true);
    try {
      await exitUserCell();
      const sm = getSwarmMeshStandalone();
      const phase = sm.getPhase();
      if (phase === 'off' || phase === 'failed') void sm.start();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not return to the main mesh');
    } finally {
      setBusy(false);
    }
  };

  const goCell = async (cellId: string) => {
    if (busy || (inCell && active?.cellId === cellId)) return;
    setBusy(true);
    try {
      await enterUserCell(cellId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not enter the cell');
    } finally {
      setBusy(false);
    }
  };

  const pickCell = (cellId: string) => {
    setSelectedId(cellId);
    // Already in a cell: hop straight to the picked one.
    if (inCell) void goCell(cellId);
  };

  const segment = (on: boolean) => cn(
    'flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors',
    on ? 'bg-primary text-primary-foreground shadow-sm' : 'text-foreground/70 hover:bg-muted/60',
  );

  return (
    <div className={cn('space-y-2 rounded-lg border p-3', className)} data-testid="cell-network-switcher">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">
          Network: <span className="text-foreground">{inCell ? `Cell · ${active?.name}` : 'Main Mesh (SWARM)'}</span>
        </p>
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
      <div role="radiogroup" aria-label="Network" className="flex gap-1 rounded-full border border-border/40 bg-muted/30 p-0.5">
        <button
          type="button"
          role="radio"
          aria-checked={!inCell}
          className={segment(!inCell)}
          disabled={busy}
          onClick={() => void goMesh()}
        >
          <Zap className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">Main Mesh</span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={inCell}
          className={segment(inCell)}
          disabled={busy || !selected}
          onClick={() => selected && void goCell(selected.cellId)}
          title={selected ? `Enter ${selected.name}` : undefined}
        >
          <Users className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{cells.length > 1 ? 'Cell' : selected?.name ?? 'Cell'}</span>
        </button>
      </div>
      {cells.length > 1 && selected && (
        <Select value={selected.cellId} onValueChange={pickCell} disabled={busy}>
          <SelectTrigger className="h-8 text-xs" aria-label="Choose a cell">
            <SelectValue placeholder="Choose a cell" />
          </SelectTrigger>
          <SelectContent>
            {cells.map(cell => (
              <SelectItem key={cell.cellId} value={cell.cellId} className="text-xs">
                {cell.name}
                {cell.ownerUsername ? ` · @${cell.ownerUsername}` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {selected && (
        <div className="flex items-center gap-1.5">
          <code className="min-w-0 flex-1 truncate font-mono text-[0.65rem] text-muted-foreground" title={selected.cellId}>
            {selected.cellId}
          </code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1 px-2 text-[0.65rem]"
            onClick={() => void copyCellInvite(myCellInviteUrl(selected.cellId))}
          >
            <Link2 className="h-3 w-3" /> Copy invite link
          </Button>
          {canNativeShare() && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-7 w-7"
              aria-label="Share cell invite link"
              title="Share cell invite link"
              onClick={() => void shareCellInvite(myCellInviteUrl(selected.cellId), selected.name)}
            >
              <Share2 className="h-3 w-3" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
