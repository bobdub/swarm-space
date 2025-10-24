import { Wifi, WifiOff, Loader2 } from "lucide-react";
import { Button } from "./ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";
import { useP2P } from "@/hooks/useP2P";
import { Badge } from "./ui/badge";

export function P2PStatusIndicator() {
  const { isEnabled, stats, enable, disable, getDiscoveredPeers } = useP2P();

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
    if (isEnabled) {
      disable();
    } else {
      enable();
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
      <PopoverContent className="w-80" align="end">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">P2P Network</h3>
            <Button
              size="sm"
              variant={isEnabled ? "destructive" : "default"}
              onClick={handleToggle}
            >
              {isEnabled ? "Disable" : "Enable"}
            </Button>
          </div>

          {isEnabled && (
            <>
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
                  <span className="text-muted-foreground">Network Content</span>
                  <span className="font-medium">{stats.networkContent}</span>
                </div>
              </div>

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
                          {peer.availableContent.size} items
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
              Enable P2P networking to connect with nearby peers and share content directly.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
