import { Wifi, WifiOff, Loader2, Copy, Link } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { useP2P } from "@/hooks/useP2P";
import { Badge } from "./ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { toast } from "sonner";

export function P2PStatusIndicator() {
  const { isEnabled, isConnecting, stats, enable, disable, getDiscoveredPeers, connectToPeer, getPeerId, joinRoom, leaveRoom, getCurrentRoom } = useP2P();
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
      connectToPeer(remotePeerId.trim());
      toast.success(`Connecting to peer ${remotePeerId.slice(0, 8)}...`);
      setRemotePeerId("");
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

  const discoveredPeers = getDiscoveredPeers();
  const currentRoom = getCurrentRoom();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
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

          {isEnabled && (
            <>
              <div className="space-y-2 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-blue-700 dark:text-blue-300">
                    🌐 Discovery Room
                  </label>
                </div>
                {currentRoom ? (
                  <div className="p-2 bg-blue-500/20 rounded">
                    <p className="text-xs font-mono text-blue-900 dark:text-blue-100">
                      Room: {currentRoom}
                    </p>
                    <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                      {currentRoom === 'swarm-space-global' 
                        ? '🌍 Connected to global network - finding all peers automatically'
                        : '📡 Broadcasting to peers in this private room'}
                    </p>
                    {currentRoom !== 'swarm-space-global' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleLeaveRoom}
                        className="h-6 text-xs text-blue-700 dark:text-blue-300 mt-1"
                      >
                        Return to Global Room
                      </Button>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-blue-700 dark:text-blue-300">
                    Not in any room
                  </p>
                )}
                <details className="text-xs">
                  <summary className="cursor-pointer text-blue-700 dark:text-blue-300 hover:underline">
                    Join a private room
                  </summary>
                  <div className="flex gap-2 mt-2">
                    <Input
                      placeholder="Enter room name"
                      value={roomName}
                      onChange={(e) => setRoomName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleJoinRoom()}
                      className="flex-1 text-sm"
                    />
                    <Button
                      size="sm"
                      onClick={handleJoinRoom}
                      disabled={!roomName.trim()}
                    >
                      Join
                    </Button>
                  </div>
                  <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                    Create a private room to only connect with specific peers
                  </p>
                </details>
              </div>

              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg border">
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 rounded-full ${
                    stats.status === 'online' ? 'bg-green-500' : 
                    stats.status === 'waiting' ? 'bg-blue-500' : 
                    'bg-yellow-500'
                  } animate-pulse`} />
                  <span className="text-sm font-medium">
                    Node Status: {stats.status === 'waiting' ? 'Waiting for Peers' : stats.status === 'online' ? 'Active Swarm' : 'Connecting'}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleToggle}
                  className="h-8 text-xs"
                >
                  Disconnect
                </Button>
              </div>

              {getPeerId() && (
                <div className="space-y-2 p-3 bg-muted rounded-lg">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Your Peer ID</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleCopyPeerId}
                      className="h-7 px-2"
                    >
                      <Copy className="h-3 w-3 mr-1" />
                      Copy
                    </Button>
                  </div>
                  <code className="block text-xs bg-background p-2 rounded border break-all font-mono">
                    {getPeerId()}
                  </code>
                  <p className="text-xs text-muted-foreground">
                    Share this ID with others to let them connect to you
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium">Manual Connection (Optional)</label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Enter peer ID to connect directly"
                    value={remotePeerId}
                    onChange={(e) => setRemotePeerId(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleConnectToPeer()}
                    className="flex-1 font-mono text-sm"
                  />
                  <Button
                    size="sm"
                    onClick={handleConnectToPeer}
                    disabled={!remotePeerId.trim()}
                  >
                    <Link className="h-4 w-4" />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Peers are discovered automatically, but you can also connect directly
                </p>
              </div>

              <div className="space-y-2">
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
                  <span className="text-muted-foreground">Total Network Content</span>
                  <span className="font-medium">{stats.networkContent}</span>
                </div>
              </div>

              {stats.status === 'waiting' && stats.connectedPeers === 0 && (
                <div className="p-2 bg-blue-500/10 border border-blue-500/20 rounded-md">
                  <p className="text-xs text-blue-600 dark:text-blue-400">
                    📡 <strong>State 2:</strong> Broadcasting presence. Waiting for peer discovery...
                  </p>
                </div>
              )}

              {stats.status === 'online' && stats.connectedPeers > 0 && (
                <div className="p-2 bg-green-500/10 border border-green-500/20 rounded-md">
                  <p className="text-xs text-green-600 dark:text-green-400">
                    🎉 <strong>State 3:</strong> Swarm active! Connected to {stats.connectedPeers} peer{stats.connectedPeers > 1 ? 's' : ''}.
                  </p>
                </div>
              )}

              {discoveredPeers.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">Discovered Peers</h4>
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {discoveredPeers.map((peer) => (
                      <div 
                        key={peer.peerId} 
                        className="text-xs p-2 rounded-md bg-muted"
                      >
                        <div className="font-mono truncate">{peer.userId}</div>
                        <div className="text-muted-foreground">
                          {peer.availableContent.size} items • Last seen: {new Date(peer.lastSeen).toLocaleTimeString()}
                        </div>
                      </div>
                    ))}
                  </div>
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
