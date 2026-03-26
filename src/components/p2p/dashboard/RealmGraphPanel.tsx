import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { getRealmGraphStore, type RealmGraphReadModel, type RealmLinkTrust } from '@/lib/p2p/realmGraph';

const trustBadgeVariant: Record<RealmLinkTrust, 'default' | 'secondary' | 'destructive'> = {
  trusted: 'default',
  pending: 'secondary',
  blocked: 'destructive',
};

function formatTouchAge(timestamp: number): string {
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return `${Math.max(1, Math.floor(delta / 1000))}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return new Date(timestamp).toLocaleString();
}

export function RealmGraphPanel() {
  const [snapshot, setSnapshot] = useState<RealmGraphReadModel>(() => getRealmGraphStore().getSnapshot());

  useEffect(() => getRealmGraphStore().subscribe(setSnapshot), []);

  return (
    <Card className="p-5 space-y-4 border-primary/20 bg-background/60 backdrop-blur">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Realm graph</h2>
          <p className="text-sm text-muted-foreground">
            Account identity mapped to touched peer realms from dashboard, context, and connection flows.
          </p>
        </div>
        <Badge variant="outline">Surface: {snapshot.activeSurface}</Badge>
      </div>

      {snapshot.accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">No account/peer realm links observed yet.</p>
      ) : (
        <div className="space-y-3">
          {snapshot.accounts.map((account) => (
            <div key={`${account.account.userId ?? 'anon'}-${account.account.nodeId ?? 'node-none'}`} className="rounded-lg border border-border/40 p-3">
              <div className="mb-2 text-xs text-muted-foreground">
                userId: <span className="font-mono">{account.account.userId ?? 'anonymous'}</span> · nodeId:{' '}
                <span className="font-mono">{account.account.nodeId ?? 'unknown'}</span>
              </div>
              <div className="space-y-2">
                {account.touchpoints.slice(0, 12).map((touch) => (
                  <div key={touch.peerId} className="flex flex-wrap items-center gap-2 rounded border border-border/30 px-2 py-1.5 text-xs">
                    <code className="font-mono">{touch.peerId}</code>
                    <Badge variant={trustBadgeVariant[touch.trust]} className="uppercase text-[10px]">
                      {touch.trust}
                    </Badge>
                    <span className="text-muted-foreground">touches: {touch.touchCount}</span>
                    <span className="text-muted-foreground">last: {formatTouchAge(touch.lastTouchedAt)}</span>
                    <span className="text-muted-foreground">via {touch.lastSurface}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

