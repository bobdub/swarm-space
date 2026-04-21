import { useState, useEffect, useCallback } from "react";
import { Wifi, WifiOff, Loader2, Copy, AlertTriangle, User } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { getGlobalCell } from "@/lib/p2p/globalCell";

import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Badge } from "./ui/badge";
import { Progress } from "./ui/progress";
import { useP2PContext } from "@/contexts/P2PContext";
import { useAuth } from "@/hooks/useAuth";
import { getFeatureFlags, setFeatureFlag } from "@/config/featureFlags";
import { getKnownNodeIds, getKnownPeerIds } from "@/lib/p2p/knownPeers";
import { NetworkModeToggle } from "./NetworkModeToggle";
import { isValidNetworkId } from "@/lib/p2p/idResolver";
import {
  BootstrapFallbackMonitor,
  BOOTSTRAP_FAILED_EVENT,
  BOOTSTRAP_RECOVERED_EVENT,
} from "@/lib/p2p/bootstrapFallback";
import { getTestMode, type TestModePhase } from "@/lib/p2p/testMode.standalone";
import { getSwarmMeshStandalone, type SwarmPhase } from "@/lib/p2p/swarmMesh.standalone";
import { getStandaloneBuilderMode, type BuilderPhase } from "@/lib/p2p/builderMode.standalone";
import { loadConnectionState } from "@/lib/p2p/connectionState";

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

function getStatusIcon(isEnabled: boolean, isConnecting: boolean, status: "offline" | "waiting" | "online" | "connecting", testPhase: TestModePhase, swarmPhase: SwarmPhase, builderPhase: BuilderPhase): JSX.Element {
  if (swarmPhase === 'online' || testPhase === 'online' || builderPhase === 'online') return <Wifi className="h-5 w-5" />;
  if (swarmPhase === 'connecting' || swarmPhase === 'reconnecting' || testPhase === 'connecting' || testPhase === 'reconnecting' || builderPhase === 'connecting') return <Loader2 className="h-5 w-5 animate-spin" />;
  if (builderPhase === 'reconnecting' || builderPhase === 'failed') return <WifiOff className="h-5 w-5" />;

  if (!isEnabled && testPhase === 'off' && swarmPhase === 'off' && builderPhase === 'off') {
    return <WifiOff className="h-5 w-5" />;
  }
  if (isConnecting || status === "connecting") {
    return <Loader2 className="h-5 w-5 animate-spin" />;
  }
  return <Wifi className="h-5 w-5" />;
}

