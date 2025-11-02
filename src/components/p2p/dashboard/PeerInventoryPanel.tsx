import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import type { NodeDashboardSnapshot } from '@/hooks/useNodeDashboard';
import { NoPeersEmptyState } from './emptyStates';

interface PeerInventoryPanelProps {
  snapshot: NodeDashboardSnapshot;
  onDisconnectPeer: (peerId: string) => void;
  onConnectPeer: (peerId: string, options?: { manual?: boolean; source?: string }) => boolean;
}

interface PeerOperation {
  peerId: string;
  kind: 'disconnect' | 'reconnect';
  status: 'pending' | 'success' | 'error';
  startedAt: number;
  updatedAt: number;
  error?: string;
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

export function PeerInventoryPanel({ snapshot, onDisconnectPeer, onConnectPeer }: PeerInventoryPanelProps) {
  const { peers } = snapshot;
  const [operations, setOperations] = useState<PeerOperation[]>([]);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const connectedPeerIds = useMemo(
    () => new Set(snapshot.connectionHealth.connections.map((connection) => connection.peerId)),
    [snapshot.connectionHealth.connections],
  );

  useEffect(() => {
    setOperations((current) => {
      let changed = false;
      const updated = current.map((operation) => {
        if (operation.status !== 'pending') {
          return operation;
        }
        const isConnected = connectedPeerIds.has(operation.peerId);
        if (operation.kind === 'disconnect') {
          if (!isConnected) {
            changed = true;
            return { ...operation, status: 'success', updatedAt: now };
          }
        } else if (operation.kind === 'reconnect') {
          if (isConnected) {
            changed = true;
            return { ...operation, status: 'success', updatedAt: now };
          }
        }
        if (now - operation.startedAt > 8000) {
          changed = true;
          return {
            ...operation,
            status: 'error',
            updatedAt: now,
            error:
              operation.kind === 'disconnect'
                ? 'Peer is still connected.'
                : 'Peer did not reconnect.',
          };
        }
        return operation;
      });
      return changed ? updated : current;
    });
  }, [connectedPeerIds, now]);

  useEffect(() => {
    setOperations((current) => {
      const filtered = current.filter((operation) => {
        if (operation.status === 'pending') {
          return true;
        }
        return now - operation.updatedAt < 6000;
      });
      return filtered.length === current.length ? current : filtered;
    });
  }, [now]);

  const pendingByPeer = useMemo(() => {
    const map = new Map<string, PeerOperation>();
    for (const operation of operations) {
      if (operation.status === 'pending') {
        map.set(operation.peerId, operation);
      }
    }
    return map;
  }, [operations]);

  const startOperation = (operation: PeerOperation) => {
    setOperations((current) => {
      const filtered = current.filter(
        (existing) => !(existing.peerId === operation.peerId && existing.kind === operation.kind),
      );
      return [...filtered, operation];
    });
  };

  const handleDisconnect = (peerId: string) => {
    if (pendingByPeer.has(peerId)) {
      return;
    }
    onDisconnectPeer(peerId);
    const timestamp = Date.now();
    startOperation({ peerId, kind: 'disconnect', status: 'pending', startedAt: timestamp, updatedAt: timestamp });
  };

  const handleReconnect = (peerId: string) => {
    if (pendingByPeer.has(peerId)) {
      return;
    }
    const timestamp = Date.now();
    const accepted = onConnectPeer(peerId, { manual: true, source: 'dashboard-retry' });
    if (!accepted) {
      startOperation({
        peerId,
        kind: 'reconnect',
        status: 'error',
        startedAt: timestamp,
        updatedAt: timestamp,
        error: 'Unable to queue reconnect request.',
      });
      return;
    }
    startOperation({ peerId, kind: 'reconnect', status: 'pending', startedAt: timestamp, updatedAt: timestamp });
  };

  const handleUndoDisconnect = (peerId: string) => {
    const timestamp = Date.now();
    const accepted = onConnectPeer(peerId, { manual: true, source: 'undo-disconnect' });
    if (!accepted) {
      startOperation({
        peerId,
        kind: 'reconnect',
        status: 'error',
        startedAt: timestamp,
        updatedAt: timestamp,
        error: 'Unable to start reconnect.',
      });
      return;
    }
    startOperation({ peerId, kind: 'reconnect', status: 'pending', startedAt: timestamp, updatedAt: timestamp });
  };

  const handleRetry = (operation: PeerOperation) => {
    const timestamp = Date.now();
    if (operation.kind === 'disconnect') {
      onDisconnectPeer(operation.peerId);
    } else {
      onConnectPeer(operation.peerId, { manual: true, source: 'retry-reconnect' });
    }
    startOperation({
      peerId: operation.peerId,
      kind: operation.kind,
      status: 'pending',
      startedAt: timestamp,
      updatedAt: timestamp,
    });
  };

  const renderOperationTitle = (operation: PeerOperation): string => {
    if (operation.status === 'pending') {
      return operation.kind === 'disconnect'
        ? `Disconnecting ${operation.peerId}…`
        : `Retrying ${operation.peerId}…`;
    }
    if (operation.status === 'success') {
      return operation.kind === 'disconnect'
        ? `Disconnected ${operation.peerId}.`
        : `Reconnect requested for ${operation.peerId}.`;
    }
    return operation.kind === 'disconnect'
      ? `Failed to disconnect ${operation.peerId}.`
      : `Reconnect failed for ${operation.peerId}.`;
  };

  const renderOperationDescription = (operation: PeerOperation): string => {
    if (operation.status === 'pending') {
      return operation.kind === 'disconnect'
        ? 'Awaiting peer shutdown acknowledgement.'
        : 'Dial request sent; waiting for handshake.';
    }
    if (operation.status === 'success') {
      return operation.kind === 'disconnect'
        ? 'Undo if this disconnect was accidental.'
        : 'Connection manager will keep monitoring latency.';
    }
    return operation.error ?? (operation.kind === 'disconnect'
      ? 'Peer reported busy; try again.'
      : 'No peers responded to the reconnect attempt.');
  };

  const renderOperationAction = (operation: PeerOperation) => {
    if (operation.status === 'success' && operation.kind === 'disconnect') {
      return (
        <Button size="sm" variant="outline" onClick={() => handleUndoDisconnect(operation.peerId)}>
          Undo
        </Button>
      );
    }
    if (operation.status === 'error') {
      return (
        <Button size="sm" variant="outline" onClick={() => handleRetry(operation)}>
          Retry
        </Button>
      );
    }
    return null;
  };

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

      {operations.length > 0 && (
        <div className="space-y-2">
          {operations.map((operation) => {
            const progress = operation.status === 'pending'
              ? Math.min(100, ((now - operation.startedAt) / 8000) * 100)
              : undefined;
            const actionButton = renderOperationAction(operation);
            const description = renderOperationDescription(operation);
            const isError = operation.status === 'error';

            return (
              <div
                key={`${operation.peerId}:${operation.kind}:${operation.startedAt}`}
                className="rounded-md border border-border/40 bg-background/70 p-3"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">{renderOperationTitle(operation)}</p>
                    <p className={`text-xs ${isError ? 'text-destructive' : 'text-muted-foreground'}`}>{description}</p>
                  </div>
                  {actionButton && <div className="shrink-0">{actionButton}</div>}
                </div>
                {progress !== undefined && (
                  <Progress value={progress} className="mt-3 h-1.5" aria-hidden="true" />
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="rounded-md border border-border/40 bg-background/70">
        <ScrollArea className="h-56">
          <div className="divide-y divide-border/30 text-sm">
            {peers.discovered.length === 0 ? (
              <div className="p-4">
                <NoPeersEmptyState />
              </div>
            ) : (
              peers.discovered.map((peer) => {
                const isConnected = connectedPeerIds.has(peer.peerId);
                const pending = pendingByPeer.get(peer.peerId);
                const hasPending = Boolean(pending);

                return (
                  <div key={peer.peerId} className="flex items-center justify-between gap-4 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{peer.profile?.displayName ?? peer.peerId}</p>
                      <p className="text-xs text-muted-foreground">
                        {peer.userId} · Last seen {formatLastSeen(peer.lastSeen)}
                      </p>
                      {hasPending && (
                        <p className="text-[11px] text-muted-foreground">Action in progress…</p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2 text-right text-xs text-muted-foreground">
                      <span>
                        {peer.healthStatus ?? 'unknown'} · {peer.availableContent.size} manifests
                      </span>
                      <div className="flex gap-2">
                        {isConnected ? (
                          <Button size="sm" variant="outline" onClick={() => handleDisconnect(peer.peerId)} disabled={hasPending}>
                            Disconnect
                          </Button>
                        ) : (
                          <Button size="sm" variant="outline" onClick={() => handleReconnect(peer.peerId)} disabled={hasPending}>
                            Retry connect
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </div>
    </Card>
  );
}
