/**
 * Legacy Mode Panel
 * Advanced P2P controls for users who want granular control
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Settings2, Shield, WifiOff } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

interface LegacyModePanelProps {
  isOnline: boolean;
  buildMeshMode: boolean;
  blockchainSync: boolean;
  autoConnect: boolean;
  approveOnly: boolean;
  onToggleBuildMesh: (enabled: boolean) => void;
  onToggleBlockchainSync: (enabled: boolean) => void;
  onToggleAutoConnect: (enabled: boolean) => void;
  onToggleApproveOnly: (enabled: boolean) => void;
  onConnectToPeer: (peerId: string) => void;
  onGoOffline: () => void;
  onBlockNode: () => void;
}

export function LegacyModePanel({
  isOnline,
  buildMeshMode,
  blockchainSync,
  autoConnect,
  approveOnly,
  onToggleBuildMesh,
  onToggleBlockchainSync,
  onToggleAutoConnect,
  onToggleApproveOnly,
  onConnectToPeer,
  onGoOffline,
  onBlockNode,
}: LegacyModePanelProps) {
  const [manualPeerId, setManualPeerId] = useState("");

  const handleConnectManual = () => {
    if (!manualPeerId.trim()) {
      toast.error("Please enter a peer ID");
      return;
    }
    onConnectToPeer(manualPeerId.trim());
    setManualPeerId("");
  };

  return (
    <Card className="border-amber-500/20">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Settings2 className="h-5 w-5 text-amber-500" />
              Legacy Mode
            </CardTitle>
            <CardDescription>
              Advanced P2P controls with granular network management
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Toggle Controls */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="build-mesh">Build a Mesh</Label>
              <p className="text-xs text-muted-foreground">
                Connect only to peers you manually enter
              </p>
            </div>
            <Switch
              id="build-mesh"
              checked={buildMeshMode}
              onCheckedChange={onToggleBuildMesh}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="blockchain-sync">Blockchain Sync</Label>
              <p className="text-xs text-muted-foreground">
                Sync blockchain with connected peers
              </p>
            </div>
            <Switch
              id="blockchain-sync"
              checked={blockchainSync}
              onCheckedChange={onToggleBlockchainSync}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="auto-connect">Auto-Connect</Label>
              <p className="text-xs text-muted-foreground">
                Use auto-connect to join main mesh
              </p>
            </div>
            <Switch
              id="auto-connect"
              checked={autoConnect}
              onCheckedChange={onToggleAutoConnect}
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="approve-only">Approve Only</Label>
              <p className="text-xs text-muted-foreground">
                Manually approve incoming connections
              </p>
            </div>
            <Switch
              id="approve-only"
              checked={approveOnly}
              onCheckedChange={onToggleApproveOnly}
            />
          </div>
        </div>

        {/* Manual Peer Connection */}
        {buildMeshMode && (
          <div className="space-y-2 pt-4 border-t">
            <Label htmlFor="manual-peer">Manual Peer Connection</Label>
            <div className="flex gap-2">
              <Input
                id="manual-peer"
                placeholder="Enter peer ID..."
                value={manualPeerId}
                onChange={(e) => setManualPeerId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleConnectManual();
                  }
                }}
              />
              <Button onClick={handleConnectManual} variant="secondary">
                Connect
              </Button>
            </div>
          </div>
        )}

        {/* Basic Controls */}
        <div className="grid grid-cols-2 gap-3 pt-4 border-t">
          <Button
            variant="outline"
            onClick={onBlockNode}
            className="w-full"
          >
            <Shield className="mr-2 h-4 w-4" />
            Block Node
          </Button>
          <Button
            variant="outline"
            onClick={onGoOffline}
            className="w-full"
          >
            <WifiOff className="mr-2 h-4 w-4" />
            Go Offline
          </Button>
        </div>

        <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
          <p className="font-medium text-amber-500">⚠️ Advanced Mode</p>
          <p>Manual network management for experienced users</p>
        </div>
      </CardContent>
    </Card>
  );
}
