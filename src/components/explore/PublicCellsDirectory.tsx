/**
 * Explore → People: a live directory of public cells (the tab's main focus)
 * followed by the network peers this node is connected to right now.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, Globe, Link2, Loader2, LogIn, Share2, UserRound, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useP2PContext } from '@/contexts/P2PContext';
import { subscribePublicCells, type PublicCellListing } from '@/lib/p2p/publicCells';
import {
  getActiveUserCellId,
  getUserCell,
  joinUserCellById,
  onActiveCellChange,
  onCellsChange,
} from '@/lib/p2p/userCell';
import { canNativeShare, cellInviteUrlVia, copyCellInvite, shareCellInvite } from '@/lib/p2p/cellShare';
import { getCurrentUser } from '@/lib/auth';
import type { PeerConnectionDetail } from '@/lib/p2p/manager';

function ago(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'active now';
  const m = Math.floor(s / 60);
  return `active ${m}m ago`;
}

function PublicCellCard({ cell, activeCellId, onJoin, joining }: {
  cell: PublicCellListing;
  activeCellId: string | null;
  onJoin: (cell: PublicCellListing) => void;
  joining: boolean;
}) {
  const me = getCurrentUser();
  const mine = !!me && (cell.ownerUserId === me.id || cell.ownerUsername === me.username);
  const isActive = activeCellId === cell.cellId;
  const known = !!getUserCell(cell.cellId);
  const invite = cellInviteUrlVia(cell.cellId, cell.ownerMeshPeerId);

  return (
    <Card className="flex flex-col gap-3 border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,8%,0.4)] p-4" data-testid="public-cell-card">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[hsla(174,59%,56%,0.15)]">
          <Users className="h-5 w-5 text-[hsl(174,59%,56%)]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold" title={cell.name}>{cell.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Link to={`/u/${encodeURIComponent(cell.ownerUsername)}`}>
              <Badge variant="outline" className="border-primary/30 text-[0.65rem] text-primary/80 hover:bg-primary/10">
                @{cell.ownerUsername}
              </Badge>
            </Link>
            {mine && <Badge variant="secondary" className="text-[0.6rem]">Yours</Badge>}
            {isActive && <Badge variant="outline" className="border-primary/40 text-[0.6rem] text-primary">You're here</Badge>}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 text-xs text-foreground/60">
        <span className="flex items-center gap-1"><UserRound className="h-3.5 w-3.5" /> {cell.members} {cell.members === 1 ? 'member' : 'members'} online</span>
        <span className="flex items-center gap-1"><Activity className="h-3.5 w-3.5 text-green-500" /> {ago(cell.announcedAt)}</span>
      </div>
      <div className="mt-auto flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          className="flex-1 gap-1.5"
          disabled={joining || isActive}
          onClick={() => onJoin(cell)}
        >
          {joining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}
          {isActive ? 'Joined' : known || mine ? 'Enter cell' : 'Join cell'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => void (canNativeShare() ? shareCellInvite(invite, cell.name) : copyCellInvite(invite))}
          aria-label={`Invite link for ${cell.name}`}
        >
          {canNativeShare() ? <Share2 className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
          Invite link
        </Button>
      </div>
    </Card>
  );
}

function PeerRow({ peer }: { peer: PeerConnectionDetail }) {
  const username = peer.profile?.username?.trim();
  const label = peer.profile?.displayName?.trim() || (username ? `@${username}` : `${peer.peerId.slice(0, 14)}…`);
  const body = (
    <div className="flex items-center gap-3 rounded-lg border border-border/30 bg-background/30 px-3 py-2 hover:bg-background/50">
      <span className={`h-2 w-2 shrink-0 rounded-full ${peer.status === 'healthy' ? 'bg-green-500' : 'bg-yellow-500'}`} />
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      {username && <span className="truncate text-xs text-foreground/50">@{username}</span>}
    </div>
  );
  return username ? <Link to={`/u/${encodeURIComponent(username)}`}>{body}</Link> : body;
}

export function PublicCellsDirectory() {
  const { getActivePeerConnections, connectToPeer, isEnabled } = useP2PContext();
  const [cells, setCells] = useState<PublicCellListing[]>([]);
  const [activeCellId, setActiveCellId] = useState<string | null>(getActiveUserCellId());
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [peers, setPeers] = useState<PeerConnectionDetail[]>([]);
  const [, bump] = useState(0);

  useEffect(() => subscribePublicCells(setCells), []);
  useEffect(() => onActiveCellChange(c => setActiveCellId(c?.cellId ?? null)), []);
  // Re-render when local cells change so "Join" vs "Enter" stays right.
  useEffect(() => onCellsChange(() => bump(n => (n + 1) & 0xfff)), []);
  useEffect(() => {
    const read = () => {
      try { setPeers(getActivePeerConnections()); } catch { setPeers([]); }
    };
    read();
    const t = window.setInterval(read, 5_000);
    return () => window.clearInterval(t);
  }, [getActivePeerConnections]);

  const join = async (cell: PublicCellListing) => {
    setJoiningId(cell.cellId);
    try {
      // Connect to the owner as a peer too, then join their cell.
      if (cell.ownerMeshPeerId) {
        try { connectToPeer(cell.ownerMeshPeerId, { manual: true, source: 'public-cell' }); } catch { /* best effort */ }
      }
      await joinUserCellById(cell.cellId, cell.name);
      toast.success(`Joined ${cell.name}`, { description: `Hosted by @${cell.ownerUsername}` });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not join this cell');
    } finally {
      setJoiningId(null);
    }
  };

  return (
    <div className="space-y-8">
      <section aria-labelledby="public-cells-heading" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="public-cells-heading" className="flex items-center gap-2 text-xl font-semibold">
              <Globe className="h-5 w-5 text-[hsl(174,59%,56%)]" />
              Public Cells
            </h2>
            <p className="text-sm text-foreground/60">Open communities hosted by people on the mesh. Join in one click.</p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/node-dashboard">Host your own cell</Link>
          </Button>
        </div>
        {cells.length === 0 ? (
          <Card className="border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,8%,0.4)] p-10 text-center">
            <Users className="mx-auto mb-4 h-12 w-12 text-[hsl(174,59%,56%)] opacity-50" />
            <p className="text-foreground/70">No public cells are online right now</p>
            <p className="mt-2 text-sm text-foreground/40">
              {isEnabled
                ? 'Cells appear here as their owners come online. Make one of yours public from the Node Dashboard.'
                : 'Turn on your P2P connection to discover public cells.'}
            </p>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {cells.map(cell => (
              <PublicCellCard
                key={cell.cellId}
                cell={cell}
                activeCellId={activeCellId}
                joining={joiningId === cell.cellId}
                onJoin={c => void join(c)}
              />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="network-peers-heading" className="space-y-3">
        <h2 id="network-peers-heading" className="flex items-center gap-2 text-base font-semibold text-foreground/80">
          <UserRound className="h-4 w-4" />
          Active network peers
          <Badge variant="outline" className="text-[0.65rem]">{peers.length}</Badge>
        </h2>
        {peers.length === 0 ? (
          <p className="text-sm text-foreground/50">No peers connected yet.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {peers.map(peer => <PeerRow key={peer.peerId} peer={peer} />)}
          </div>
        )}
      </section>
    </div>
  );
}
