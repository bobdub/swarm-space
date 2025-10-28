import { Wifi, WifiOff, Loader2, Copy, Link } from "lucide-react";
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
    rendezvousConfig,
    controls,
    setControlFlag
  } = useP2PContext();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [remotePeerId, setRemotePeerId] = useState("");
  const [roomName, setRoomName] = useState("");

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
    : "No sync yet";
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
          {stats.connectedPeers > 0 && (
            <Badge 
              variant="secondary" 
              className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
            >
              {stats.connectedPeers}
            </Badge>
          )}
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
              disabled={isConnecting}
            >
              {isConnecting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Connecting...
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
