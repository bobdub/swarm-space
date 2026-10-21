import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Landmark, Lock } from "lucide-react";
import { toast } from "sonner";
import { getCurrentUser } from "@/lib/auth";
import { useMarketGate } from "@/hooks/useMarketGate";
import { useCreditBalance } from "@/hooks/useCreditBalance";
import { marketVaultLayers, quoteVaultBuy, spotCreditsPerSwarm, type MarketVaultState } from "@/lib/blockchain/marketVaultPricing";
import { buySwarmFromVault, getMarketVaultState } from "@/lib/blockchain/marketVault";

const fmt = (n: number, d = 4) => n.toLocaleString(undefined, { maximumFractionDigits: d });

export function MarketVaultPanel() {
  const user = getCurrentUser();
  const { canTrade, reason } = useMarketGate();
  const { balance: credits, refresh: refreshCredits } = useCreditBalance(user?.id ?? null);
  const [state, setState] = useState<MarketVaultState | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => { void getMarketVaultState().then(setState).catch(() => {}); }, []);
  useEffect(() => {
    load();
    window.addEventListener("reward-pool-update", load);
    window.addEventListener("blockchain-transaction", load);
    return () => {
      window.removeEventListener("reward-pool-update", load);
      window.removeEventListener("blockchain-transaction", load);
    };
  }, [load]);

  const layers = state ? marketVaultLayers(state) : null;
  const quote = useMemo(() => (state ? quoteVaultBuy(state, Number(amount), credits) : null), [state, amount, credits]);

  const buy = async () => {
    if (!user?.id || !quote || quote.error) return;
    setBusy(true);
    try {
      const done = await buySwarmFromVault(user.id, quote.swarm);
      toast.success(`Bought ${fmt(done.swarm)} SWARM for ${done.credits} Credits`);
      setAmount("");
      refreshCredits();
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Purchase failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Landmark className="h-5 w-5 text-primary" /> Market Vault
        </CardTitle>
        <CardDescription>
          Trade with the community pool instead of waiting for another person. 40% of the pool is a protected floor that is never traded.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <Stat label="Vault (pool)" value={layers ? `${fmt(layers.pool, 2)} SWARM` : "—"} />
          <Stat label="Protected floor" value={layers ? `${fmt(layers.floor, 2)} SWARM` : "—"} icon />
          <Stat label="Liquid to trade" value={layers ? `${fmt(layers.liquid, 2)} SWARM` : "—"} />
          <Stat label="Spot price" value={state ? `${fmt(spotCreditsPerSwarm(state), 1)} Credits` : "—"} />
        </div>

        <Tabs defaultValue="buy">
          <TabsList className="grid grid-cols-2">
            <TabsTrigger value="buy">Buy SWARM</TabsTrigger>
            <TabsTrigger value="sell">Sell SWARM</TabsTrigger>
          </TabsList>
          <TabsContent value="buy" className="space-y-3">
            <div>
              <Label htmlFor="vault-buy">SWARM to buy</Label>
              <Input id="vault-buy" type="number" min="0" step="0.0001" placeholder="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <p className="mt-1 text-xs text-muted-foreground">
                Pay with Credits · you have {credits.toLocaleString()} · max this trade {quote ? fmt(quote.maxSwarm) : "—"} SWARM
              </p>
            </div>
            {quote && quote.swarm > 0 && (
              <div className="rounded-md border bg-muted/40 p-2 text-xs space-y-0.5">
                <Row k="Cost" v={`${quote.credits.toLocaleString()} Credits`} />
                <Row k="Average price" v={`${fmt(quote.avgCreditsPerSwarm, 2)} Credits / SWARM`} />
                {quote.error && <p className="pt-1 text-destructive">{quote.error}</p>}
              </div>
            )}
            {!canTrade && <p className="text-xs text-muted-foreground">{reason}</p>}
            <Button type="button" className="w-full" disabled={busy || !canTrade || !user?.id || !quote || !!quote.error} onClick={buy}>
              {busy ? "Buying…" : "Buy from vault"}
            </Button>
            <div className="flex flex-wrap gap-1 text-[10px]">
              <Badge variant="outline">Credits · live</Badge>
              <Badge variant="secondary">MintMe · coming</Badge>
              <Badge variant="secondary">ETH · coming</Badge>
              <Badge variant="secondary">Creator tokens · coming</Badge>
            </div>
          </TabsContent>
          <TabsContent value="sell" className="space-y-2 text-sm text-muted-foreground">
            <p>Selling SWARM back to the vault opens once the vault holds other assets it can pay you in (MintMe, ETH or creator tokens).</p>
            <p className="text-xs">Those deposits must be verified first, so the vault never pays out something it doesn't really hold.</p>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon?: boolean }) {
  return (
    <div className="rounded-md border p-2">
      <div className="flex items-center gap-1 text-muted-foreground">{icon && <Lock className="h-3 w-3" />}{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between"><span className="text-muted-foreground">{k}</span><span className="font-medium text-foreground">{v}</span></div>
  );
}
