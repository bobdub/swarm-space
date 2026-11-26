/**
 * Cell invite panel on `/connect?cell=…`. Shows the cell's name and owner,
 * then joins it once the sharer's dial settles (or straight away when the
 * link carries no sharer), so the guest ends up with both connections.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Loader2, LogIn, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import type { BrainInviteState } from '@/lib/p2p/brainInvite';
import {
  getActiveUserCellId,
  getUserCell,
  joinUserCellById,
  onActiveCellChange,
} from '@/lib/p2p/userCell';
import { subscribePublicCells, type PublicCellListing } from '@/lib/p2p/publicCells';

type JoinPhase = 'waiting' | 'joining' | 'joined' | 'failed';

interface CellInviteCardProps {
  cellId: string;
  invite: BrainInviteState;
}

/** The sharer dial has settled (either way), so switching engines will not cut it short. */
function dialSettled(invite: BrainInviteState): boolean {
  if (!invite.peerId) return true;
  return invite.phase !== 'idle' && invite.phase !== 'starting' && invite.phase !== 'connecting';
}

export function CellInviteCard({ cellId, invite }: CellInviteCardProps) {
  const navigate = useNavigate();
  const [listing, setListing] = useState<PublicCellListing | null>(null);
  const [phase, setPhase] = useState<JoinPhase>(() => (getActiveUserCellId() === cellId ? 'joined' : 'waiting'));
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef(false);

  useEffect(() => subscribePublicCells(list => setListing(list.find(l => l.cellId === cellId) ?? null)), [cellId]);
  useEffect(() => onActiveCellChange(active => {
    if (active?.cellId === cellId) setPhase('joined');
  }), [cellId]);

  const known = getUserCell(cellId);
  const ownerUsername = listing?.ownerUsername || known?.ownerUsername || cellId.split('/')[1] || '';
  const cellName = listing?.name || known?.name || `@${ownerUsername}'s cell`;

  const join = async () => {
    attempted.current = true;
    setPhase('joining');
    setError(null);
    try {
      await joinUserCellById(cellId, listing?.name ?? known?.name);
      setPhase('joined');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join this cell.');
      setPhase('failed');
    }
  };

  // Hold the join until the sharer's dial settles; waiting no longer than 25s.
  const settled = dialSettled(invite);
  const [timedOut, setTimedOut] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setTimedOut(true), 25_000);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    if (attempted.current || phase !== 'waiting') return;
    if (settled || timedOut) void join();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, timedOut, phase]);

  return (
    <section aria-label="Cell invite" className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <div className="flex items-center gap-2">
        <Users className="h-4 w-4 shrink-0 text-primary" />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold" title={cellName}>{cellName}</p>
        {ownerUsername && (
          <Badge variant="outline" className="border-primary/30 text-[0.6rem] text-primary/80">
            @{ownerUsername}
          </Badge>
        )}
      </div>
      <code className="block truncate font-mono text-[0.65rem] text-muted-foreground" title={cellId}>{cellId}</code>
      <p role="status" aria-live="polite" className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {phase === 'waiting' && (<><Loader2 className="h-3 w-3 animate-spin" /> Connecting to the sharer first, then joining the cell…</>)}
        {phase === 'joining' && (<><Loader2 className="h-3 w-3 animate-spin" /> Joining the cell…</>)}
        {phase === 'joined' && (<><Check className="h-3 w-3 text-green-600" /> You're in this cell.</>)}
        {phase === 'failed' && <span className="text-destructive">{error}</span>}
      </p>
      <div className="flex flex-wrap gap-2">
        {(phase === 'failed' || phase === 'waiting') && (
          <Button type="button" size="sm" className="gap-1.5" onClick={() => void join()}>
            <LogIn className="h-3.5 w-3.5" />
            {phase === 'failed' ? 'Try again' : 'Join now'}
          </Button>
        )}
        {phase === 'joined' && (
          <Button type="button" size="sm" variant="outline" onClick={() => navigate('/node-dashboard')}>
            Open cell in dashboard
          </Button>
        )}
      </div>
    </section>
  );
}
