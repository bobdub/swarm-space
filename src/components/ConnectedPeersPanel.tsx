/**
 * Connected Peers Panel
 * Presents discovered peers as the primary inventory and lets users
 * connect, disconnect, mute, hide, and block directly from that list.
 */

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Wifi,
  WifiOff,
  ShieldBan,
  VolumeX,
  EyeOff,
  MoreVertical,
  Unplug,
  Plug,
  Signal,
  SignalHigh,
  SignalLow,
  SignalZero,
  Search,
} from "lucide-react";
import { useP2PContext } from "@/contexts/P2PContext";
import { Avatar } from "@/components/Avatar";
import { getFeatureFlags } from "@/config/featureFlags";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

const HIDDEN_NODES_KEY = "p2p:hiddenNodes";
const MUTED_NODES_KEY = "p2p:mutedNodes";

function loadSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function saveSet(key: string, set: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    // ignore persistence errors
  }
}

export function ConnectedPeersPanel({ title }: { title?: string } = {}) {
  const {
    stats,
    getActivePeerConnections,
    getDiscoveredPeers,
    blockPeer,
    connectToPeer,
    disconnectFromPeer,
  } = useP2PContext();

  const flags = getFeatureFlags();
  const isSwarmMode = flags.swarmMeshMode;

  const [hiddenNodes, setHiddenNodes] = useState<Set<string>>(() => loadSet(HIDDEN_NODES_KEY));
  const [mutedNodes, setMutedNodes] = useState<Set<string>>(() => loadSet(MUTED_NODES_KEY));

  const activeConnections = getActivePeerConnections();
  const discoveredPeers = getDiscoveredPeers();
  const connectedIds = new Set(activeConnections.map((connection) => connection.peerId));

  const peers = useMemo(() => {
    return discoveredPeers
      .filter((peer) => !hiddenNodes.has(peer.peerId))
      .map((peer) => {
        const connection = activeConnections.find((candidate) => candidate.peerId === peer.peerId);
        const sharedCount = peer.availableContent?.size ?? 0;
        return {
          ...peer,
          connection,
          sharedCount,
          isConnected: connectedIds.has(peer.peerId),
        };
      })
      .sort((a, b) => {
        if (a.isConnected !== b.isConnected) {
          return a.isConnected ? -1 : 1;
        }
        return b.lastSeen.getTime() - a.lastSeen.getTime();
      });
  }, [activeConnections, connectedIds, discoveredPeers, hiddenNodes]);

  const handleBlock = (peerId: string) => {
    blockPeer(peerId, "all", "Blocked from connections panel");
    toast.success(`Blocked node ${peerId.slice(0, 12)}…`);
  };

  const handleMute = (peerId: string) => {
    const next = new Set(mutedNodes);
    if (next.has(peerId)) {
      next.delete(peerId);
      toast.info(`Unmuted node ${peerId.slice(0, 12)}…`);
    } else {
      next.add(peerId);
      toast.info(`Muted node ${peerId.slice(0, 12)}… — their content is hidden`);
    }
    setMutedNodes(next);
    saveSet(MUTED_NODES_KEY, next);
  };

  const handleHide = (peerId: string) => {
    const next = new Set(hiddenNodes);
    next.add(peerId);
    setHiddenNodes(next);
    saveSet(HIDDEN_NODES_KEY, next);
    toast.info(`Hidden node ${peerId.slice(0, 12)}… from this list`);
  };

  const handleDisconnect = (peerId: string) => {
    disconnectFromPeer(peerId);
    toast.info(`Disconnected from ${peerId.slice(0, 12)}…`);
  };

  const handleConnect = (peerId: string) => {
    const accepted = connectToPeer(peerId, { manual: true, source: "connections-panel" });
    if (accepted) {
      toast.info(`Connecting to ${peerId.slice(0, 12)}…`);
    } else {
      toast.info("Connection queued", {
        description: "The mesh accepted the peer into discovery but has not opened the session yet.",
      });
    }
  };

  const handleUnhideAll = () => {
    const cleared = new Set<string>();
    setHiddenNodes(cleared);
    saveSet(HIDDEN_NODES_KEY, cleared);
    toast.success("All hidden nodes restored");
  };

  const getQualityIcon = (rttMs: number | null | undefined, isConnected: boolean) => {
    if (!isConnected) return <SignalZero className="h-3.5 w-3.5 text-foreground/30" />;
    if (rttMs == null || rttMs < 120) return <SignalHigh className="h-3.5 w-3.5 text-emerald-400" />;
    if (rttMs < 400) return <Signal className="h-3.5 w-3.5 text-amber-400" />;
    if (rttMs < 900) return <SignalLow className="h-3.5 w-3.5 text-orange-400" />;
    return <SignalZero className="h-3.5 w-3.5 text-foreground/30" />;
  };

  const getConnectionBadge = (isConnected: boolean) => {
    if (isConnected) {
      return (
        <Badge variant="outline" className="text-[0.6rem] border-emerald-500/40 text-emerald-400 px-1.5 py-0">
          Connected
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-[0.6rem] border-foreground/20 text-foreground/50 px-1.5 py-0">
        Discovered
      </Badge>
    );
  };

  const connectedCount = activeConnections.length;

  return (
    <Card className="p-4 border-foreground/10 bg-card/60">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {connectedCount > 0 ? (
              <Wifi className="h-4 w-4 text-emerald-400" />
            ) : (
              <WifiOff className="h-4 w-4 text-foreground/40" />
            )}
            <span className="text-sm font-semibold tracking-wide">
              {isSwarmMode ? "Discovered Mesh Peers" : "Discovered Peer Inventory"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[0.65rem] tabular-nums">
              {peers.length} discovered
            </Badge>
            <Badge variant="outline" className="text-[0.65rem] tabular-nums">
              {connectedCount} live
            </Badge>
            {hiddenNodes.size > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[0.6rem] text-foreground/50 px-2"
                onClick={handleUnhideAll}
              >
                {hiddenNodes.size} hidden
              </Button>
            )}
          </div>
        </div>

        <div className="text-[0.65rem] uppercase tracking-widest text-foreground/40 flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${isSwarmMode ? "bg-primary" : "bg-amber-500"}`} />
          {isSwarmMode ? "SWARM Mesh inventory" : "Builder peer inventory"}
        </div>

        {peers.length > 0 ? (
          <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
            {peers.map((peer) => {
              const label = peer.profile?.displayName ?? peer.profile?.username ?? peer.userId ?? peer.peerId;
              const username = peer.profile?.username ? `@${peer.profile.username}` : null;
              const isMuted = mutedNodes.has(peer.peerId);

              return (
                <div
                  key={peer.peerId}
                  className={`group flex items-center justify-between p-2.5 rounded-lg border transition-colors duration-150 ${
                    isMuted
                      ? "border-foreground/5 bg-foreground/[0.02] opacity-60"
                      : "border-foreground/10 bg-background/40 hover:border-foreground/20"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <Avatar
                      username={peer.profile?.username ?? peer.peerId}
                      displayName={peer.profile?.displayName}
                      avatarRef={peer.profile?.avatarRef}
                      size="sm"
                      className="shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium truncate" title={label}>
                          {label}
                        </span>
                        {isMuted && <VolumeX className="h-3 w-3 text-foreground/30 shrink-0" />}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[0.65rem] text-foreground/50">
                        {username && <span className="truncate">{username}</span>}
                        <span className="font-mono truncate max-w-[12rem]">{peer.peerId}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[0.65rem] text-foreground/40">
                        <span>{peer.sharedCount} shared {peer.sharedCount === 1 ? "item" : "items"}</span>
                        <span>Seen {new Date(peer.lastSeen).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {getQualityIcon(peer.connection?.avgRttMs, peer.isConnected)}
                    {getConnectionBadge(peer.isConnected)}

                    <Button
                      variant={peer.isConnected ? "outline" : "default"}
                      size="sm"
                      className="h-8"
                      onClick={() => peer.isConnected ? handleDisconnect(peer.peerId) : handleConnect(peer.peerId)}
                    >
                      {peer.isConnected ? <Unplug className="h-3.5 w-3.5 mr-1" /> : <Plug className="h-3.5 w-3.5 mr-1" />}
                      {peer.isConnected ? "Disconnect" : "Connect"}
                    </Button>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <MoreVertical className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onClick={() => handleMute(peer.peerId)}>
                          <VolumeX className="h-3.5 w-3.5 mr-2" />
                          {isMuted ? "Unmute" : "Mute"}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleHide(peer.peerId)}>
                          <EyeOff className="h-3.5 w-3.5 mr-2" />
                          Hide from list
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => handleBlock(peer.peerId)}
                          className="text-destructive focus:text-destructive"
                        >
                          <ShieldBan className="h-3.5 w-3.5 mr-2" />
                          Block node
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-6">
            <Search className="h-8 w-8 mx-auto text-foreground/20 mb-2" />
            <p className="text-sm text-foreground/50">
              {stats.status === "offline"
                ? "Network offline"
                : stats.status === "connecting"
                  ? "Searching for peers…"
                  : "No discovered peers yet"}
            </p>
            <p className="text-[0.65rem] text-foreground/30 mt-1">
              {isSwarmMode
                ? "Verified peers will appear here as the swarm expands."
                : "Saved builder peers and active discoveries appear here once found."}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
