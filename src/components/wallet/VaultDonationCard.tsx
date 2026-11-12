import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { donateToRewardPool } from "@/lib/blockchain/creditWrapping";
import { getSwarmBalance } from "@/lib/blockchain/token";
import { useAuth } from "@/hooks/useAuth";

/**
 * Support the Vault — voluntary SWARM donations that deepen the Market Vault
 * reward pool, tightening buy/sell spreads for everyone on the mesh.
 */
export function VaultDonationCard() {
  const { user } = useAuth();
  const [amount, setAmount] = useState("");
  const [donating, setDonating] = useState(false);
  const [swarmBalance, setSwarmBalance] = useState(0);

  const refresh = useCallback(async () => {
    if (!user) return;
    setSwarmBalance(await getSwarmBalance(user.id));
  }, [user]);

  useEffect(() => {
    void refresh();
    const events = ["blockchain-transaction", "reward-pool-update", "swarm-block-mined"];
    const onUpdate = () => void refresh();
    events.forEach((event) => window.addEventListener(event, onUpdate));
    return () => events.forEach((event) => window.removeEventListener(event, onUpdate));
  }, [refresh]);

  const handleDonate = async () => {
    if (!user) {
      toast.error("Please log in");
      return;
    }
    const donation = Number(amount);
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
      toast.success(`Thank you for donating ${donation} SWARM to the Market Vault!`);
      setAmount("");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to donate");
    } finally {
      setDonating(false);
    }
  };

  if (!user) return null;

  return (
    <Card className="p-6 space-y-4">
      <div>
        <h3 className="text-lg font-semibold mb-1 flex items-center gap-2">
          <Heart className="h-5 w-5" />
          Support the Vault
        </h3>
        <p className="text-sm text-foreground/60">
          Donate SWARM directly to the Market Vault pool — deeper liquidity means tighter spreads for everyone on the mesh.
        </p>
      </div>

      <div className="space-y-2">
        <Label>Donation Amount</Label>
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
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
            type="button"
            onClick={() => setAmount(swarmBalance.toString())}
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
        type="button"
        onClick={handleDonate}
        disabled={donating || !amount || Number(amount) <= 0}
        variant="outline"
        className="w-full"
      >
        {donating ? "Processing..." : "Donate to the Vault"}
      </Button>
    </Card>
  );
}
