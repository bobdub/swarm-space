/**
 * SWARM Mesh Mode Panel
 * Simplified controls for the unified SWARM Mesh network
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Network, Shield, Pickaxe, WifiOff, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { getMiningRewards, rewardTransactionProcessing, rewardSpaceHosting } from "@/lib/blockchain/miningRewards";
import { BlockUserModal } from "./BlockUserModal";
import { upsertBlocklistEntry, loadBlocklistFromStorage, persistBlocklist } from "@/lib/p2p/blocklistStore";

interface SwarmMeshStats {
  totalPeers: number;
  directConnections: number;
  averageQuality: number;
  averageReputation: number;
  meshHealth: number;
  blockchainSynced: boolean;
}

interface SwarmMeshModePanelProps {
  meshStats?: SwarmMeshStats;
  isOnline: boolean;
  onGoOffline: () => void;
  onBlockNode: () => void;
  onConnectToPeer: (peerId: string) => void;
}

export function SwarmMeshModePanel({
  meshStats,
  isOnline,
  onGoOffline,
  onBlockNode,
  onConnectToPeer,
}: SwarmMeshModePanelProps) {
  const { user } = useAuth();
  const [isMining, setIsMining] = useState(false);
  const [manualPeerId, setManualPeerId] = useState("");
  const [miningStats, setMiningStats] = useState({
    transactionsProcessed: 0,
    spaceHosted: 0,
  });
  const [blockUserModalOpen, setBlockUserModalOpen] = useState(false);

  const rewards = getMiningRewards();

  // Auto-start mining when connected to SWARM Mesh
  useEffect(() => {
    if (isOnline && meshStats && meshStats.totalPeers > 0 && !isMining) {
      setIsMining(true);
      toast.success("Auto-mining started on SWARM Mesh");
    }
  }, [isOnline, meshStats?.totalPeers]);

  // Mining simulation
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
    toast.info(isMining ? "Mining paused" : "Mining resumed");
  };

  const handleConnectManual = () => {
    if (!manualPeerId.trim()) {
      toast.error("Please enter a Node ID");
      return;
    }
    onConnectToPeer(manualPeerId.trim());
    toast.success(`Connecting to ${manualPeerId.trim()}`);
    setManualPeerId("");
  };

  const handleBlockUser = (peerId: string) => {
    const blocklist = loadBlocklistFromStorage();
    const updated = upsertBlocklistEntry(blocklist, peerId, "all", "Blocked from SWARM Mesh");
    persistBlocklist(updated);
    toast.success(`Blocked user: ${peerId}`);
    onBlockNode();
  };

  return (
    <Card className="border-primary/20">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Network className="h-5 w-5 text-primary" />
              SWARM Mesh Mode
            </CardTitle>
            <CardDescription>
              Unified mesh network with auto-connect, blockchain sync, and WebTorrent
            </CardDescription>
          </div>
          <Badge variant={isOnline ? "default" : "secondary"} className="text-xs">
            {isOnline ? "Connected" : "Offline"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Network Stats */}
        {meshStats && (
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center p-3 rounded-lg bg-muted/50 border border-border/50">
              <div className="text-2xl font-bold text-primary">{meshStats.totalPeers}</div>
              <div className="text-xs text-muted-foreground">Total Peers</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/50 border border-border/50">
              <div className="text-2xl font-bold text-primary">{meshStats.directConnections}</div>
              <div className="text-xs text-muted-foreground">Direct Links</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted/50 border border-border/50">
              <div className="text-2xl font-bold text-primary">{meshStats.meshHealth}%</div>
              <div className="text-xs text-muted-foreground">Mesh Health</div>
            </div>
          </div>
        )}

        {/* Mining Stats */}
        {isMining && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Pickaxe className="h-4 w-4 text-primary animate-pulse" />
              <span className="text-sm font-medium">Auto-Mining Active</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-muted-foreground">Transactions</div>
                <div className="font-bold">{miningStats.transactionsProcessed}</div>
                <div className="text-primary">+{(miningStats.transactionsProcessed * rewards.TRANSACTION_PROCESSED * (1 - rewards.NETWORK_POOL_PERCENTAGE)).toFixed(2)} SWARM</div>
              </div>
              <div>
                <div className="text-muted-foreground">Space Hosted</div>
                <div className="font-bold">{miningStats.spaceHosted} MB</div>
                <div className="text-primary">+{(miningStats.spaceHosted * rewards.MB_HOSTED * (1 - rewards.NETWORK_POOL_PERCENTAGE)).toFixed(2)} SWARM</div>
              </div>
            </div>
          </div>
        )}

        {/* Manual Peer Connection */}
        <div className="space-y-2 pt-4 border-t">
          <Label htmlFor="manual-peer-swarm">Connect to User (Node ID)</Label>
          <p className="text-xs text-muted-foreground">
            Enter another user's Node ID to manually connect when auto-connect nodes are offline
          </p>
          <div className="flex gap-2">
            <Input
              id="manual-peer-swarm"
              placeholder="Enter Node ID (e.g., fc6ea1c770f8e2db)"
              value={manualPeerId}
              onChange={(e) => setManualPeerId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleConnectManual();
                }
              }}
            />
            <Button onClick={handleConnectManual} variant="secondary">
              <UserPlus className="mr-2 h-4 w-4" />
              Connect
            </Button>
          </div>
        </div>

        {/* Basic Controls */}
        <div className="grid grid-cols-2 gap-3">
          <Button
            variant="outline"
            onClick={() => setBlockUserModalOpen(true)}
            className="w-full"
          >
            <Shield className="mr-2 h-4 w-4" />
            Block User
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

        <Button
          onClick={handleToggleMining}
          variant={isMining ? "secondary" : "default"}
          className="w-full"
        >
          <Pickaxe className="mr-2 h-4 w-4" />
          {isMining ? "Pause Mining" : "Start Mining"}
        </Button>

        <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
          <p>✅ Auto-connect enabled</p>
          <p>✅ Blockchain sync active</p>
          <p>✅ WebTorrent DHT discovery</p>
          <p>✅ All posts, comments & reactions recorded on blockchain</p>
          {meshStats && meshStats.totalPeers > 0 && (
            <p className="text-primary font-medium pt-1">Your Node ID is shared with the mesh</p>
          )}
        </div>
      </CardContent>

      <BlockUserModal
        open={blockUserModalOpen}
        onOpenChange={setBlockUserModalOpen}
        onBlock={handleBlockUser}
      />
    </Card>
  );
}
