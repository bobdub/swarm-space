import { useState } from "react";
import { Wifi, WifiOff, Loader2, Copy, AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { Badge } from "./ui/badge";
import { Progress } from "./ui/progress";
import { useP2PContext } from "@/contexts/P2PContext";
import { useAuth } from "@/hooks/useAuth";

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

function getStatusColor(isEnabled: boolean, isConnecting: boolean, status: "offline" | "waiting" | "online"): string {
  if (!isEnabled) {
    return "text-muted-foreground";
  }
  if (isConnecting) {
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
    controls,
    isPeerBlocked,
    getConnectionHealthSummary,
    openNodeDashboard,
  } = useP2PContext();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [remotePeerId, setRemotePeerId] = useState("");
  const peerId = getPeerId();

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

  const handleViewDashboard = () => {
    openNodeDashboard();
  };

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
      <PopoverContent className="w-96 max-w-[calc(100vw-2rem)] space-y-4" align="end">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">P2P Network</h3>
            <Badge variant="default" className="text-xs">🌐 PeerJS</Badge>
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
            Signaling: {endpointLabel ?? "No active endpoint"}
          </p>
        </div>

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

        <Button variant="secondary" className="w-full" onClick={handleViewDashboard}>
          View Node Dashboard
        </Button>
      </PopoverContent>
    </Popover>
  );
}
