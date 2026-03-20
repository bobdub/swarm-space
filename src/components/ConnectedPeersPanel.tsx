/**
 * Connected Peers Panel
 * Shows ONLY active mesh connections with per-node moderation controls.
 * Adapts display for SWARM Mesh vs Builder mode.
 */

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  Wifi,
  WifiOff,
  ShieldBan,
  VolumeX,
  EyeOff,
  MoreVertical,
  Unplug,
  Signal,
  SignalHigh,
  SignalLow,
  SignalZero,
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

interface HiddenNode {
  peerId: string;
  hiddenAt: number;
}

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
  } catch {}
}

export function ConnectedPeersPanel() {
  const {
    stats,
    getActivePeerConnections,
    getDiscoveredPeers,
    blockPeer,
    disconnectFromPeer,
  } = useP2PContext();

  const flags = getFeatureFlags();
  const isSwarmMode = flags.swarmMeshMode;

  const [hiddenNodes, setHiddenNodes] = useState<Set<string>>(() => loadSet(HIDDEN_NODES_KEY));
  const [mutedNodes, setMutedNodes] = useState<Set<string>>(() => loadSet(MUTED_NODES_KEY));

  // Get active connections only — not the full discovery library
  const activeConnections = getActivePeerConnections();
  const discoveredPeers = getDiscoveredPeers();

  // Build a map of discovered peer profiles for display
  const profileMap = new Map(
    discoveredPeers.map((p) => [p.peerId, p])
  );

  // Filter to only connected/active peers, excluding hidden ones
  const visiblePeers = activeConnections.filter(
    (conn) => !hiddenNodes.has(conn.peerId)
  );

  const handleBlock = (peerId: string) => {
    blockPeer(peerId, "all", "Blocked from connections panel");
    toast.success(`Blocked node ${peerId.slice(0, 8)}…`);
  };

  const handleMute = (peerId: string) => {
    const next = new Set(mutedNodes);
    if (next.has(peerId)) {
      next.delete(peerId);
      toast.info(`Unmuted node ${peerId.slice(0, 8)}…`);
    } else {
      next.add(peerId);
      toast.info(`Muted node ${peerId.slice(0, 8)}… — their content is hidden`);
    }
    setMutedNodes(next);
    saveSet(MUTED_NODES_KEY, next);
  };

  const handleHide = (peerId: string) => {
    const next = new Set(hiddenNodes);
    next.add(peerId);
    setHiddenNodes(next);
    saveSet(HIDDEN_NODES_KEY, next);
    toast.info(`Hidden node ${peerId.slice(0, 8)}… from this list`);
  };

  const handleDisconnect = (peerId: string) => {
    disconnectFromPeer(peerId);
    toast.info(`Disconnected from ${peerId.slice(0, 8)}…`);
  };

  const handleUnhideAll = () => {
    setHiddenNodes(new Set());
    saveSet(HIDDEN_NODES_KEY, new Set());
    toast.success("All hidden nodes restored");
  };

  const getQualityIcon = (quality: number) => {
    if (quality >= 75) return <SignalHigh className="h-3.5 w-3.5 text-emerald-400" />;
    if (quality >= 40) return <Signal className="h-3.5 w-3.5 text-amber-400" />;
    if (quality > 0) return <SignalLow className="h-3.5 w-3.5 text-orange-400" />;
    return <SignalZero className="h-3.5 w-3.5 text-foreground/30" />;
  };

  const getConnectionBadge = (state: string) => {
    switch (state) {
      case "connected":
        return (
          <Badge variant="outline" className="text-[0.6rem] border-emerald-500/40 text-emerald-400 px-1.5 py-0">
            Connected
          </Badge>
        );
      case "connecting":
        return (
          <Badge variant="outline" className="text-[0.6rem] border-amber-500/40 text-amber-400 px-1.5 py-0">
            Connecting
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-[0.6rem] border-foreground/20 text-foreground/40 px-1.5 py-0">
            {state}
          </Badge>
        );
    }
  };

  const getPeerLabel = (peerId: string) => {
    const profile = profileMap.get(peerId);
    if (profile?.profile?.displayName) return profile.profile.displayName;
    if (profile?.profile?.username) return profile.profile.username;
    if (profile?.userId) return profile.userId.slice(0, 12);
    return peerId.slice(0, 12) + "…";
  };

  const getPeerUsername = (peerId: string) => {
    const profile = profileMap.get(peerId);
    if (profile?.profile?.username) return `@${profile.profile.username}`;
    return null;
  };

  const connectedCount = activeConnections.length;

  return (
    <Card className="p-4 border-foreground/10 bg-card/60">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {connectedCount > 0 ? (
              <Wifi className="h-4 w-4 text-emerald-400" />
            ) : (
              <WifiOff className="h-4 w-4 text-foreground/40" />
            )}
            <span className="text-sm font-semibold tracking-wide">
              {isSwarmMode ? "Mesh Connections" : "Peer Connections"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[0.65rem] tabular-nums">
              {connectedCount} active
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

        {/* Mode indicator */}
        <div className="text-[0.65rem] uppercase tracking-widest text-foreground/40 flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${isSwarmMode ? "bg-primary" : "bg-amber-500"}`} />
          {isSwarmMode ? "SWARM Mesh" : "Builder Mode"}
        </div>

        {/* Connection list */}
        {visiblePeers.length > 0 ? (
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {visiblePeers.map((conn) => {
              const label = getPeerLabel(conn.peerId);
              const username = getPeerUsername(conn.peerId);
              const profile = profileMap.get(conn.peerId);
              const isMuted = mutedNodes.has(conn.peerId);
              const rtt = conn.avgRttMs ?? 0;
              const quality = rtt < 100 ? 80 : rtt < 500 ? 50 : 20;

              return (
                <div
                  key={conn.peerId}
                  className={`
                    group flex items-center justify-between p-2.5 rounded-lg
                    border transition-colors duration-150
                    ${isMuted
                      ? "border-foreground/5 bg-foreground/[0.02] opacity-60"
                      : "border-foreground/10 bg-background/40 hover:border-foreground/20"
                    }
                  `}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <Avatar
                      username={profile?.profile?.username ?? conn.peerId}
                      displayName={profile?.profile?.displayName}
                      avatarRef={profile?.profile?.avatarRef}
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
                      <div className="flex items-center gap-2 mt-0.5">
                        {username && (
                          <span className="text-[0.65rem] text-foreground/50 truncate">
                            {username}
                          </span>
                        )}
                        <span className="text-[0.6rem] text-foreground/30 font-mono truncate">
                          {conn.peerId.slice(0, 8)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {getQualityIcon(quality)}
                    {getConnectionBadge(conn.state)}

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
                        <DropdownMenuItem onClick={() => handleMute(conn.peerId)}>
                          <VolumeX className="h-3.5 w-3.5 mr-2" />
                          {isMuted ? "Unmute" : "Mute"}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleHide(conn.peerId)}>
                          <EyeOff className="h-3.5 w-3.5 mr-2" />
                          Hide from list
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleDisconnect(conn.peerId)}>
                          <Unplug className="h-3.5 w-3.5 mr-2" />
                          Disconnect
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => handleBlock(conn.peerId)}
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
            <Users className="h-8 w-8 mx-auto text-foreground/20 mb-2" />
            <p className="text-sm text-foreground/50">
              {stats.status === "offline"
                ? "Network offline"
                : stats.status === "connecting"
                  ? "Searching for peers…"
                  : "No active connections"
              }
            </p>
            <p className="text-[0.65rem] text-foreground/30 mt-1">
              {isSwarmMode
                ? "Peers connect automatically via bootstrap nodes"
                : "Enter a Peer ID in Builder Mode to connect"
              }
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}
