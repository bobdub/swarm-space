import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Coins, ArrowRight, Clock } from "lucide-react";
import { toast } from "sonner";
import { requestCreditWrap, getWrapStats, getUserWrapRequests } from "@/lib/blockchain/creditWrapping";
import { getCreditBalance } from "@/lib/credits";
import { useAuth } from "@/hooks/useAuth";
import type { WrapStats } from "@/lib/blockchain/creditWrapping";

export function CreditWrappingPanel() {
  const { user } = useAuth();
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<WrapStats>({ poolBalance: 0, pendingWraps: 0 });
  const [creditBalance, setCreditBalance] = useState(0);

  useEffect(() => {
    if (!user) return;

    const loadData = async () => {
      const [wrapStats, balance] = await Promise.all([
        getWrapStats(user.id),
        getCreditBalance(user.id),
      ]);
      setStats(wrapStats);
      setCreditBalance(balance);
    };

    void loadData();

    // Refresh every 10 seconds
    const interval = setInterval(() => {
      void loadData();
    }, 10000);

    return () => clearInterval(interval);
  }, [user]);

  const handleWrap = async () => {
    if (!user) {
      toast.error("Please log in");
      return;
    }

    const wrapAmount = Number(amount);
    if (isNaN(wrapAmount) || wrapAmount <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    if (wrapAmount > creditBalance) {
      toast.error("Insufficient credits");
      return;
    }

    setLoading(true);
    try {
      await requestCreditWrap(user.id, wrapAmount);
      
      if (wrapAmount <= stats.poolBalance) {
        toast.success(`Successfully wrapped ${wrapAmount} credits to SWARM!`);
      } else {
        toast.info(`Wrap request queued. ${stats.poolBalance} SWARM available in pool.`);
      }
      
      setAmount("");
      
      // Refresh stats
      const [wrapStats, balance] = await Promise.all([
        getWrapStats(user.id),
        getCreditBalance(user.id),
      ]);
      setStats(wrapStats);
      setCreditBalance(balance);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to wrap credits");
    } finally {
      setLoading(false);
    }
  };

  if (!user) return null;

  const poolUtilization = stats.poolBalance > 0 ? Math.min(100, (stats.pendingWraps / stats.poolBalance) * 100) : 0;

  return (
    <Card className="p-6 space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
          <Coins className="h-5 w-5" />
          Credit Wrapping
        </h3>
        <p className="text-sm text-foreground/60">
          Convert earned credits to mined SWARM tokens using the network reward pool
        </p>
      </div>

      {/* Reward Pool Stats */}
      <div className="space-y-3 p-4 rounded-lg bg-accent/10 border border-border/50">
        <div className="flex justify-between items-center">
          <span className="text-sm font-medium">Reward Pool Balance</span>
          <span className="text-lg font-bold text-primary">{stats.poolBalance.toFixed(2)} SWARM</span>
        </div>
        
        <div className="space-y-1">
          <div className="flex justify-between text-xs text-foreground/60">
            <span>Pool Utilization</span>
            <span>{poolUtilization.toFixed(1)}%</span>
          </div>
          <Progress value={poolUtilization} className="h-2" />
        </div>

        {stats.pendingWraps > 0 && (
          <div className="flex items-center gap-2 text-xs text-foreground/60 pt-2 border-t border-border/30">
            <Clock className="h-3 w-3" />
            <span>{stats.pendingWraps} request(s) in queue</span>
            {stats.queuePosition && (
              <span className="text-primary">• You are #{stats.queuePosition}</span>
            )}
          </div>
        )}
      </div>

      {/* Wrap Form */}
      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Amount to Wrap</Label>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                min="1"
                max={creditBalance}
                className="pr-20"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-foreground/60">
                Credits
              </div>
            </div>
            <Button
              onClick={() => setAmount(creditBalance.toString())}
              variant="outline"
              size="sm"
            >
              Max
            </Button>
          </div>
          <div className="flex justify-between text-xs text-foreground/60">
            <span>Available: {creditBalance.toFixed(2)} credits</span>
            <span className="flex items-center gap-1">
              1:1 <ArrowRight className="h-3 w-3" /> SWARM
            </span>
          </div>
        </div>

        <Button
          onClick={handleWrap}
          disabled={loading || !amount || Number(amount) <= 0}
          className="w-full"
        >
          {loading ? "Processing..." : "Wrap to SWARM"}
        </Button>
      </div>

      {/* Info */}
      <div className="text-xs text-foreground/60 space-y-1 p-3 rounded-lg bg-background/50 border border-border/30">
        <p className="font-medium">How it works:</p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>Credits are earned rewards, SWARM tokens are mined</li>
          <li>Network takes 5% of all mining to fund the reward pool</li>
          <li>Wrap your credits 1:1 when pool has balance</li>
          <li>First-come, first-served queue system</li>
        </ul>
      </div>
    </Card>
  );
}
