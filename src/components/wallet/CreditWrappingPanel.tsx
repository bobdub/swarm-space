import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Coins, ArrowRight, Clock, Heart } from "lucide-react";
import { toast } from "sonner";
import { requestCreditWrap, getWrapStats, donateToRewardPool } from "@/lib/blockchain/creditWrapping";
import { getCreditBalance } from "@/lib/credits";
import { getSwarmBalance } from "@/lib/blockchain/token";
import { useAuth } from "@/hooks/useAuth";
import type { WrapStats } from "@/lib/blockchain/creditWrapping";

export function CreditWrappingPanel() {
  const { user } = useAuth();
  const [amount, setAmount] = useState("");
  const [donateAmount, setDonateAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [donating, setDonating] = useState(false);
  const [stats, setStats] = useState<WrapStats>({ poolBalance: 0, pendingWraps: 0 });
  const [creditBalance, setCreditBalance] = useState(0);
  const [swarmBalance, setSwarmBalance] = useState(0);

  useEffect(() => {
    if (!user) return;

    const loadData = async () => {
      const [wrapStats, credits, swarm] = await Promise.all([
        getWrapStats(user.id),
        getCreditBalance(user.id),
        getSwarmBalance(user.id),
      ]);
      setStats(wrapStats);
      setCreditBalance(credits);
      setSwarmBalance(swarm);
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
      const [wrapStats, credits, swarm] = await Promise.all([
        getWrapStats(user.id),
        getCreditBalance(user.id),
        getSwarmBalance(user.id),
      ]);
      setStats(wrapStats);
      setCreditBalance(credits);
      setSwarmBalance(swarm);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to wrap credits");
    } finally {
      setLoading(false);
    }
  };

  const handleDonate = async () => {
    if (!user) {
      toast.error("Please log in");
      return;
    }

    const donation = Number(donateAmount);
    if (isNaN(donation) || donation <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    if (donation > swarmBalance) {
      toast.error("Insufficient SWARM balance");
      return;
    }

    setDonating(true);
    try {
      await donateToRewardPool(user.id, donation);
      toast.success(`Thank you for donating ${donation} SWARM to the reward pool!`);
      setDonateAmount("");
      
      // Refresh stats
      const [wrapStats, credits, swarm] = await Promise.all([
        getWrapStats(user.id),
        getCreditBalance(user.id),
        getSwarmBalance(user.id),
      ]);
      setStats(wrapStats);
      setCreditBalance(credits);
      setSwarmBalance(swarm);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to donate");
    } finally {
      setDonating(false);
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

      {/* Balance Overview */}
      <div className="grid grid-cols-2 gap-4">
        <div className="p-4 rounded-lg bg-accent/10 border border-border/50">
          <div className="text-xs text-foreground/60 mb-1">Your Credits</div>
          <div className="text-2xl font-bold text-primary">{creditBalance.toFixed(2)}</div>
          <div className="text-xs text-foreground/60 mt-1">Earned • Not Mined</div>
        </div>
        <div className="p-4 rounded-lg bg-accent/10 border border-border/50">
          <div className="text-xs text-foreground/60 mb-1">Your SWARM</div>
          <div className="text-2xl font-bold text-primary">{swarmBalance.toFixed(2)}</div>
          <div className="text-xs text-foreground/60 mt-1">Mined • On-Chain</div>
        </div>
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

      <Separator />

      {/* Donate to Pool */}
      <div className="space-y-4">
        <div>
          <h4 className="text-sm font-semibold mb-1 flex items-center gap-2">
            <Heart className="h-4 w-4" />
            Support the Network
          </h4>
          <p className="text-xs text-foreground/60">
            Donate SWARM to the reward pool to help others wrap their credits
          </p>
        </div>

        <div className="space-y-2">
          <Label>Donation Amount</Label>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Input
                type="number"
                value={donateAmount}
                onChange={(e) => setDonateAmount(e.target.value)}
                placeholder="0"
                min="1"
                max={swarmBalance}
                className="pr-20"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-foreground/60">
                SWARM
              </div>
            </div>
            <Button
              onClick={() => setDonateAmount(swarmBalance.toString())}
              variant="outline"
              size="sm"
            >
              Max
            </Button>
          </div>
          <div className="text-xs text-foreground/60">
            Available: {swarmBalance.toFixed(2)} SWARM
          </div>
        </div>

        <Button
          onClick={handleDonate}
          disabled={donating || !donateAmount || Number(donateAmount) <= 0}
          variant="outline"
          className="w-full"
        >
          {donating ? "Processing..." : "Donate to Pool"}
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
