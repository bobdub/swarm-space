/**
 * Connected Peers Panel
 * Presents discovered peers as the primary inventory and lets users
 * connect, disconnect, mute, hide, and block directly from that list.
 */

import { useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
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
  Copy,
  Check,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
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
import { notifyModeration } from "@/lib/notifications";
import { toast } from "sonner";

function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

/** Route target for a peer's public profile: prefer handle, then user id, then peer id. */
function profilePathFor(username: string | null, userId: string | undefined, peerId: string): string {
  const key = username || (userId && userId.length > 0 ? userId : null) || peerId;
  return `/u/${encodeURIComponent(key)}`;
}

function formatSeen(date: Date): string {
  if (Number.isNaN(date.getTime())) return "unknown";
  if (Date.now() - date.getTime() < 60_000) return "just now";
  return formatDistanceToNow(date, { addSuffix: true });
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

  // Peer whose "more actions" menu is open. Controlled so touch taps can
  // open the menu on click (finger lifted) instead of Radix's pointerdown,
  // which made the finger release land on — and select — "Mute".
  const [openMenuPeerId, setOpenMenuPeerId] = useState<string | null>(null);
  const touchPointerRef = useRef(false);

  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopyPeerId = async (peerId: string) => {
    try {
      await navigator.clipboard.writeText(peerId);
      setCopiedId(peerId);
      toast.success("Peer ID copied");
      window.setTimeout(() => setCopiedId((current) => (current === peerId ? null : current)), 1500);
    } catch {
      toast.error("Could not copy peer ID");
    }
  };

  const handleBlock = (peerId: string) => {
    blockPeer(peerId, "all", "Blocked from connections panel");
    notifyModeration(`You blocked node ${peerId.slice(0, 12)}….`, "It can no longer connect to you.", "blockedNodes");
  };

  const handleMute = (peerId: string) => {
    const next = new Set(mutedNodes);
    if (next.has(peerId)) {
      next.delete(peerId);
    } else {
      next.add(peerId);
      notifyModeration(`You muted node ${peerId.slice(0, 12)}….`, "Its content is hidden from you.", "connectionLibrary");
    }
    setMutedNodes(next);
    saveSet(MUTED_NODES_KEY, next);
  };

  const handleHide = (peerId: string) => {
    const next = new Set(hiddenNodes);
    next.add(peerId);
    setHiddenNodes(next);
    saveSet(HIDDEN_NODES_KEY, next);
    notifyModeration(`You hid node ${peerId.slice(0, 12)}….`, "It no longer shows in your Connection Library.", "connectionLibrary");
  };

  const handleDisconnect = (peerId: string) => {
    disconnectFromPeer(peerId);
  };

  const handleConnect = (peerId: string) => {
    connectToPeer(peerId, { manual: true, source: "connections-panel" });
  };

  const handleUnhideAll = () => {
    const cleared = new Set<string>();
    setHiddenNodes(cleared);
    saveSet(HIDDEN_NODES_KEY, cleared);
  };

  const getQualityIcon = (rttMs: number | null | undefined, isConnected: boolean) => {
    if (!isConnected) return <SignalZero className="h-3.5 w-3.5 text-foreground/30" />;
    // Speed-based: convert RTT to speed 1-100
    const speed = rttMs != null ? Math.max(1, Math.min(100, Math.round(100 - Math.min(rttMs, 990) / 10))) : 80;
    if (speed >= 70) return <SignalHigh className="h-3.5 w-3.5 text-emerald-400" />;
    if (speed >= 40) return <Signal className="h-3.5 w-3.5 text-amber-400" />;
    if (speed >= 20) return <SignalLow className="h-3.5 w-3.5 text-orange-400" />;
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
    <Card id="connection-library" className="scroll-mt-24 p-3 sm:p-4 border-foreground/10 bg-card/60">
      <div className="space-y-3 sm:space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {connectedCount > 0 ? (
              <Wifi className="h-4 w-4 text-emerald-400" />
            ) : (
              <WifiOff className="h-4 w-4 text-foreground/40" />
            )}
            <span className="text-sm font-semibold tracking-wide truncate">
              {title ?? (isSwarmMode ? "Discovered Mesh Peers" : "Discovered Peer Inventory")}
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
          <div className="space-y-1.5 max-h-[28rem] overflow-y-auto sm:pr-1">
            {peers.map((peer) => {
              const username = peer.profile?.username ?? null;
              const label =
                peer.profile?.displayName ??
                (username ? username : null) ??
                (peer.userId && peer.userId !== peer.peerId ? peer.userId : null) ??
                "Unknown peer";
              const showHandle = Boolean(username) && username !== label;
              const isMuted = mutedNodes.has(peer.peerId);
              const lastSeen = new Date(peer.lastSeen);
              const profilePath = profilePathFor(username, peer.userId, peer.peerId);

              return (
                <div
                  key={peer.peerId}
                  className={`group flex items-start gap-2.5 p-2 sm:p-2.5 rounded-lg border transition-colors duration-150 ${
                    isMuted
                      ? "border-foreground/5 bg-foreground/[0.02] opacity-60"
                      : "border-foreground/10 bg-background/40 hover:border-foreground/20"
                  }`}
                >
                  <Link
                    to={profilePath}
                    className="relative shrink-0 rounded-full cursor-pointer transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    aria-label={`View ${label}'s profile`}
                  >
                    <Avatar
                      username={username ?? peer.peerId}
                      displayName={peer.profile?.displayName}
                      avatarRef={peer.profile?.avatarRef}
                      size="sm"
                    />
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-background ${
                        peer.isConnected ? "bg-emerald-400" : "bg-foreground/25"
                      }`}
                      aria-label={peer.isConnected ? "Connected" : "Discovered"}
                    />
                  </Link>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Link
                        to={profilePath}
                        className="text-sm font-medium truncate cursor-pointer hover:underline hover:text-primary focus:outline-none focus-visible:underline"
                        title={`View ${label}'s profile`}
                      >
                        {label}
                      </Link>
                      {showHandle && (
                        <span className="text-xs text-foreground/50 truncate">@{username}</span>
                      )}
                      {isMuted && <VolumeX className="h-3 w-3 text-foreground/30 shrink-0" />}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleCopyPeerId(peer.peerId)}
                      className="mt-0.5 inline-flex max-w-full items-center gap-1 rounded text-[0.65rem] font-mono text-foreground/50 hover:text-foreground/80 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                      title={`Copy peer ID ${peer.peerId}`}
                      aria-label="Copy peer ID"
                    >
                      <span className="truncate sm:hidden">{shortId(peer.peerId)}</span>
                      <span className="truncate hidden sm:inline">{peer.peerId}</span>
                      {copiedId === peer.peerId ? (
                        <Check className="h-3 w-3 shrink-0 text-emerald-400" />
                      ) : (
                        <Copy className="h-3 w-3 shrink-0" />
                      )}
                    </button>

                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.65rem] text-foreground/40">
                      <span>{peer.sharedCount} shared</span>
                      {peer.isConnected && peer.connection?.avgRttMs != null && (
                        <span className="text-foreground/50">
                          Trust {Math.round((peer.connection.avgRttMs < 200 ? 0.95 : peer.connection.avgRttMs < 500 ? 0.7 : 0.4) * 100)}%
                        </span>
                      )}
                      <span title={lastSeen.toLocaleString()}>Seen {formatSeen(lastSeen)}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 self-center">
                    <span className="hidden sm:inline-flex">{getQualityIcon(peer.connection?.avgRttMs, peer.isConnected)}</span>
                    <span className="hidden sm:inline-flex">{getConnectionBadge(peer.isConnected)}</span>

                    <Button
                      variant={peer.isConnected ? "outline" : "default"}
                      size="sm"
                      className="h-8 w-8 p-0 sm:w-auto sm:px-3"
                      onClick={() => peer.isConnected ? handleDisconnect(peer.peerId) : handleConnect(peer.peerId)}
                      aria-label={peer.isConnected ? "Disconnect" : "Connect"}
                      title={peer.isConnected ? "Disconnect" : "Connect"}
                    >
                      {peer.isConnected ? <Unplug className="h-3.5 w-3.5 sm:mr-1" /> : <Plug className="h-3.5 w-3.5 sm:mr-1" />}
                      <span className="hidden sm:inline">{peer.isConnected ? "Disconnect" : "Connect"}</span>
                    </Button>

                    <DropdownMenu
                      open={openMenuPeerId === peer.peerId}
                      onOpenChange={(open) =>
                        setOpenMenuPeerId((current) => (open ? peer.peerId : current === peer.peerId ? null : current))
                      }
                    >
                      <DropdownMenuTrigger
                        asChild
                        onPointerDown={(event) => {
                          // Touch/pen: skip Radix's open-on-pointerdown so the
                          // lifting finger can't ghost-select a menu item.
                          touchPointerRef.current = event.pointerType !== "mouse";
                          if (touchPointerRef.current) event.preventDefault();
                        }}
                        onClick={() => {
                          if (!touchPointerRef.current) return;
                          touchPointerRef.current = false;
                          setOpenMenuPeerId((current) => (current === peer.peerId ? null : peer.peerId));
                        }}
                      >
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-10 w-10 sm:h-8 sm:w-7 p-0 touch-manipulation sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 transition-opacity"
                          aria-label="More actions"
                        >
                          <MoreVertical className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem onClick={() => handleCopyPeerId(peer.peerId)}>
                          <Copy className="h-3.5 w-3.5 mr-2" />
                          Copy peer ID
                        </DropdownMenuItem>
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
