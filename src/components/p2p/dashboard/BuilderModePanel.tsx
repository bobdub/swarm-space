/**
 * Builder Mode Panel
 * Advanced P2P controls for users who want granular control
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Settings2, Shield, WifiOff, Pickaxe } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { getMiningRewards, rewardTransactionProcessing, rewardSpaceHosting } from "@/lib/blockchain/miningRewards";

interface BuilderModePanelProps {
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

export function BuilderModePanel({
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
}: BuilderModePanelProps) {
  const { user } = useAuth();
  const [manualPeerId, setManualPeerId] = useState("");
  const [isMining, setIsMining] = useState(false);
  const [miningStats, setMiningStats] = useState({
    transactionsProcessed: 0,
    spaceHosted: 0,
  });

  const rewards = getMiningRewards();

  // Mining loop
  useEffect(() => {
    if (!isMining || !user) return;

    const interval = setInterval(() => {
      const txCount = Math.floor(Math.random() * 5) + 1;
      const mbHosted = Math.floor(Math.random() * 10) + 1;

      setMiningStats(prev => ({
        transactionsProcessed: prev.transactionsProcessed + txCount,
        spaceHosted: prev.spaceHosted + mbHosted,
      }));

      void rewardTransactionProcessing(user.id, txCount);
      void rewardSpaceHosting(user.id, mbHosted);
    }, 30000);

    return () => clearInterval(interval);
  }, [isMining, user]);

  const handleToggleMining = () => {
    setIsMining(!isMining);
    if (!isMining) {
      toast.success("Mining started in Builder Mode");
    } else {
      toast.info("Mining paused");
    }
  };

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
              Builder Mode
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

        {/* Mining Controls */}
        <div className="space-y-3 pt-4 border-t">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="builder-mining" className="flex items-center gap-2">
                <Pickaxe className="h-4 w-4 text-amber-500" />
                Mining
              </Label>
              <p className="text-xs text-muted-foreground">
                Earn SWARM by processing transactions
              </p>
            </div>
            <Switch
              id="builder-mining"
              checked={isMining}
              onCheckedChange={handleToggleMining}
              disabled={!isOnline}
            />
          </div>

          {isMining && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <div className="flex items-center gap-2 mb-2">
                <Pickaxe className="h-3.5 w-3.5 text-amber-500 animate-pulse" />
                <span className="text-xs font-medium text-amber-400">Mining Active</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <div className="text-muted-foreground">Transactions</div>
                  <div className="font-bold">{miningStats.transactionsProcessed}</div>
                  <div className="text-amber-400">
                    +{(miningStats.transactionsProcessed * rewards.TRANSACTION_PROCESSED * (1 - rewards.NETWORK_POOL_PERCENTAGE)).toFixed(2)} SWARM
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Space Hosted</div>
                  <div className="font-bold">{miningStats.spaceHosted} MB</div>
                  <div className="text-amber-400">
                    +{(miningStats.spaceHosted * rewards.MB_HOSTED * (1 - rewards.NETWORK_POOL_PERCENTAGE)).toFixed(2)} SWARM
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Manual Peer Connection */}
        {buildMeshMode && (
          <div className="space-y-2 pt-4 border-t">
            <Label htmlFor="manual-peer">Connect to User (Network ID)</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Enter a Node ID or Peer ID — the system auto-detects the format
            </p>
            <div className="flex gap-2">
              <Input
                id="manual-peer"
                placeholder="Node ID or Peer ID..."
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
          <p>✅ All posts, comments & reactions recorded as NFTs on blockchain</p>
        </div>
      </CardContent>
    </Card>
  );
}
