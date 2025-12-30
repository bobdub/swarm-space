import { useState, useEffect } from "react";
import { Wifi, WifiOff, Loader2, Copy, AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Badge } from "./ui/badge";
import { Progress } from "./ui/progress";
import { useP2PContext } from "@/contexts/P2PContext";
import { useAuth } from "@/hooks/useAuth";
import { getFeatureFlags, setFeatureFlag } from "@/config/featureFlags";
import { getKnownNodeIds, getKnownPeerIds } from "@/lib/p2p/knownPeers";

function formatBandwidth(bytesUploaded: number, bytesDownloaded: number, uptimeMs: number): string {
  if (!Number.isFinite(uptimeMs) || uptimeMs <= 0) {
    return "—";
  }
  const uptimeSeconds = uptimeMs / 1000;
  if (uptimeSeconds <= 0) {
    return "—";
  }
  const bitsTransferred = (bytesUploaded + bytesDownloaded) * 8;
  const kbps = bitsTransferred / uptimeSeconds / 1000;
  if (kbps <= 0) {
    return "—";
  }
  if (kbps >= 1000) {
    const mbps = kbps / 1000;
    return `${mbps >= 10 ? mbps.toFixed(0) : mbps.toFixed(1)} Mbps`;
  }
  return `${kbps.toFixed(0)} kbps`;
}

function getStatusIcon(isEnabled: boolean, isConnecting: boolean, status: "offline" | "waiting" | "online" | "connecting"): JSX.Element {
  if (!isEnabled) {
    return <WifiOff className="h-5 w-5" />;
  }
  if (isConnecting || status === "connecting") {
    return <Loader2 className="h-5 w-5 animate-spin" />;
  }
  return <Wifi className="h-5 w-5" />;
}

function getStatusColor(isEnabled: boolean, isConnecting: boolean, status: "offline" | "waiting" | "online" | "connecting"): string {
  if (!isEnabled) {
    return "text-muted-foreground";
  }
  if (isConnecting || status === "connecting") {
    return "text-yellow-500";
  }
  if (status === "online") {
    return "text-green-500";
  }
  if (status === "waiting") {
    return "text-blue-500";
  }
  return "text-muted-foreground";
}

