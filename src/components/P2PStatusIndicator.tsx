import { Wifi, WifiOff, Loader2, Copy, Link, X, Clock, Check } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { useP2PContext } from "@/contexts/P2PContext";
import { Badge } from "./ui/badge";
import { Switch } from "./ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { toast } from "sonner";

export function P2PStatusIndicator() {
  const {
    isEnabled,
    isConnecting,
    stats,
    activeSignalingEndpoint,
    enable,
    disable,
    getDiscoveredPeers,
    connectToPeer,
    getPeerId,
    joinRoom,
    leaveRoom,
    getCurrentRoom,
    isRendezvousMeshEnabled,
    setRendezvousMeshEnabled,
    rendezvousDisabledReason,
    rendezvousConfig,
    controls,
    setControlFlag,
    blockedPeers,
    pendingPeers,
    blockPeer,
    unblockPeer,
    isPeerBlocked,
    approvePendingPeer,
    rejectPendingPeer
  } = useP2PContext();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [remotePeerId, setRemotePeerId] = useState("");
  const [roomName, setRoomName] = useState("");
  const [peerToBlock, setPeerToBlock] = useState("");
  const pendingApprovalCount = pendingPeers.length;
  const formatQueuedAt = (timestamp: number) =>
    new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const shortPeerId = (value: string) =>
    value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
  const formatEndpointUrl = (
    endpoint?: { host: string; port: number; secure: boolean; path?: string | null } | null,
    fallback?: string | null
  ): string | null => {
    if (endpoint) {
      const scheme = endpoint.secure ? 'wss' : 'ws';
      const rawPath = endpoint.path ?? '/';
      const normalizedPath = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;
      return `${scheme}://${endpoint.host}:${endpoint.port}${normalizedPath}`;
    }
    return fallback ?? null;
  };
  const endpointLabel =
    activeSignalingEndpoint?.label ??
    activeSignalingEndpoint?.host ??
    stats.signalingEndpointLabel ??
    null;
  const endpointUrl = formatEndpointUrl(activeSignalingEndpoint, stats.signalingEndpointUrl);
  const endpointStatusText = isConnecting
    ? 'Negotiating with configured signaling endpoints...'
    : isEnabled
      ? 'Retrying fallback signaling endpoints.'
      : 'Not connected to any signaling endpoint.';

  const getStatusIcon = () => {
    if (!isEnabled) return <WifiOff className="h-5 w-5" />;
    if (stats.status === 'connecting') return <Loader2 className="h-5 w-5 animate-spin" />;
    if (stats.status === 'waiting') return <Wifi className="h-5 w-5" />;
    if (stats.status === 'online') return <Wifi className="h-5 w-5" />;
    return <WifiOff className="h-5 w-5" />;
  };

  const getStatusColor = () => {
    if (!isEnabled) return "text-muted-foreground";
    if (stats.status === 'connecting') return "text-yellow-500";
    if (stats.status === 'waiting') return "text-blue-500";
    if (stats.status === 'online') return "text-green-500";
    return "text-muted-foreground";
  };

  const handleToggle = () => {
    if (!user) {
      navigate("/settings");
      return;
    }

    // If connecting, cancel the connection attempt
    if (isConnecting) {
      disable();
      toast.info("Connection cancelled");
      return;
    }

    if (!isEnabled && controls.paused) {
      toast.info("Mesh paused", {
        description: "Disable Pause to reconnect to the swarm."
      });
      return;
    }

    if (isEnabled) {
      disable();
    } else {
      enable();
    }
  };

  const handleCopyPeerId = () => {
    const peerId = getPeerId();
    if (peerId) {
      navigator.clipboard.writeText(peerId);
      toast.success("Peer ID copied to clipboard!");
    }
  };

  const handleConnectToPeer = () => {
    if (remotePeerId.trim()) {
      if (isPeerBlocked(remotePeerId.trim())) {
        toast.info("Connection blocked", {
          description: "This peer is currently on your block list.",
        });
        return;
      }
      const success = connectToPeer(remotePeerId.trim(), { manual: true, source: "manual" });
      if (success) {
        toast.success(`Connecting to peer ${remotePeerId.slice(0, 8)}...`);
        setRemotePeerId("");
      } else if (controls.paused) {
        toast.info("Mesh paused", {
          description: "Resume the mesh to connect to peers."
        });
      } else {
        toast.info("Connection blocked by mesh controls", {
          description: "Adjust sovereignty toggles to allow this link."
        });
      }
    }
  };

  const handleBlockPeer = () => {
    if (!peerToBlock.trim()) {
      return;
    }
    blockPeer(peerToBlock.trim());
    toast.success("Node blocked", {
      description: peerToBlock.trim(),
    });
    setPeerToBlock("");
  };

  const handleApprovePendingPeer = (peerId: string) => {
    const success = approvePendingPeer(peerId);
    if (success) {
      toast.success("Peer approved", {
        description: `${shortPeerId(peerId)} will connect now.`,
      });
    } else if (controls.paused) {
      toast.info("Mesh paused", {
        description: "Resume the mesh to connect to queued peers.",
      });
    } else {
      toast.info("Connection blocked", {
        description: "Adjust sovereignty toggles to allow this peer.",
      });
    }
  };

  const handleRejectPendingPeer = (peerId: string) => {
    rejectPendingPeer(peerId);
    toast.info("Peer dismissed", {
      description: `${shortPeerId(peerId)} removed from the queue.`,
    });
  };

  const handleJoinRoom = () => {
    if (roomName.trim()) {
      joinRoom(roomName.trim());
      toast.success(`Joined room: ${roomName.trim()}`);
    }
  };

  const handleLeaveRoom = () => {
    leaveRoom();
    toast.success("Left discovery room");
  };

  const handleRendezvousToggle = (checked: boolean) => {
    setRendezvousMeshEnabled(checked);
    if (checked) {
      toast.success("Rendezvous mesh enabled", {
        description: "The client will announce to discovery beacons and fetch capsules automatically."
      });
    } else {
      toast.info("Rendezvous mesh disabled", {
        description: "Automatic rendezvous discovery is paused until you turn it back on."
      });
    }
  };

  const handleManualAcceptToggle = (checked: boolean) => {
    setControlFlag('manualAccept', checked);
    if (checked) {
      toast.info("Manual approvals enabled", {
        description: "Incoming peers will queue until you approve them."
      });
    } else {
      toast.success("Manual approvals disabled", {
        description: "Peers can auto-join when other controls allow."
      });
      if (pendingApprovalCount > 0) {
        toast.info("Releasing queued peers", {
          description: `${pendingApprovalCount} pending connection${pendingApprovalCount === 1 ? '' : 's'} will attempt to connect.`
        });
      }
    }
  };

  const handlePauseToggle = (checked: boolean) => {
    setControlFlag('paused', checked);
    if (checked) {
      toast.info("Mesh paused", {
        description: "Gossip and sync are halted until you resume."
      });
    } else {
      toast.success("Mesh resumed", {
        description: "Swarm activity will resume when other restrictions permit."
      });
    }
  };

  const handleIsolateToggle = (checked: boolean) => {
    setControlFlag('isolate', checked);
    if (checked) {
      toast.info("Isolation enabled", {
        description: "Connections are limited to project-approved peers."
      });
    } else {
      toast.success("Isolation disabled", {
        description: "Broader mesh discovery is available again."
      });
    }
  };

  const handleAutoConnectToggle = (checked: boolean) => {
    setControlFlag('autoConnect', checked);
    if (checked) {
      toast.success("Auto-connect enabled", {
        description: "Your node will join peers automatically when restrictions allow."
      });
    } else {
      toast.info("Auto-connect disabled", {
        description: "Mesh joins now require manual action or approvals."
      });
    }
  };

  const discoveredPeers = getDiscoveredPeers();
  const currentRoom = getCurrentRoom();
  const lastRendezvousSync = stats.lastRendezvousSync
    ? new Date(stats.lastRendezvousSync).toLocaleTimeString()
    : rendezvousDisabledReason
      ? 'Disabled'
      : 'No sync yet';
  const rendezvousWarningMessage = (() => {
    if (rendezvousDisabledReason === 'capability') {
      return 'Browser cryptography limits prevent signing rendezvous tickets. Bootstrap discovery is still active.';
    }
    if (rendezvousDisabledReason === 'failure') {
      return 'Rendezvous beacons are unreachable. Continuing with bootstrap peers until fetches recover.';
    }
    return null;
  })();
  const autoConnectEffective = controls.autoConnect && !controls.manualAccept && !controls.isolate && !controls.paused;
  const autoConnectBlockedReasons: string[] = [];
  if (!controls.autoConnect) autoConnectBlockedReasons.push("Auto-Connect off");
  if (controls.manualAccept) autoConnectBlockedReasons.push("I Accept active");
  if (controls.isolate) autoConnectBlockedReasons.push("Isolate active");
  if (controls.paused) autoConnectBlockedReasons.push("Paused");
  const autoConnectStatus = autoConnectEffective
    ? "Auto-connect will join eligible peers automatically."
    : `Auto-connect is suspended${autoConnectBlockedReasons.length > 0 ? ` (${autoConnectBlockedReasons.join(', ')})` : ''}.`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          data-testid="p2p-status-trigger"
        >
          <div className={getStatusColor()}>
            {getStatusIcon()}
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 max-w-[calc(100vw-2rem)] max-h-[80vh] overflow-y-auto" align="end">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold">P2P Network</h3>
              <Badge variant="default" className="text-xs">
                🌐 PeerJS
              </Badge>
            </div>
            <Button
              size="sm"
              variant={!user ? "default" : isEnabled ? "outline" : "default"}
              onClick={handleToggle}
              disabled={!user && !isConnecting}
            >
              {isConnecting ? (
                <>
                  <X className="h-4 w-4 mr-2" />
                  Cancel
                </>
              ) : !user ? (
                "Create Account"
              ) : isEnabled ? (
                <>
                  <Wifi className="h-4 w-4 mr-2" />
                  Online
                </>
              ) : (
                "Enable"
              )}
            </Button>
          </div>

          {!user && (
            <p className="text-xs text-muted-foreground">
              Set up an account to enable peer-to-peer connections. Peers will be discovered automatically!
            </p>
          )}
          
          {isConnecting && (
            <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/50">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                Connecting to signaling server... (This may take up to 40 seconds)
              </p>
            </div>
          )}

          <div className="space-y-2 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">Signaling Endpoint</p>
              <Badge variant="outline" className="text-[10px] uppercase">
                {activeSignalingEndpoint ? 'Active' : isEnabled ? 'Retrying' : 'Offline'}
              </Badge>
            </div>
            {endpointLabel ? (
              <div className="space-y-1 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-foreground">{endpointLabel}</span>
                  {activeSignalingEndpoint && (
                    <Badge variant="secondary" className="text-[10px] uppercase">
                      {activeSignalingEndpoint.secure ? 'wss' : 'ws'}
                    </Badge>
                  )}
                </div>
                {endpointUrl && (
                  <code className="block rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground break-all">
                    {endpointUrl}
                  </code>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">{endpointStatusText}</p>
            )}
            {!activeSignalingEndpoint && stats.signalingEndpointLabel && stats.signalingEndpointUrl && (
              <div className="space-y-1 text-xs text-muted-foreground">
                <p className="font-medium text-foreground">Last successful:</p>
                <span>{stats.signalingEndpointLabel}</span>
                <code className="block rounded bg-muted px-2 py-1 text-[11px] text-muted-foreground break-all">
                  {stats.signalingEndpointUrl}
                </code>
              </div>
            )}
          </div>

          <div className="space-y-2 rounded-lg border p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold flex items-center gap-2">
                  🛰️ Rendezvous Mesh
                  <Badge variant={isRendezvousMeshEnabled ? "default" : "outline"} className="text-[10px] uppercase">
                    {isRendezvousMeshEnabled ? "On" : "Off"}
                  </Badge>
                </p>
                <p className="text-xs text-muted-foreground">
                  Edge beacons and signed capsules keep the swarm reachable even when manual discovery fails.
                </p>
                {rendezvousWarningMessage && (
                  <p
                    className={`mt-1 text-xs ${
                      rendezvousDisabledReason === 'capability' ? 'text-destructive' : 'text-amber-500'
                    }`}
                  >
                    {rendezvousWarningMessage}
                  </p>
                )}
              </div>
              <Switch
                checked={isRendezvousMeshEnabled}
                onCheckedChange={handleRendezvousToggle}
                aria-label="Toggle rendezvous mesh"
              />
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
              <div>
                <p className="font-medium text-foreground">Sources</p>
                <ul className="mt-1 space-y-1">
                  <li>• {rendezvousConfig.beacons.length} beacon{rendezvousConfig.beacons.length === 1 ? '' : 's'}</li>
                  <li>• {rendezvousConfig.capsules.length} capsule{rendezvousConfig.capsules.length === 1 ? '' : 's'}</li>
                </ul>
              </div>
              <div>
                <p className="font-medium text-foreground">Status</p>
                <ul className="mt-1 space-y-1">
                  <li>• Mesh peers: {stats.rendezvousPeers}</li>
                  <li>• Last sync: {lastRendezvousSync}</li>
                </ul>
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold flex items-center gap-2">
                  🎛️ Mesh Controls
                  <Badge variant="outline" className="text-[10px] uppercase">Sovereignty</Badge>
                </p>
                <p className="text-xs text-muted-foreground">
                  Tune how your node participates. Manual restrictions automatically suspend auto-connect.
                </p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium flex items-center gap-2">
                    I Accept
                    <Badge variant={controls.manualAccept ? "default" : "outline"} className="text-[10px] uppercase">
                      {controls.manualAccept ? "On" : "Off"}
                    </Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Queue incoming peers until you approve them manually.
                  </p>
                </div>
                <Switch
                  checked={controls.manualAccept}
                  onCheckedChange={handleManualAcceptToggle}
                  aria-label="Toggle manual approvals"
                />
              </div>

              {pendingApprovalCount > 0 && (
                <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-2">
                      <Clock className="h-3 w-3" /> Pending approvals
                    </p>
                    <Badge variant="secondary" className="text-[10px] uppercase">
                      {pendingApprovalCount}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    {pendingPeers.map((peer) => (
                      <div
                        key={peer.peerId}
                        className="flex flex-col gap-2 rounded border border-amber-500/20 bg-background/80 p-2 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="space-y-1 text-xs">
                          <p className="font-medium text-foreground">{shortPeerId(peer.peerId)}</p>
                          {peer.userId && (
                            <p className="text-[10px] text-muted-foreground">User: {peer.userId}</p>
                          )}
                          <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                            <Clock className="h-3 w-3" /> Queued {formatQueuedAt(peer.queuedAt)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="flex items-center gap-1"
                            onClick={() => handleApprovePendingPeer(peer.peerId)}
                          >
                            <Check className="h-3 w-3" /> Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="flex items-center gap-1"
                            onClick={() => handleRejectPendingPeer(peer.peerId)}
                          >
                            <X className="h-3 w-3" /> Reject
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium flex items-center gap-2">
                    Pause
                    <Badge variant={controls.paused ? "default" : "outline"} className="text-[10px] uppercase">
                      {controls.paused ? "On" : "Off"}
                    </Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Halt gossip and sync without forgetting your previous session.
                  </p>
                </div>
                <Switch
                  checked={controls.paused}
                  onCheckedChange={handlePauseToggle}
                  aria-label="Toggle mesh pause"
                />
              </div>

              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium flex items-center gap-2">
                    Isolate
                    <Badge variant={controls.isolate ? "default" : "outline"} className="text-[10px] uppercase">
                      {controls.isolate ? "On" : "Off"}
                    </Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Restrict sync to project-approved peers, forming a focused sub-mesh.
                  </p>
                </div>
                <Switch
                  checked={controls.isolate}
                  onCheckedChange={handleIsolateToggle}
                  aria-label="Toggle project isolation"
                />
              </div>

              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium flex items-center gap-2">
                    Auto-Connect
                    <Badge variant={autoConnectEffective ? "default" : "outline"} className="text-[10px] uppercase">
                      {autoConnectEffective ? "Active" : "Suspended"}
                    </Badge>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Join the swarm automatically when conditions permit.
                  </p>
                </div>
                <Switch
                  checked={controls.autoConnect}
                  onCheckedChange={handleAutoConnectToggle}
                  aria-label="Toggle auto-connect"
                />
              </div>
            </div>
            <div className="rounded-md bg-muted/50 p-2 text-xs text-muted-foreground">
              {autoConnectStatus}
            </div>
          </div>

          {isEnabled && (
            <>
              {stats.connectedPeers === 0 && (
                <div className="space-y-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                    🔗 To connect with another device:
                  </p>
                  <ol className="text-xs text-amber-700 dark:text-amber-300 space-y-1 ml-4 list-decimal">
                    <li>Copy your Peer ID below</li>
                    <li>Share it with your other device</li>
                    <li>On the other device, paste the ID and click Connect</li>
                  </ol>
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    Once connected, the network grows automatically!
                  </p>
                </div>
              )}

              {getPeerId() && (
                <div className="space-y-2 p-3 bg-primary/10 border border-primary/30 rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-primary">📱 Your Peer ID</span>
                    <Button
                      size="sm"
                      variant="default"
                      onClick={handleCopyPeerId}
                      className="h-8"
                    >
                      <Copy className="h-3 w-3 mr-1" />
                      Copy
                    </Button>
                  </div>
                  <code className="block text-xs bg-background p-3 rounded border break-all font-mono font-bold">
                    {getPeerId()}
                  </code>
                  <p className="text-xs text-muted-foreground">
                    Share this with other devices to connect directly
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium">🔌 Connect to Peer</label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Paste peer ID here"
                    value={remotePeerId}
                    onChange={(e) => setRemotePeerId(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleConnectToPeer()}
                    className="flex-1 font-mono text-sm"
                  />
                  <Button
                    size="sm"
                    onClick={handleConnectToPeer}
                    disabled={!remotePeerId.trim()}
                    variant="default"
                  >
                    <Link className="h-4 w-4 mr-1" />
                    Connect
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Paste the peer ID from your other device
                </p>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">🚫 Block Node</label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Peer ID to block"
                    value={peerToBlock}
                    onChange={(e) => setPeerToBlock(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleBlockPeer()}
                    className="flex-1 font-mono text-xs"
                  />
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleBlockPeer}
                    disabled={!peerToBlock.trim()}
                  >
                    Block
                  </Button>
                </div>
                {blockedPeers.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Blocked nodes will be ignored for auto-connect.</p>
                    <div className="flex flex-wrap gap-2">
                      {blockedPeers.map((peerId) => (
                        <Badge key={peerId} variant="secondary" className="flex items-center gap-2">
                          <span className="font-mono text-[10px]">{peerId}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-5 w-5"
                            onClick={() => {
                              unblockPeer(peerId);
                              toast.success("Node unblocked", {
                                description: peerId,
                              });
                            }}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No nodes blocked.</p>
                )}
              </div>

              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border">
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${
                    stats.status === 'online' ? 'bg-green-500' : 
                    stats.status === 'waiting' ? 'bg-blue-500' : 
                    'bg-yellow-500'
                  } animate-pulse`} />
                  <span className="text-sm font-medium">
                    {stats.status === 'online' ? `Connected: ${stats.connectedPeers} peer${stats.connectedPeers > 1 ? 's' : ''}` : 
                     stats.status === 'waiting' ? 'Ready - Waiting for connections' : 
                     'Connecting...'}
                  </span>
                </div>
              </div>

              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                  📊 Network Stats
                </summary>
                <div className="space-y-2 mt-2 pl-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Status</span>
                    <span className="font-medium capitalize">{stats.status}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Connected Peers</span>
                    <span className="font-medium">{stats.connectedPeers}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Discovered Peers</span>
                    <span className="font-medium">{stats.discoveredPeers}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Local Content</span>
                    <span className="font-medium">{stats.localContent}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Network Content</span>
                    <span className="font-medium">{stats.networkContent}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Room</span>
                    <span className="font-medium font-mono text-xs">{currentRoom || 'None'}</span>
                  </div>
                </div>
              </details>

              {stats.status === 'online' && stats.connectedPeers > 0 && (
                <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-md">
                  <p className="text-sm font-medium text-green-700 dark:text-green-300">
                    🎉 Swarm Active!
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                    Connected to {stats.connectedPeers} peer{stats.connectedPeers > 1 ? 's' : ''}. Network grows automatically through peer exchange.
                  </p>
                </div>
              )}
            </>
          )}

          {!isEnabled && (
            <p className="text-sm text-muted-foreground">
              Enable P2P networking to automatically discover and connect with peers. The swarm grows organically!
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
