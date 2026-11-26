import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { donateToRewardPool } from "@/lib/blockchain/creditWrapping";
import { donateCreditsToVault, donateTokenToVault } from "@/lib/blockchain/marketVault";
import { getCreditBalance } from "@/lib/credits";
import { CUSTOM_TOKENS_EVENT, customTokenNetwork, customTokenRef, getAvailableTokenBalance, listCustomTokens } from "@/lib/blockchain/deposits/customTokens";
import { TOKEN_NETWORKS } from "@/lib/blockchain/deposits/tokenNetworks";
import { getSwarmBalance } from "@/lib/blockchain/token";
import { useAuth } from "@/hooks/useAuth";
import { getWalletTipAssets, sendWalletTip } from "@/lib/blockchain/wallets/walletTips";
import { nativeWalletAddress } from "@/lib/blockchain/wallets/nativeAddress";
import { INFINITY_GIFT_VAULT } from "@/lib/blockchain/infinity/vaults";

/** `contract` is the token ref (chain + contract); `network` labels imported tokens. */
interface DonationAsset {
  id: string; symbol: string; balance: number; contract?: string; network?: string; credits?: boolean;
  /** Held assets the Market Vault can't take in (native MINTME, ETH, creator tokens): a signed gift to Infinity's donations vault. */
  tipAssetId?: string;
}

/**
 * Support the Vault — voluntary donations that deepen the Market Vault: SWARM
 * into the reward pool, or synced imported tokens (MintMe tokens such as Dreams,
 * Ethereum tokens such as MTCG) into its token holdings.
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
    const [swarm, credits] = await Promise.all([getSwarmBalance(user.id), getCreditBalance(user.id).catch(() => 0)]);
    const tokens = listCustomTokens(user.id)
      .map((t) => {
        const ref = customTokenRef(t);
        return { id: ref, symbol: t.symbol, contract: ref, network: TOKEN_NETWORKS[customTokenNetwork(t)].label, balance: getAvailableTokenBalance(user.id, ref) };
      })
      .filter((t) => t.balance > 0);
    // Everything else the member holds goes as a signed gift to Infinity's donations vault.
    const tipped = (await getWalletTipAssets(user.id).catch(() => []))
      .filter((a) => a.kind !== "credits" && a.id !== "chain:SWARM" && !a.id.startsWith("custom:") && !a.unavailable && a.balance > 0)
      .map((a) => ({ id: `tip:${a.id}`, symbol: a.ticker, balance: a.balance, network: a.kind === "creator" ? "creator token" : a.name, tipAssetId: a.id }));
    setAssets([{ id: "SWARM", symbol: "SWARM", balance: swarm }, { id: "CREDITS", symbol: "Credits", balance: credits, credits: true }, ...tokens, ...tipped]);
  }, [user]);

  useEffect(() => {
    void refresh();
    const events = ["blockchain-transaction", "credit-transaction", "reward-pool-update", "swarm-block-mined", "wallet-tip-updated", "creator-vault-update", CUSTOM_TOKENS_EVENT];
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
    if (asset.credits && !Number.isSafeInteger(donation)) {
      toast.error("Credits are donated in whole numbers");
      return;
    }
    if (donation > asset.balance) {
      toast.error(`Insufficient ${asset.symbol} balance`);
      return;
    }
    setDonating(true);
    try {
      if (asset.credits) await donateCreditsToVault(user.id, donation);
      else if (asset.contract) await donateTokenToVault(user.id, asset.contract, donation);
      else if (asset.tipAssetId) {
        await sendWalletTip({ recipient: await nativeWalletAddress(INFINITY_GIFT_VAULT), assetId: asset.tipAssetId, amount: donation, intent: "tip" });
      } else await donateToRewardPool(user.id, donation);
      toast.success(`Thank you for donating ${donation} ${asset.symbol}${asset.tipAssetId ? " to the project's donations vault" : " to the Market Vault"}!`);
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
          Donate anything you hold. SWARM, Credits and synced MintMe and Ethereum tokens go to the Market Vault, where deeper liquidity means tighter spreads for everyone on the mesh. MINTME, ETH and creator tokens go to the project's donations vault. Every gift counts on the bar's donor board at market value.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="vault-donation-asset">Asset</Label>
        <Select value={asset.id} onValueChange={(v) => { setAssetId(v); setAmount(""); }} disabled={donating}>
          <SelectTrigger id="vault-donation-asset" aria-label="Donation asset"><SelectValue /></SelectTrigger>
          <SelectContent>
            {assets.map((a) => <SelectItem key={a.id} value={a.id}>{a.symbol}{a.network ? ` (${a.network})` : ""} · {a.balance.toLocaleString(undefined, { maximumFractionDigits: 6 })}</SelectItem>)}
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
              step={asset.credits ? 1 : "any"}
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
          {asset.credits ? " · Donated Credits pay members who sell SWARM to the vault for Credits." : ""}
          {asset.tipAssetId ? " · Sent, signed, to the project's donations vault." : ""}
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
