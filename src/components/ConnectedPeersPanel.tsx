import { Card } from "@/components/ui/card";
import { Users, Wifi, WifiOff, Database } from "lucide-react";
import { useP2PContext } from "@/contexts/P2PContext";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/Avatar";

export function ConnectedPeersPanel() {
  const { stats, getDiscoveredPeers } = useP2PContext();
  const discoveredPeers = getDiscoveredPeers();

  const getStatusColor = () => {
    switch (stats.status) {
      case 'online': return 'text-green-500';
      case 'connecting': return 'text-yellow-500';
      case 'waiting': return 'text-orange-500';
      default: return 'text-gray-500';
    }
  };

  const getStatusIcon = () => {
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
          <Badge variant="outline" className="capitalize">
            {stats.status}
          </Badge>
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
        </div>

        {/* Connected Peers List */}
        {discoveredPeers.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Users className="h-4 w-4" />
              <span>Active Peers</span>
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {discoveredPeers.map((peer) => (
                <div
                  key={peer.peerId}
                  className="flex items-center justify-between p-2 rounded-lg bg-background/50 border border-border/50"
                >
                  <div className="flex items-center gap-2">
                    <Avatar username={peer.userId.slice(0, 8)} size="sm" />
                    <div>
                      <div className="text-sm font-medium">{peer.userId.slice(0, 8)}...</div>
                      <div className="text-xs text-foreground/60 flex items-center gap-1">
                        <Database className="h-3 w-3" />
                        {peer.availableContent.size} items
                      </div>
                    </div>
                  </div>
                  <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                </div>
              ))}
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
