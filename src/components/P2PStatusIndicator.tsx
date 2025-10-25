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
  const { isEnabled, stats, enable, disable, getDiscoveredPeers, connectToPeer, getPeerId } = useP2P();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [remotePeerId, setRemotePeerId] = useState("");

  const getStatusIcon = () => {
    if (!isEnabled) return <WifiOff className="h-5 w-5" />;
    if (stats.status === 'connecting') return <Loader2 className="h-5 w-5 animate-spin" />;
    return <Wifi className="h-5 w-5" />;
  };

  const getStatusColor = () => {
    if (!isEnabled) return "text-muted-foreground";
    if (stats.status === 'connecting') return "text-yellow-500";
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

  const discoveredPeers = getDiscoveredPeers();

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
      <PopoverContent className="w-96" align="end">
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
              variant={!user ? "default" : isEnabled ? "destructive" : "default"}
              onClick={handleToggle}
            >
              {!user ? "Create Account" : isEnabled ? "Disable" : "Enable"}
            </Button>
          </div>

          {!user && (
            <p className="text-xs text-muted-foreground">
              Set up an account to enable peer-to-peer connections.
            </p>
          )}

          {isEnabled && (
            <>
              <div className="p-2 bg-blue-500/10 border border-blue-500/20 rounded-md">
                <p className="text-xs text-blue-600 dark:text-blue-400">
                  <strong>🌐 PeerJS Cloud:</strong> Using free cloud signaling for cross-device discovery. 
                  All content transfers happen directly peer-to-peer.
                </p>
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
                <label className="text-sm font-medium">Connect to Peer</label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Enter peer ID"
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

              {stats.discoveredPeers === 0 && (
                <div className="p-2 bg-yellow-500/10 border border-yellow-500/20 rounded-md">
                  <p className="text-xs text-yellow-600 dark:text-yellow-400">
                    ⏳ Waiting for peers... Share your Peer ID or connect to others to start sharing content!
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
              Enable P2P networking to connect with peers and share content directly using PeerJS cloud signaling.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
