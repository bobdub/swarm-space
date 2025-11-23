import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Cpu, HardDrive, Network } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { getMiningRewards, rewardTransactionProcessing, rewardSpaceHosting } from "@/lib/blockchain/miningRewards";
import { toast } from "sonner";

export function MiningPanel() {
  const { user } = useAuth();
  const [isMining, setIsMining] = useState(false);
  const [stats, setStats] = useState({
    transactionsProcessed: 0,
    spaceHosted: 0,
  });

  const rewards = getMiningRewards();

  useEffect(() => {
    if (!isMining || !user) return;

    const interval = setInterval(() => {
      // Simulate mining activity
      const txCount = Math.floor(Math.random() * 5) + 1;
      const mbHosted = Math.floor(Math.random() * 10) + 1;

      setStats(prev => ({
        transactionsProcessed: prev.transactionsProcessed + txCount,
        spaceHosted: prev.spaceHosted + mbHosted,
      }));

      // Award tokens
      void rewardTransactionProcessing(user.id, txCount);
      void rewardSpaceHosting(user.id, mbHosted);
    }, 30000); // Every 30 seconds

    return () => clearInterval(interval);
  }, [isMining, user]);

  const handleToggleMining = () => {
    setIsMining(!isMining);
    if (!isMining) {
      toast.success("Mining started! Earning SWARM by supporting the network");
    } else {
      toast.info("Mining paused");
    }
  };

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="h-5 w-5 text-primary" />
          Network Mining
        </CardTitle>
        <CardDescription>
          Earn SWARM tokens by processing transactions and hosting data
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-border/50 bg-muted/30 p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Network className="h-4 w-4" />
              Transactions Processed
            </div>
            <div className="mt-2 text-2xl font-bold">{stats.transactionsProcessed}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              +{rewards.TRANSACTION_PROCESSED} SWARM each
            </div>
          </div>
          <div className="rounded-lg border border-border/50 bg-muted/30 p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <HardDrive className="h-4 w-4" />
              Space Hosted
            </div>
            <div className="mt-2 text-2xl font-bold">{stats.spaceHosted} MB</div>
            <div className="mt-1 text-xs text-muted-foreground">
              +{rewards.MB_HOSTED} SWARM per MB
            </div>
          </div>
        </div>

        <Button 
          onClick={handleToggleMining} 
          className="w-full"
          variant={isMining ? "destructive" : "default"}
        >
          {isMining ? "Stop Mining" : "Start Mining"}
        </Button>

        <p className="text-xs text-muted-foreground">
          Mining rewards you for participating in the mesh network by processing transactions and hosting data for other peers.
        </p>
      </CardContent>
    </Card>
  );
}
