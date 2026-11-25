import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { donateToRewardPool } from "@/lib/blockchain/creditWrapping";
import { donateTokenToVault } from "@/lib/blockchain/marketVault";
import { CUSTOM_TOKENS_EVENT, getAvailableTokenBalance, listCustomTokens } from "@/lib/blockchain/deposits/customTokens";
import { getSwarmBalance } from "@/lib/blockchain/token";
import { useAuth } from "@/hooks/useAuth";

interface DonationAsset { id: string; symbol: string; balance: number; contract?: string }

/**
 * Support the Vault — voluntary donations that deepen the Market Vault: SWARM
 * into the reward pool, or synced MintMe tokens (such as Dreams) into its token holdings.
 */
export function VaultDonationCard() {
  const { user } = useAuth();
  const [amount, setAmount] = useState("");
  const [donating, setDonating] = useState(false);
  const [assets, setAssets] = useState<DonationAsset[]>([{ id: "SWARM", symbol: "SWARM", balance: 0 }]);
  const [assetId, setAssetId] = useState("SWARM");
  const asset = assets.find((a) => a.id === assetId) ?? assets[0];

  const refresh = useCallback(async () => {
    if (!user) return;
    const swarm = await getSwarmBalance(user.id);
    const tokens = listCustomTokens(user.id)
      .map((t) => ({ id: t.address, symbol: t.symbol, contract: t.address, balance: getAvailableTokenBalance(user.id, t.address) }))
      .filter((t) => t.balance > 0);
    setAssets([{ id: "SWARM", symbol: "SWARM", balance: swarm }, ...tokens]);
  }, [user]);

  useEffect(() => {
    void refresh();
    const events = ["blockchain-transaction", "reward-pool-update", "swarm-block-mined", CUSTOM_TOKENS_EVENT];
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
    if (donation > asset.balance) {
      toast.error(`Insufficient ${asset.symbol} balance`);
      return;
    }
    setDonating(true);
    try {
      if (asset.contract) await donateTokenToVault(user.id, asset.contract, donation);
      else await donateToRewardPool(user.id, donation);
      toast.success(`Thank you for donating ${donation} ${asset.symbol} to the Market Vault!`);
      setAmount("");
      window.dispatchEvent(new Event("blockchain-transaction"));
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
          Donate SWARM or your synced MintMe tokens directly to the Market Vault — deeper liquidity means tighter spreads for everyone on the mesh.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="vault-donation-asset">Asset</Label>
        <Select value={asset.id} onValueChange={(v) => { setAssetId(v); setAmount(""); }} disabled={donating}>
          <SelectTrigger id="vault-donation-asset" aria-label="Donation asset"><SelectValue /></SelectTrigger>
          <SelectContent>
            {assets.map((a) => <SelectItem key={a.id} value={a.id}>{a.symbol} · {a.balance.toLocaleString(undefined, { maximumFractionDigits: 6 })}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="vault-donation-amount">Donation Amount</Label>
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Input
              id="vault-donation-amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              min="0"
              step="any"
              max={asset.balance}
              className="pr-20"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-foreground/60">
              {asset.symbol}
            </div>
          </div>
          <Button
            type="button"
            onClick={() => setAmount(asset.balance.toString())}
            variant="outline"
            size="sm"
          >
            Max
          </Button>
        </div>
        <div className="text-xs text-foreground/60">
          Available: {asset.balance.toLocaleString(undefined, { maximumFractionDigits: 6 })} {asset.symbol}
          {asset.contract ? " (synced with a peer)" : ""}
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
