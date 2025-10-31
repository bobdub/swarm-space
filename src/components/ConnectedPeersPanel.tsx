import { Card } from "@/components/ui/card";
import { Users, Wifi, WifiOff, Database, AlertTriangle } from "lucide-react";
import { useP2PContext } from "@/contexts/P2PContext";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/Avatar";
import { formatDistanceToNow } from "date-fns";

export function ConnectedPeersPanel() {
  const { stats, getDiscoveredPeers } = useP2PContext();
  const discoveredPeers = getDiscoveredPeers()
    .slice()
    .sort((a, b) => b.lastSeen.getTime() - a.lastSeen.getTime());

  const presenceThresholdMs = 30_000;

  const resolvePresence = (lastSeen: Date) => {
    const lastSeenDate = lastSeen instanceof Date ? lastSeen : new Date(lastSeen);
    if (Number.isNaN(lastSeenDate.getTime())) {
      return { label: "Presence unknown", indicatorClass: "bg-amber-500" };
    }

    const diff = Date.now() - lastSeenDate.getTime();
    if (diff <= presenceThresholdMs) {
      return { label: "Online now", indicatorClass: "bg-emerald-400" };
    }

    try {
      const distance = formatDistanceToNow(lastSeenDate, { addSuffix: true });
      return {
        label: `Seen ${distance}`,
        indicatorClass: "bg-amber-400",
      };
    } catch (error) {
      console.warn('[ConnectedPeersPanel] Failed to format presence distance', error);
      return { label: "Recently seen", indicatorClass: "bg-amber-400" };
    }
  };

  const getPeerPrimaryLabel = (displayName?: string, username?: string, userId?: string) => {
    if (displayName) return displayName;
    if (username) return username;
    if (userId) return userId.slice(0, 12);
    return "Unknown peer";
  };

  const failureRate = stats.connectionAttempts > 0 ? stats.failedConnectionAttempts / stats.connectionAttempts : 0;
  const beaconLatencyMs = stats.lastBeaconLatencyMs ?? 0;
  const timeToFirstPeerLabel =
    stats.timeToFirstPeerMs != null ? `${(stats.timeToFirstPeerMs / 1000).toFixed(1)}s` : '—';
  const beaconLatencyLabel =
    stats.lastBeaconLatencyMs != null ? `${(stats.lastBeaconLatencyMs / 1000).toFixed(1)}s` : '—';
  const rendezvousSuccessRate =
    stats.rendezvousAttempts > 0 ? stats.rendezvousSuccesses / stats.rendezvousAttempts : 0;
  const connectionHealthLabel =
    stats.connectionAttempts > 0 ? `${Math.round(failureRate * 100)}% failures` : 'No attempts yet';
  const rendezvousLabel =
    stats.rendezvousAttempts > 0
      ? `${Math.round(rendezvousSuccessRate * 100)}% success`
      : 'No attempts yet';
  const isDegraded =
    stats.status !== 'offline' &&
    (failureRate > 0.4 || stats.rendezvousFailureStreak > 0 || beaconLatencyMs > 10_000);

  const getStatusColor = () => {
    if (isDegraded) return 'text-amber-400';
    switch (stats.status) {
      case 'online': return 'text-green-500';
      case 'connecting': return 'text-yellow-500';
      case 'waiting': return 'text-blue-500';
      default: return 'text-gray-500';
    }
  };

  const getStatusIcon = () => {
    if (isDegraded) return <AlertTriangle className="h-4 w-4" />;
    if (stats.status === 'online') return <Wifi className="h-4 w-4" />;
    return <WifiOff className="h-4 w-4" />;
  };

  return (
    <Card className="p-4 border-[hsla(174,59%,56%,0.2)] bg-[hsla(245,70%,8%,0.4)]">
      <div className="space-y-4">
        {/* Network Status */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={getStatusColor()}>
              {getStatusIcon()}
            </div>
            <span className="text-sm font-medium">Network Status</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="capitalize">
              {stats.status}
            </Badge>
            {isDegraded && (
              <Badge variant="destructive" className="flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                Degraded
              </Badge>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="space-y-1">
            <div className="text-foreground/60">Connected Peers</div>
            <div className="text-xl font-bold text-primary">{stats.connectedPeers}</div>
          </div>
          <div className="space-y-1">
            <div className="text-foreground/60">Discovered Peers</div>
            <div className="text-xl font-bold text-secondary">{stats.discoveredPeers}</div>
          </div>
          <div className="space-y-1">
            <div className="text-foreground/60">Network Content</div>
            <div className="text-xl font-bold text-[hsl(174,59%,56%)]">{stats.networkContent}</div>
          </div>
          <div className="space-y-1">
            <div className="text-foreground/60">Local Content</div>
            <div className="text-xl font-bold text-foreground">{stats.localContent}</div>
          </div>
          <div className="space-y-1">
            <div className="text-foreground/60">Time to First Peer</div>
            <div className="text-base font-medium">{timeToFirstPeerLabel}</div>
          </div>
          <div className="space-y-1">
            <div className="text-foreground/60">Beacon Latency</div>
            <div className={`text-base font-medium ${beaconLatencyMs > 10_000 ? 'text-amber-300' : ''}`}>
              {beaconLatencyLabel}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-foreground/60">Connection Health</div>
            <div className={`text-base font-medium ${failureRate > 0.4 ? 'text-amber-400' : ''}`}>
              {connectionHealthLabel}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-foreground/60">Rendezvous Success</div>
            <div
              className={`text-base font-medium ${
                stats.rendezvousFailureStreak > 0 || rendezvousSuccessRate < 0.5 ? 'text-amber-400' : ''
              }`}
            >
              {rendezvousLabel}
            </div>
          </div>
        </div>

        {isDegraded && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-100">
            <p className="font-medium flex items-center gap-2 text-amber-200">
              <AlertTriangle className="h-3 w-3" /> Mesh performance degraded
            </p>
            <p className="mt-1 text-amber-100/80">
              Connection failures or slow rendezvous responses detected. Check signaling endpoints and beacon reachability.
            </p>
          </div>
        )}

        {/* Connected Peers List */}
        {discoveredPeers.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Users className="h-4 w-4" />
              <span>Active Peers</span>
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {discoveredPeers.map((peer) => {
                const primaryLabel = getPeerPrimaryLabel(
                  peer.profile?.displayName,
                  peer.profile?.username,
                  peer.userId,
                );
                const usernameLabel = peer.profile?.username ? `@${peer.profile.username}` : null;
                const presence = resolvePresence(peer.lastSeen);
                const availableCount = peer.availableContent?.size ?? 0;

                return (
                  <div
                    key={peer.peerId}
                    className="flex items-center justify-between p-2 rounded-lg bg-background/50 border border-border/50"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar
                          username={peer.profile?.username ?? peer.userId}
                          displayName={peer.profile?.displayName}
                          avatarRef={peer.profile?.avatarRef}
                          size="sm"
                          className="shrink-0"
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-foreground truncate" title={primaryLabel}>
                              {primaryLabel}
                            </span>
                            {usernameLabel && (
                              <span className="text-xs text-foreground/60 truncate" title={usernameLabel}>
                                {usernameLabel}
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-foreground/60">
                            <span className="flex items-center gap-2">
                              <span className={`h-2 w-2 rounded-full ${presence.indicatorClass}`} />
                              <span>{presence.label}</span>
                            </span>
                            <span className="flex items-center gap-1">
                              <Database className="h-3 w-3" />
                              {availableCount} {availableCount === 1 ? 'item' : 'items'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* Empty State */}
        {stats.connectedPeers === 0 && stats.status === 'waiting' && (
          <div className="text-center py-4 text-sm text-foreground/60">
            <p>Waiting for peers to connect...</p>
            <p className="text-xs mt-1">Share your Peer ID to get started</p>
          </div>
        )}
      </div>
    </Card>
  );
}
