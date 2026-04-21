import { useState, useEffect } from 'react';
import { Zap, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { subscribeToConnectionState, type NetworkMode } from '@/lib/p2p/connectionState';
import { onActiveCellChange, type UserCell } from '@/lib/p2p/userCell';

interface NetworkModeToggleProps {
  /** Compact pill for wifi popover; cell-badge for the dashboard chip. */
  variant?: 'compact' | 'cell-badge';
  className?: string;
}

/**
 * Read-only mode chip. Modes are no longer toggled in the UI — SWARM is the
 * default; private meshes are entered via the User Cells panel.
 */
export function NetworkModeToggle({ variant = 'compact', className }: NetworkModeToggleProps) {
  const [mode, setMode] = useState<NetworkMode>('swarm');
  const [activeCell, setActiveCell] = useState<UserCell | null>(null);

  useEffect(() => {
    const u1 = subscribeToConnectionState((state) => setMode(state.mode));
    const u2 = onActiveCellChange(setActiveCell);
    return () => { u1(); u2(); };
  }, []);

  const inCell = mode === 'builder' && activeCell;

  if (variant === 'compact') {
    return (
      <div
        className={cn(
          'inline-flex items-center gap-1 rounded-full border border-border/40 bg-muted/30 px-2.5 py-1 text-[0.65rem] font-semibold uppercase tracking-wider',
          inCell ? 'text-primary' : 'text-foreground/70',
          className,
        )}
      >
        {inCell ? <Users className="h-3 w-3" /> : <Zap className="h-3 w-3" />}
        {inCell ? 'Cell' : 'Swarm'}
      </div>
    );
  }

  // cell-badge
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.6rem] font-semibold uppercase tracking-wider',
        inCell
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-border/40 bg-muted/30 text-foreground/70',
        className,
      )}
    >
      {inCell ? (
        <>
          <Users className="h-3 w-3" />
          <span>CELL: <code className="font-mono">{activeCell.cellId}</code></span>
        </>
      ) : (
        <>
          <Zap className="h-3 w-3" />
          SWARM
        </>
      )}
    </div>
  );
}