export function P2PStatusIndicator() {
  const {
    isEnabled,
    isConnecting,
    stats,
    activeSignalingEndpoint,
    enable,
    disable,
    getPeerId,
    connectToPeer,
    disconnectFromPeer,
    controls,
    isPeerBlocked,
    getConnectionHealthSummary,
    getDiscoveredPeers,
    getActivePeerConnections,
    openNodeDashboard,
  } = useP2PContext();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [remotePeerId, setRemotePeerId] = useState("");
  const [pendingPeers, setPendingPeers] = useState<Record<string, "connect" | "disconnect">>({});
  const [flags, setFlags] = useState(getFeatureFlags());
  const peerId = getPeerId();

  useEffect(() => {
    const interval = setInterval(() => {
      setFlags(getFeatureFlags());
    }, 500);
    return () => clearInterval(interval);
  }, []);

  const connectionSummary = getConnectionHealthSummary();

  const connectionStrength = connectionSummary.total > 0
    ? connectionSummary.healthy / connectionSummary.total
    : 0;
  const connectionStrengthPercent = Math.round(connectionStrength * 100);
  const handshakeConfidencePercent = Math.round(connectionSummary.handshakeConfidence * 100);
  const connectionStrengthLabel = !isEnabled
    ? "Offline"
    : connectionStrengthPercent >= 80
      ? "Strong"
      : connectionStrengthPercent >= 50
        ? "Fair"
        : connectionStrengthPercent > 0
          ? "Weak"
          : "No peers";

  const connectionFailureRate = stats.connectionAttempts > 0
    ? stats.failedConnectionAttempts / stats.connectionAttempts
    : 0;
  const isMeshDegraded = isEnabled && (
    connectionFailureRate > 0.4 ||
    stats.rendezvousFailureStreak > 0 ||
    (stats.lastBeaconLatencyMs ?? 0) > 10_000 ||
    handshakeConfidencePercent < 40
  );

  const endpointLabel = activeSignalingEndpoint?.label
    ?? activeSignalingEndpoint?.host
    ?? stats.signalingEndpointLabel
    ?? null;

  const statusText = (() => {
    if (!user) {
      return "Create an account to enable peer-to-peer networking.";
    }
    if (!isEnabled) {
      return "P2P networking is disabled.";
    }
    if (isConnecting) {
      return "Negotiating with configured signaling endpoints...";
    }
    if (stats.status === "online") {
      return stats.connectedPeers > 0
        ? `Connected to ${stats.connectedPeers} peer${stats.connectedPeers === 1 ? "" : "s"}.`
        : "Online – waiting for peers.";
    }
    if (stats.status === "waiting") {
      return "Ready – awaiting rendezvous results.";
    }
    return "Attempting to establish connectivity.";
  })();

  const summaryItems = [
    { label: "Connected", value: stats.connectedPeers.toString() },
    { label: "Discovered", value: stats.discoveredPeers.toString() },
    { label: "Network content", value: stats.networkContent.toString() },
    {
      label: "Bandwidth",
      value: formatBandwidth(stats.bytesUploaded, stats.bytesDownloaded, stats.metrics.uptimeMs),
    },
  ];

  const handleToggle = () => {
    if (!user) {
      navigate("/settings");
      return;
    }

    if (isConnecting) {
      disable();
      toast.info("Connection cancelled");
      return;
    }

    if (isEnabled) {
      disable();
    } else {
      if (controls.paused) {
        toast.info("Mesh paused", {
          description: "Resume the mesh controls from the dashboard to reconnect.",
        });
      }
      void enable();
    }
  };

  const handleCopyPeerId = () => {
    if (peerId) {
      navigator.clipboard.writeText(peerId);
      toast.success("Peer ID copied to clipboard!");
    }
  };

  const discoveredPeers = getDiscoveredPeers()
    .slice()
    .sort((a, b) => {
      const aTime = a.lastSeen instanceof Date ? a.lastSeen.getTime() : new Date(a.lastSeen).getTime();
      const bTime = b.lastSeen instanceof Date ? b.lastSeen.getTime() : new Date(b.lastSeen).getTime();
      return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
    });

  const connectedPeerIds = new Set(
    getActivePeerConnections().map((connection) => connection.peerId),
  );

  const quickPeers = discoveredPeers.slice(0, 6);

  const setPeerPending = (peerId: string, action: "connect" | "disconnect") => {
    setPendingPeers((current) => ({ ...current, [peerId]: action }));
  };

  const clearPeerPending = (peerId: string) => {
    setPendingPeers((current) => {
      const { [peerId]: _action, ...rest } = current;
      return rest;
    });
  };

  const handleConnectToPeer = () => {
    if (!remotePeerId.trim()) {
      return;
    }

    if (!isEnabled) {
      toast.info("Enable P2P first", {
        description: "Turn on P2P networking to dial peers.",
      });
      return;
    }

    if (isPeerBlocked(remotePeerId.trim())) {
      toast.info("Connection blocked", {
        description: "This peer is currently blocked. Adjust blocks from the dashboard.",
      });
      return;
    }

    const success = connectToPeer(remotePeerId.trim(), { manual: true, source: "manual" });
    if (success) {
      toast.success(`Connecting to ${remotePeerId.slice(0, 8)}…`);
      setRemotePeerId("");
    } else if (controls.paused) {
      toast.info("Mesh paused", {
        description: "Resume the mesh to allow new connections.",
      });
    } else {
      toast.info("Connection pending", {
        description: "Check mesh controls or pending approvals in the dashboard.",
      });
    }
  };

  const handleQuickConnect = (peerId: string, label: string) => {
    const trimmedPeerId = peerId.trim();
    if (!isEnabled) {
      toast.info("Enable P2P first", {
        description: "Turn on P2P networking to dial peers.",
      });
      return;
    }

    if (isPeerBlocked(trimmedPeerId)) {
      toast.info("Connection blocked", {
        description: "This peer is currently blocked. Adjust blocks from the dashboard.",
      });
      return;
    }

    setPeerPending(peerId, "connect");
    const success = connectToPeer(trimmedPeerId, { manual: true, source: "popover-quick-connect" });
    if (success) {
      toast.success(`Connecting to ${label.slice(0, 24)}…`);
    } else if (controls.paused) {
      toast.info("Mesh paused", {
        description: "Resume the mesh to allow new connections.",
      });
    } else {
      toast.info("Connection pending", {
        description: "Check mesh controls or pending approvals in the dashboard.",
      });
    }
    clearPeerPending(peerId);
  };

  const handleQuickDisconnect = (peerId: string, label: string) => {
    const trimmedPeerId = peerId.trim();
    setPeerPending(peerId, "disconnect");
    disconnectFromPeer(trimmedPeerId);
    toast.info(`Disconnecting ${label.slice(0, 24)}…`);
    clearPeerPending(peerId);
  };

  const formatLastSeen = (date: Date) => {
    try {
      return formatDistanceToNow(date, { addSuffix: true });
    } catch (error) {
      console.warn("[P2PStatusIndicator] Failed to format last seen distance", error);
      return "moments ago";
    }
  };

  const handleViewDashboard = () => {
    openNodeDashboard();
  };

  const handleToggleTransport = () => {
    const currentMode = flags.integratedTransport;
    setFeatureFlag('integratedTransport', !currentMode);
    setFlags(getFeatureFlags());
    toast.success(`Switched to ${!currentMode ? 'Integrated Resilient' : 'PeerJS'} transport`);
  };

  const isSwarmMeshMode = flags.swarmMeshMode;
  const networkTitle = isSwarmMeshMode ? "SWARM Mesh" : "P2P Network";
  const transportLabel = flags.integratedTransport ? "Integrated" : "PeerJS";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          data-testid="p2p-status-trigger"
        >
          <div className={getStatusColor(isEnabled, isConnecting, stats.status)}>
            {getStatusIcon(isEnabled, isConnecting, stats.status)}
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 max-w-[calc(100vw-2rem)] p-0" align="end">
          <div className="space-y-4 p-4 max-h-[min(34rem,calc(100vh-8rem))] overflow-y-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold">{networkTitle}</h3>
              {!isSwarmMeshMode && (
                <Badge 
                  variant="default" 
                  className="text-xs cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={handleToggleTransport}
                  title="Click to toggle transport mode"
                >
                  🌐 {transportLabel}
                </Badge>
              )}
              {isMeshDegraded && (
                <Badge variant="destructive" className="text-xs flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  Degraded
                </Badge>
              )}
            </div>
            <Button
              size="sm"
              variant={!user ? "default" : isEnabled ? "outline" : "default"}
              onClick={handleToggle}
            >
              {isConnecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Cancel
                </>
              ) : !user ? (
                "Create Account"
              ) : isEnabled ? (
                "Disable"
              ) : (
                "Enable"
              )}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">{statusText}</p>

          <div className="rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Connection strength</p>
              <Badge variant="outline" className="text-[10px] uppercase">
                {connectionStrengthLabel}
              </Badge>
            </div>
            <Progress
              value={isEnabled ? connectionStrengthPercent : 0}
              className="mt-3 h-2"
              aria-label="Connection strength"
            />
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Healthy peers {connectionSummary.healthy}/{connectionSummary.total}
              </span>
              <span>Handshake confidence {handshakeConfidencePercent}%</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-lg border p-3 text-sm">
            {summaryItems.map((item) => (
              <div key={item.label} className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{item.label}</p>
                <p className="font-semibold text-foreground">{item.value}</p>
              </div>
            ))}
          </div>

              <div>
                <p className="text-sm font-semibold">Your node</p>
                {peerId ? (
                  <div className="flex items-center gap-2">
                    <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-xs font-mono">
                      {peerId}
                    </code>
                    <Button variant="outline" size="icon" className="h-8 w-8" onClick={handleCopyPeerId}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Peer ID assigned once P2P is enabled.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {isSwarmMeshMode
                    ? 'Unified mesh with distributed routing & blockchain integration'
                    : `Signaling: ${endpointLabel ?? "No active endpoint"}`}
                </p>
              </div>

          <div className="rounded-lg border p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Connect to user</p>
                <p className="text-xs text-muted-foreground">
                  Dial a known peer ID to bootstrap a manual mesh link.
                </p>
              </div>
              <Button
                size="sm"
                variant="default"
                onClick={() => {
                  if (!isEnabled) {
                    toast.info("Enable P2P first", {
                      description: "Turn on P2P networking to connect.",
                    });
                    return;
                  }
                  // Trigger auto-connect mechanism
                  const knownPeerIds = flags.swarmMeshMode ? getKnownNodeIds() : getKnownPeerIds();
                  let attempted = 0;
                  knownPeerIds.forEach(peerId => {
                    if (!connectedPeerIds.has(peerId) && !isPeerBlocked(peerId)) {
                      connectToPeer(peerId, { source: 'quick-connect-button' });
                      attempted++;
                    }
                  });
                  if (attempted > 0) {
                    toast.success(`Quick connecting to ${attempted} peer${attempted === 1 ? '' : 's'}...`);
                  } else {
                    toast.info("Already connected to known peers");
                  }
                }}
                disabled={!isEnabled}
              >
                Quick Connect
              </Button>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                value={remotePeerId}
                onChange={(event) => setRemotePeerId(event.target.value)}
                placeholder="peer-id-1234"
                className="font-mono text-xs"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    handleConnectToPeer();
                  }
                }}
              />
              <Button
                size="sm"
                onClick={handleConnectToPeer}
                disabled={!remotePeerId.trim()}
              >
                Connect
              </Button>
            </div>
          </div>

          <div className="rounded-lg border p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">Discovered peers</p>
                <p className="text-xs text-muted-foreground">
                  Quickly reconnect to recently seen nodes.
                </p>
              </div>
              <Badge variant="outline" className="text-[10px] uppercase">
                {discoveredPeers.length}
              </Badge>
            </div>
            {quickPeers.length === 0 ? (
              <p className="text-xs text-muted-foreground">No peers discovered yet.</p>
            ) : (
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {quickPeers.map((peer) => {
                  const friendlyLabel = peer.profile?.displayName
                    ?? peer.profile?.username
                    ?? peer.userId
                    ?? peer.peerId;
                  const lastSeenDate = peer.lastSeen instanceof Date ? peer.lastSeen : new Date(peer.lastSeen);
                  const lastSeenLabel = formatLastSeen(lastSeenDate);
                  const availableCount = peer.availableContent?.size ?? 0;
                  const isConnected = connectedPeerIds.has(peer.peerId);
                  const pendingAction = pendingPeers[peer.peerId];
                  const buttonDisabled = Boolean(pendingAction);

                  return (
                    <div
                      key={peer.peerId}
                      className="flex items-start justify-between gap-3 rounded-md border border-border/40 bg-background/60 p-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate" title={friendlyLabel}>
                          {friendlyLabel}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {isConnected ? "Connected now" : `Seen ${lastSeenLabel}`}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {availableCount} shared {availableCount === 1 ? "item" : "items"}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant={isConnected ? "outline" : "default"}
                        onClick={() => {
                          if (isConnected) {
                            handleQuickDisconnect(peer.peerId, friendlyLabel);
                          } else {
                            handleQuickConnect(peer.peerId, friendlyLabel);
                          }
                        }}
                        disabled={buttonDisabled}
                      >
                        {pendingAction ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {pendingAction === "connect" ? "Connecting" : "Disconnecting"}
                          </>
                        ) : isConnected ? (
                          "Disconnect"
                        ) : (
                          "Connect"
                        )}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <Button variant="secondary" className="w-full" onClick={handleViewDashboard}>
            View Node Dashboard
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
