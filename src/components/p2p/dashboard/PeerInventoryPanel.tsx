import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { NodeDashboardSnapshot } from '@/hooks/useNodeDashboard';
import { NoPeersEmptyState } from './emptyStates';

interface PeerInventoryPanelProps {
  snapshot: NodeDashboardSnapshot;
}

function formatLastSeen(date: Date | undefined): string {
  if (!date) {
    return '—';
  }
  const delta = Date.now() - date.getTime();
  if (delta < 60_000) {
    return `${Math.max(1, Math.floor(delta / 1000))}s ago`;
  }
  if (delta < 3_600_000) {
    return `${Math.floor(delta / 60_000)}m ago`;
  }
  const hours = Math.floor(delta / 3_600_000);
  if (hours < 48) {
    return `${hours}h ago`;
  }
  return date.toLocaleString();
}

export function PeerInventoryPanel({ snapshot }: PeerInventoryPanelProps) {
  const { peers } = snapshot;

  return (
    <Card className="p-5 space-y-4 border-primary/30 bg-background/60 backdrop-blur">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Peer inventory</h2>
          <p className="text-sm text-muted-foreground">
            Discovered peers, pending approvals, and blocked nodes for quick follow-up.
          </p>
        </div>
        <div className="text-xs text-muted-foreground">
          {peers.totalDiscovered} discovered · {peers.pending.length} pending · {peers.blocked.length} blocked
        </div>
      </div>

      <div className="rounded-md border border-border/40 bg-background/70">
        <ScrollArea className="h-56">
          <div className="divide-y divide-border/30 text-sm">
            {peers.discovered.length === 0 ? (
              <div className="p-4">
                <NoPeersEmptyState />
              </div>
            ) : (
              peers.discovered.map((peer) => (
                <div key={peer.peerId} className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{peer.profile?.displayName ?? peer.peerId}</p>
                    <p className="text-xs text-muted-foreground">
                      {peer.userId} · Last seen {formatLastSeen(peer.lastSeen)}
                    </p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    {peer.healthStatus ?? 'unknown'} · {peer.availableContent.size} manifests
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    </Card>
  );
}