function getStatusColor(isEnabled: boolean, isConnecting: boolean, status: "offline" | "waiting" | "online" | "connecting", testPhase: TestModePhase, swarmPhase: SwarmPhase, builderPhase: BuilderPhase): string {
  if (swarmPhase === 'online' || testPhase === 'online' || builderPhase === 'online') return "text-green-500";
  if (swarmPhase === 'connecting' || swarmPhase === 'reconnecting' || testPhase === 'connecting' || testPhase === 'reconnecting' || builderPhase === 'connecting') return "text-yellow-500";
  if (builderPhase === 'reconnecting') return "text-amber-500";
  if (swarmPhase === 'failed' || testPhase === 'failed' || builderPhase === 'failed') return "text-destructive";

  if (!isEnabled && testPhase === 'off' && swarmPhase === 'off' && builderPhase === 'off') {
    return "text-muted-foreground";
  }
  if (isConnecting || status === "connecting") return "text-yellow-500";
  if (status === "online") return "text-green-500";
  if (status === "waiting") return "text-blue-500";
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

  // Test Mode + SwarmMesh + BuilderMode integration
  const [testPhase, setTestPhase] = useState<TestModePhase>('off');
  const [swarmPhase, setSwarmPhase] = useState<SwarmPhase>('off');
  const [builderPhase, setBuilderPhase] = useState<BuilderPhase>('off');
  const isRetryingBuilderSignaling = builderPhase === 'reconnecting';
  const isModeConnecting = isConnecting
    || testPhase === 'connecting'
    || testPhase === 'reconnecting'
    || swarmPhase === 'connecting'
    || swarmPhase === 'reconnecting'
    || builderPhase === 'connecting';
  const isCancelableConnectionState = isModeConnecting || isRetryingBuilderSignaling;

  useEffect(() => {
    const tm = getTestMode();
    const sm = getSwarmMeshStandalone();
    const bm = getStandaloneBuilderMode();
    const u1 = tm.onPhaseChange(setTestPhase);
    const u2 = sm.onPhaseChange(setSwarmPhase);
    const u3 = bm.onPhaseChange(setBuilderPhase);
    return () => { u1(); u2(); u3(); };
  }, []);

  const [bootstrapFailed, setBootstrapFailed] = useState(false);
  const [fallbackId, setFallbackId] = useState("");
  const [fallbackConnecting, setFallbackConnecting] = useState(false);
  const [cellCountdown, setCellCountdown] = useState(0);

  // Tick the cell countdown every second when online with zero peers
  useEffect(() => {
    if (!isEnabled || stats.connectedPeers > 0) {
      setCellCountdown(0);
      return;
    }
    const cell = getGlobalCell();
    if (!cell.isRunning()) return;

    const tick = () => setCellCountdown(cell.getNextBeaconInSeconds());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [isEnabled, stats.connectedPeers, swarmPhase]);

  // Listen for bootstrap fallback events
  useEffect(() => {
    const handleFailed = () => setBootstrapFailed(true);
    const handleRecovered = () => setBootstrapFailed(false);
    window.addEventListener(BOOTSTRAP_FAILED_EVENT, handleFailed);
    window.addEventListener(BOOTSTRAP_RECOVERED_EVENT, handleRecovered);
    return () => {
      window.removeEventListener(BOOTSTRAP_FAILED_EVENT, handleFailed);
      window.removeEventListener(BOOTSTRAP_RECOVERED_EVENT, handleRecovered);
    };
  }, []);

  // Clear fallback when peers connect
  useEffect(() => {
    if (stats.connectedPeers > 0 && bootstrapFailed) {
      setBootstrapFailed(false);
    }
  }, [stats.connectedPeers, bootstrapFailed]);

  // Arm bootstrap fallback monitor whenever SWARM is enabled with zero peers.
  useEffect(() => {
    const connState = loadConnectionState();
    if (!isEnabled || connState.mode !== 'swarm') {
      setBootstrapFailed(false);
      return;
    }

    if (getActivePeerConnections().length > 0) {
      setBootstrapFailed(false);
      return;
    }

    const monitor = new BootstrapFallbackMonitor({
      getPeerCount: () => getActivePeerConnections().length,
      connectPeer: (id) => connectToPeer(id, { manual: true, source: 'bootstrap-fallback' }),
      enable,
      disable,
      isOnline: () => isEnabled,
      attemptedNodes: getKnownPeerIds().length,
      timeoutMs: connState.mode === 'swarm' ? 60_000 : undefined,
    });

    monitor.start();
    return () => {
      monitor.stop();
    };
  }, [isEnabled, getActivePeerConnections, connectToPeer, enable, disable]);

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
    if (builderPhase === 'failed') {
      return "Signaling is offline. Re-enable networking to retry or configure another endpoint.";
    }
    if (isRetryingBuilderSignaling) {
      return "Signaling is unreachable — retrying in the background.";
    }
    if (isModeConnecting) {
      return "Negotiating with configured signaling endpoints...";
    }
    if (stats.status === "online") {
      if (stats.connectedPeers > 0) {
        return `Connected to ${stats.connectedPeers} peer${stats.connectedPeers === 1 ? "" : "s"}.`;
      }
      return cellCountdown > 0
        ? `Waiting in cell, next announcement in ${cellCountdown}s.`
        : "Online – announcing presence…";
    }
    if (stats.status === "waiting") {
      return "Ready – awaiting rendezvous results.";
    }
    return "Attempting to establish connectivity.";
  })();

  const discoveredPeers = getDiscoveredPeers()
    .slice()
    .sort((a, b) => {
      const aTime = a.lastSeen instanceof Date ? a.lastSeen.getTime() : new Date(a.lastSeen).getTime();
      const bTime = b.lastSeen instanceof Date ? b.lastSeen.getTime() : new Date(b.lastSeen).getTime();
      return (Number.isNaN(bTime) ? 0 : bTime) - (Number.isNaN(aTime) ? 0 : aTime);
    });

  const activeConnections = getActivePeerConnections();
  const connectedPeerIds = new Set(
    activeConnections.map((connection) => connection.peerId),
  );

  // Live peers: currently connected OR seen within the cell freshness window (75s)
  const LIVE_PEER_WINDOW_MS = 75_000;
  const now = Date.now();
  const livePeers = discoveredPeers.filter((peer) => {
    if (connectedPeerIds.has(peer.peerId)) return true;
    const seenMs = peer.lastSeen instanceof Date ? peer.lastSeen.getTime() : new Date(peer.lastSeen).getTime();
    if (Number.isNaN(seenMs)) return false;
    return now - seenMs <= LIVE_PEER_WINDOW_MS;
  });

  // Suppress destructive "no nodes" alert while we're still searching/connecting in the cell.
  const isSearchingForCell =
    isModeConnecting ||
    isConnecting ||
    cellCountdown > 0;

  // Show user's own post count (localContent) vs total network content
  const summaryItems = [
    { label: "Connected", value: activeConnections.length.toString() },
    { label: "Discovered", value: discoveredPeers.length.toString() },
    { label: "Your posts", value: stats.localContent.toString() },
    { label: "Network", value: stats.networkContent.toString() },
  ];

  const scheduleReachabilityToast = useCallback((targetId: string, label: string, onDone?: () => void) => {
    const trimmed = targetId.trim();
    if (!trimmed) {
      onDone?.();
      return;
    }

    const normalized = trimmed.startsWith('peer-') ? trimmed : `peer-${trimmed}`;
    const mode = loadConnectionState().mode;
    const deadline = Date.now() + (mode === 'builder' ? 12_000 : 8_000);

    const check = () => {
      const active = getActivePeerConnections().map((connection) => connection.peerId);
      const reached = active.some((peerId) => peerId === trimmed || peerId === normalized);

      if (reached) {
        toast.success(`Connected to ${label}`);
        onDone?.();
        return;
      }

      if (Date.now() >= deadline) {
        toast.warning(`${label} not reached yet`, {
          description: mode === 'builder'
            ? 'Peer did not respond yet. Confirm both peers are online in Builder Mode and retry.'
            : 'Peer did not respond yet. You can retry or connect from Node Dashboard.',
        });
        onDone?.();
        return;
      }

      window.setTimeout(check, 900);
    };

    window.setTimeout(check, 900);
  }, [getActivePeerConnections]);

  const quickPeers = livePeers.slice(0, 6);

  const setPeerPending = (peerId: string, action: "connect" | "disconnect") => {
    setPendingPeers((current) => ({ ...current, [peerId]: action }));
  };

  const clearPeerPending = (peerId: string) => {
    setPendingPeers((current) => {
      const { [peerId]: _action, ...rest } = current;
      return rest;
    });
  };

  const handleFallbackConnect = useCallback(async () => {
    if (!fallbackId.trim() || !isValidNetworkId(fallbackId)) {
      toast.error("Invalid ID", { description: "Enter a valid 16-char Node ID or peer-xxx Peer ID." });
      return;
    }
    setFallbackConnecting(true);
    try {
      const monitor = new BootstrapFallbackMonitor({
        getPeerCount: () => getActivePeerConnections().length,
        connectPeer: (id) => connectToPeer(id, { manual: true, source: "bootstrap-fallback" }),
        enable,
        disable,
        isOnline: () => isEnabled,
      });
      const result = await monitor.handleManualConnect(fallbackId);
      if (result.success) {
        toast.success(
          result.modeSwitched
            ? `Mode switched & connecting to ${fallbackId.slice(0, 12)}…`
            : `Connecting to ${fallbackId.slice(0, 12)}…`
        );
        setFallbackId("");
        setBootstrapFailed(false);
      } else {
        toast.error("Connection failed", { description: result.error ?? "Could not reach peer." });
      }
    } finally {
      setFallbackConnecting(false);
    }
  }, [fallbackId, getActivePeerConnections, connectToPeer, enable, disable, isEnabled]);

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

    const input = remotePeerId.trim();
    const success = connectToPeer(input, { manual: true, source: "manual" });
    if (success) {
      toast.info(`Dialing ${input.slice(0, 16)}…`);
      scheduleReachabilityToast(input, input.slice(0, 16));
      setRemotePeerId("");
    } else if (controls.paused) {
      toast.info("Mesh paused", {
        description: "Resume the mesh to allow new connections.",
      });
    } else if (loadConnectionState().mode === 'builder') {
      toast.info("Builder is not online", {
        description: "Enable Builder Mode and retry once signaling is connected.",
      });
    } else {
      toast.info("Connection pending", {
        description: "Check mesh controls or pending approvals in the dashboard.",
      });
    }
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

  const handleToggle = () => {
    if (!user) { navigate("/settings"); return; }

    const tm = getTestMode();
    const sm = getSwarmMeshStandalone();
    const bm = getStandaloneBuilderMode();
    const connState = loadConnectionState();

    if (isEnabled) {
      disable();
      tm.stop();
      sm.stop();
      bm.stop();
      toast.info("P2P networking disabled.");
    } else {
      if (connState.mode === 'swarm') {
        void sm.start();
        void enable();
      } else {
        enable();
        void bm.autoStart();
      }
      toast.success("P2P networking enabled.");
    }
  };

  const handleCopyPeerId = () => {
    if (peerId) {
      navigator.clipboard.writeText(peerId).then(() => {
        toast.success("Peer ID copied to clipboard.");
      });
    }
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
          <div className={getStatusColor(isEnabled, isConnecting, stats.status, testPhase, swarmPhase, builderPhase)}>
            {getStatusIcon(isEnabled, isConnecting, stats.status, testPhase, swarmPhase, builderPhase)}
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 max-w-[calc(100vw-2rem)] p-0" align="end">
          <div className="space-y-4 p-4 max-h-[min(34rem,calc(100vh-8rem))] overflow-y-auto">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-wrap min-w-0">
              <h3 className="font-semibold">{networkTitle}</h3>
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
              {isModeConnecting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Cancel
                </>
              ) : isRetryingBuilderSignaling ? (
                <>
                  <WifiOff className="mr-2 h-4 w-4" />
                  Retrying
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

          {/* Mode switcher */}
          <NetworkModeToggle variant="compact" className="w-full justify-center" />

          <p className="text-xs text-muted-foreground">{statusText}</p>

          {/* Your node (moved above Connection strength) */}
          <div className="rounded-lg border p-3 space-y-2">
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
                ? 'Unified mesh with distributed routing, discovered-peer inventory, and blockchain integration'
                : `Signaling: ${endpointLabel ?? "No active endpoint"}`}
            </p>
          </div>

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
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>Healthy</span>
                <span className="font-medium text-foreground">{connectionSummary.healthy}/{connectionSummary.total}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Handshake</span>
                <span className="font-medium text-foreground">{handshakeConfidencePercent}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Trust</span>
                <span className="font-medium text-foreground">{Math.round((connectionSummary.avgTrust ?? 0) * 100)}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Bandwidth</span>
                <span className="font-medium text-foreground">{formatBandwidth(stats.bytesUploaded, stats.bytesDownloaded, stats.uptimeMs)}</span>
              </div>
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

          {/* ── Bootstrap Fallback Alert ──────────────────────────── */}
          {bootstrapFailed && isEnabled && stats.connectedPeers === 0 && discoveredPeers.length === 0 && !isSearchingForCell && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 space-y-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
                <p className="text-sm font-semibold text-destructive">No verified nodes online</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Enter a Node ID or Peer ID to connect manually via the Node Dashboard.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={fallbackId}
                  onChange={(e) => setFallbackId(e.target.value)}
                  placeholder="Node ID or peer-xxx"
                  className="font-mono text-xs"
                  onKeyDown={(e) => { if (e.key === "Enter") handleFallbackConnect(); }}
                />
                <Button
                  size="sm"
                  onClick={handleFallbackConnect}
                  disabled={!fallbackId.trim() || fallbackConnecting}
                >
                  {fallbackConnecting ? (
                    <><Loader2 className="h-4 w-4 animate-spin mr-1" />Connecting</>
                  ) : (
                    "Connect"
                  )}
                </Button>
              </div>
            </div>
          )}

          {/* Softer alert when library peers exist but none connected yet */}
          {bootstrapFailed && isEnabled && stats.connectedPeers === 0 && discoveredPeers.length > 0 && (
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1">
              <p className="text-sm font-semibold text-foreground">Connecting to known peers…</p>
              <p className="text-xs text-muted-foreground">
                {discoveredPeers.length} peer{discoveredPeers.length === 1 ? '' : 's'} in your contact list.
                Retrying automatically — or tap a peer below to connect manually.
              </p>
            </div>
          )}

          {!(bootstrapFailed && isEnabled && stats.connectedPeers === 0 && discoveredPeers.length === 0) && (
          <div className="rounded-lg border p-3 space-y-3">
            <div>
              <p className="text-sm font-semibold">Connect to user</p>
              <p className="text-xs text-muted-foreground">
                Dial a known peer ID to bootstrap a manual mesh link.
              </p>
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
          )}

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
                  const displayName = peer.profile?.displayName ?? null;
                  const username = peer.profile?.username ?? null;
                  const friendlyLabel = displayName ?? username ?? peer.userId ?? peer.peerId;
                  const lastSeenDate = peer.lastSeen instanceof Date ? peer.lastSeen : new Date(peer.lastSeen);
                  const lastSeenLabel = formatLastSeen(lastSeenDate);
                  const availableCount = peer.availableContent?.size ?? 0;
                  const isConnected = connectedPeerIds.has(peer.peerId);
                  const pendingAction = pendingPeers[peer.peerId];
                  const buttonDisabled = Boolean(pendingAction);

                  return (
                    <div
                      key={peer.peerId}
                      className="flex items-start gap-2.5 rounded-md border border-border/40 bg-background/60 p-2"
                    >
                      {/* Avatar / icon */}
                      <div className="shrink-0 mt-0.5">
                        {peer.profile?.avatarRef ? (
                          <img
                            src={peer.profile.avatarRef}
                            alt=""
                            className="h-8 w-8 rounded-full object-cover border border-border/30"
                          />
                        ) : (
                          <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center border border-border/30">
                            <User className="h-4 w-4 text-muted-foreground" />
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-semibold truncate" title={friendlyLabel}>
                            {friendlyLabel}
                          </p>
                          {username && displayName && (
                            <span className="text-[11px] text-muted-foreground truncate">@{username}</span>
                          )}
                        </div>
                        <code className="block text-[10px] font-mono text-muted-foreground truncate" title={peer.peerId}>
                          {peer.peerId}
                        </code>
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span>{isConnected ? "Connected now" : `Seen ${lastSeenLabel}`}</span>
                          <span>·</span>
                          <span>{availableCount} shared</span>
                        </div>
                      </div>

                      {/* Action */}
                      <Button
                        size="sm"
                        variant={isConnected ? "outline" : "default"}
                        className="shrink-0 self-center"
                        onClick={() => {
                          if (isConnected) {
                            handleQuickDisconnect(peer.peerId, friendlyLabel);
                          } else {
                            const trimmed = peer.peerId.trim();
                            if (!isEnabled) {
                              toast.info("Enable P2P first");
                              return;
                            }
                            if (isPeerBlocked(trimmed)) {
                              toast.info("This peer is blocked");
                              return;
                            }
                            setPeerPending(peer.peerId, "connect");
                            const ok = connectToPeer(trimmed, { manual: true, source: "popover-discovered" });
                            if (ok) {
                              toast.info(`Dialing ${friendlyLabel.slice(0, 24)}…`);
                              scheduleReachabilityToast(trimmed, friendlyLabel.slice(0, 24), () => clearPeerPending(peer.peerId));
                            } else {
                              clearPeerPending(peer.peerId);
                            }
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
