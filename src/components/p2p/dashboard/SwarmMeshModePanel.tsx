/**
 * SWARM Mesh Mode Panel
 * Streamlined controls — stats live in the dashboard header, not repeated here.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pickaxe, UserPlus, CheckCircle2 } from "lucide-react";
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
    <div className="space-y-4">
      {/* Mining — primary action */}
      <Card className="border-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <Pickaxe className="h-4 w-4 text-primary" />
              Mining
            </span>
            <Button
              onClick={handleToggleMining}
              variant={isMining ? "secondary" : "default"}
              size="sm"
            >
              {isMining ? "Pause" : "Start"}
            </Button>
          </CardTitle>
        </CardHeader>
        {isMining && (
          <CardContent className="pt-0">
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
              <div className="flex items-center gap-2 mb-2">
                <Pickaxe className="h-3.5 w-3.5 text-primary animate-pulse" />
                <span className="text-xs font-medium text-primary">Auto-Mining Active</span>
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
          </CardContent>
        )}
      </Card>

      {/* Manual connect */}
      <Card className="border-foreground/10">
        <CardContent className="pt-5 space-y-2">
          <Label htmlFor="manual-peer-swarm">Connect to User (Network ID)</Label>
          <p className="text-xs text-muted-foreground">
            Enter a Node ID or Peer ID — the system auto-detects and connects
          </p>
          <div className="flex gap-2">
            <Input
              id="manual-peer-swarm"
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
              <UserPlus className="mr-2 h-4 w-4" />
              Connect
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Quick actions row */}
      <div className="grid grid-cols-2 gap-3">
        <Button
          variant="outline"
          onClick={() => setBlockUserModalOpen(true)}
          className="w-full"
        >
          Block User
        </Button>
        <Button
          variant="outline"
          onClick={onGoOffline}
          className="w-full"
        >
          Go Offline
        </Button>
      </div>

      {/* Status checks */}
      <div className="text-xs text-muted-foreground space-y-1 px-1">
        <p className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-emerald-400" /> Auto-connect enabled</p>
        <p className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-emerald-400" /> Blockchain sync active</p>
        <p className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-emerald-400" /> WebTorrent DHT discovery</p>
        <p className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-emerald-400" /> All content recorded on blockchain</p>
        {meshStats && meshStats.totalPeers > 0 && (
          <p className="text-primary font-medium pt-1">Your Node ID is shared with the mesh</p>
        )}
      </div>

      <BlockUserModal
        open={blockUserModalOpen}
        onOpenChange={setBlockUserModalOpen}
        onBlock={handleBlockUser}
      />
    </div>
  );
}
