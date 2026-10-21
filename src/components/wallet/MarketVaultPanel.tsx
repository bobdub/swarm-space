import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Landmark, Lock } from "lucide-react";
import { toast } from "sonner";
import { getCurrentUser, getCachedPrivateKey, loginUser } from "@/lib/auth";
import { useMarketGate } from "@/hooks/useMarketGate";
import { useCreditBalance } from "@/hooks/useCreditBalance";
import { marketVaultLayers, quoteVaultBuy, spotCreditsPerSwarm, type MarketVaultState } from "@/lib/blockchain/marketVaultPricing";
import { buySwarmFromVault, getMarketVaultState, getVaultTokenHeld, swapSwarmForToken, swapTokenForSwarm, getCreatorMarketRate, swapCreatorTokenForSwarm } from "@/lib/blockchain/marketVault";
import { quoteSwarmForToken, quoteTokenForSwarm, quoteCreatorTokenForSwarm } from "@/lib/blockchain/marketVaultPricing";
import { listCustomTokens, type CustomToken } from "@/lib/blockchain/deposits/customTokens";
import { useNativeAssets } from "@/hooks/useNativeAssets";
import { nativeMarketPayments } from "@/lib/blockchain/wallets/nativeAssets";
import { getSwarmBalance } from "@/lib/blockchain/token";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const fmt = (n: number, d = 4) => n.toLocaleString(undefined, { maximumFractionDigits: d });

export function MarketVaultPanel() {
  const user = getCurrentUser();
  const { canTrade, reason } = useMarketGate();
  const { balance: credits, refresh: refreshCredits } = useCreditBalance(user?.id ?? null);
  const [state, setState] = useState<MarketVaultState | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [payWith, setPayWith] = useState("");
  const [sellFor, setSellFor] = useState("");
  const [sellAmount, setSellAmount] = useState("");
  const [held, setHeld] = useState<Record<string, number>>({});
  const [swarm, setSwarm] = useState(0);
  const nativeAssets = useNativeAssets(user?.id ?? "");
  const payments = useMemo(() => nativeMarketPayments(nativeAssets), [nativeAssets]);
  const paymentId = payments.some((asset) => asset.id === payWith) ? payWith : payments[0]?.id ?? "";
  const payment = payments.find((asset) => asset.id === paymentId);
  const unsupportedPayment = payment && payment.kind !== "credits" && payment.kind !== "custom" && payment.kind !== "creator";
  const creatorId = payment?.kind === "creator" ? payment.id.slice("creator:".length) : "";
  const [creatorRate, setCreatorRate] = useState<{ tokenId: string; rate: number } | null>(null);
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  useEffect(() => {
    let disposed = false;
    setCreatorRate(null);
    setPassphrase("");
    if (creatorId) void getCachedPrivateKey().then((key) => { if (!disposed) setNeedsUnlock(!key); });
    if (creatorId) void getCreatorMarketRate(creatorId).then((rate) => {
      if (!disposed) setCreatorRate({ tokenId: creatorId, rate });
    }).catch(() => {});
    return () => { disposed = true; };
  }, [creatorId, state]);
  const liveRate = creatorRate?.tokenId === creatorId ? creatorRate.rate : 0;
  const creatorQuote = state && creatorId ? quoteCreatorTokenForSwarm(state, liveRate, Number(amount), payment?.available ?? 0) : null;
  const tokens: CustomToken[] = useMemo(() => (user?.id ? listCustomTokens(user.id) : []), [user?.id, state]);

  const load = useCallback(() => {
    void getMarketVaultState().then(setState).catch(() => {});
    if (user?.id) void getSwarmBalance(user.id).then(setSwarm).catch(() => {});
    if (user?.id) void Promise.all(listCustomTokens(user.id).map(async (t) => [t.address, await getVaultTokenHeld(t.address)] as const))
      .then((rows) => setHeld(Object.fromEntries(rows))).catch(() => {});
  }, [user?.id]);
  useEffect(() => {
    load();
    window.addEventListener("reward-pool-update", load);
    window.addEventListener("blockchain-transaction", load);
    window.addEventListener("creator-vault-update", load);
    return () => {
      window.removeEventListener("reward-pool-update", load);
      window.removeEventListener("blockchain-transaction", load);
      window.removeEventListener("creator-vault-update", load);
    };
  }, [load]);

  const layers = state ? marketVaultLayers(state) : null;
  const quote = useMemo(() => (state ? quoteVaultBuy(state, Number(amount), credits) : null), [state, amount, credits]);
  const payToken = payment?.kind === "custom" ? payment : undefined;
  const tokenQuote = state && payToken && user?.id
    ? quoteTokenForSwarm(state, held[payToken.contract ?? ""] ?? 0, Number(amount), payToken.available) : null;
  const sellToken = tokens.find((t) => t.address === sellFor);
  const sellQuote = state && sellToken ? quoteSwarmForToken(state, held[sellToken.address] ?? 0, Number(sellAmount), swarm) : null;

  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    try { toast.success(await fn()); setAmount(""); setSellAmount(""); refreshCredits(); load(); }
    catch (err) { toast.error(err instanceof Error ? err.message : "Trade failed"); }
    finally { setBusy(false); }
  };

  const buy = async () => {
    if (!user?.id || payment?.kind !== "credits" || !canTrade || !quote || quote.error) return;
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
              <Label>Pay with</Label>
              <Select value={paymentId} onValueChange={(value) => { setPayWith(value); setAmount(""); }}>
                <SelectTrigger aria-label="Pay with" disabled={payments.length === 0}><SelectValue placeholder="No positive Native balances" /></SelectTrigger>
                <SelectContent>
                  {payments.map((asset) => (
                    <SelectItem key={asset.id} value={asset.id}>
                      {asset.label} ({fmt(asset.amount, 6)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="vault-buy">{payment && payment.kind !== "credits" ? `${payment.symbol} to pay` : "SWARM to buy"}</Label>
              <Input id="vault-buy" type="number" min="0" step="0.0001" placeholder="1" value={amount} onChange={(e) => setAmount(e.target.value)} />
              {payment?.kind === "credits" && (
                <p className="mt-1 text-xs text-muted-foreground">Max this trade {quote ? fmt(quote.maxSwarm) : "—"} SWARM</p>
              )}
            </div>
            {payment?.kind === "credits" && quote && quote.swarm > 0 && (
              <div className="rounded-md border bg-muted/40 p-2 text-xs space-y-0.5">
                <Row k="Cost" v={`${quote.credits.toLocaleString()} Credits`} />
                <Row k="Average price" v={`${fmt(quote.avgCreditsPerSwarm, 2)} Credits / SWARM`} />
                {quote.error && <p className="pt-1 text-destructive">{quote.error}</p>}
              </div>
            )}
            {payToken && tokenQuote && Number(amount) > 0 && (
              <div className="rounded-md border bg-muted/40 p-2 text-xs space-y-0.5">
                <Row k="You receive" v={`${fmt(tokenQuote.out, 6)} SWARM`} />
                <Row k={`Vault holds`} v={`${fmt(held[payToken.contract ?? ""] ?? 0, 2)} ${payToken.symbol}`} />
                {tokenQuote.error && <p className="pt-1 text-destructive">{tokenQuote.error}</p>}
              </div>
            )}
            {!canTrade && <p className="text-xs text-muted-foreground">{reason}</p>}
            {creatorId && creatorQuote && (
              <div className="rounded-md border bg-muted/40 p-2 text-xs space-y-0.5">
                <Row k="Live profile-market rate" v={liveRate > 0 ? `${fmt(liveRate, 6)} SWARM / ${payment?.symbol}` : "Unavailable"} />
                {Number(amount) > 0 && <Row k="You receive" v={`${fmt(creatorQuote.out, 6)} SWARM`} />}
                {Number(amount) > 0 && creatorQuote.error && <p className="pt-1 text-destructive">{creatorQuote.error}</p>}
              </div>
            )}
            {creatorId && needsUnlock && (
              <div className="space-y-1">
                <Label htmlFor="vault-creator-passphrase">Account passphrase</Label>
                <Input id="vault-creator-passphrase" type="password" autoComplete="current-password" value={passphrase} disabled={busy} onChange={(e) => setPassphrase(e.target.value)} />
              </div>
            )}
            {unsupportedPayment && <p role="status" className="text-xs text-muted-foreground">{payment.symbol} is held in your Native wallet. Vault payment settlement for this asset is not available yet; no tokens will be deducted.</p>}
            {creatorId ? (
              <Button type="button" className="w-full" disabled={busy || !canTrade || !user?.id || !creatorQuote || !!creatorQuote.error || (needsUnlock && !passphrase)}
                onClick={() => { if (!user?.id || !canTrade) return; const userId = user.id; void run(async () => {
                  if (needsUnlock) { await loginUser(passphrase); setPassphrase(""); setNeedsUnlock(false); }
                  const q = await swapCreatorTokenForSwarm(userId, creatorId, Number(amount), liveRate); return `Received ${fmt(q.out, 6)} SWARM`;
                }); }}>
                {busy ? "Swapping…" : `Swap ${payment?.symbol} for SWARM`}
              </Button>
            ) : payToken ? (
              <Button type="button" className="w-full" disabled={busy || !canTrade || !user?.id || !tokenQuote || !!tokenQuote.error}
                onClick={() => { if (!user?.id || !payToken.contract || !canTrade) return; const userId = user.id; const contract = payToken.contract; void run(async () => { const q = await swapTokenForSwarm(userId, contract, Number(amount)); return `Received ${fmt(q.out, 6)} SWARM`; }); }}>
                {busy ? "Swapping…" : `Swap ${payToken.symbol} for SWARM`}
              </Button>
            ) : (
              <Button type="button" className="w-full" disabled={busy || !canTrade || !user?.id || payment?.kind !== "credits" || !quote || !!quote.error} onClick={buy}>
                {busy ? "Buying…" : "Buy from vault"}
              </Button>
            )}
            <p className="text-[10px] text-muted-foreground">
              {creatorId ? "Creator tokens you pay stay in the Market Vault." : "Deposited tokens must be synced to a peer before use. Tokens you pay stay in the vault for future sellers."}
            </p>
          </TabsContent>
          <TabsContent value="sell" className="space-y-3">
            <div>
              <Label>Receive</Label>
              <Select value={sellFor} onValueChange={setSellFor}>
                <SelectTrigger><SelectValue placeholder="Choose a token the vault holds" /></SelectTrigger>
                <SelectContent>
                  {tokens.map((t) => (
                    <SelectItem key={t.address} value={t.address} disabled={(held[t.address] ?? 0) <= 0}>
                      {t.symbol} (vault holds {fmt(held[t.address] ?? 0, 2)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {tokens.length === 0 && <p className="mt-1 text-xs text-muted-foreground">Add a token in your wallet's MetaMask tab first.</p>}
            </div>
            <div>
              <Label htmlFor="vault-sell">SWARM to sell</Label>
              <Input id="vault-sell" type="number" min="0" step="0.0001" placeholder="1" value={sellAmount} onChange={(e) => setSellAmount(e.target.value)} />
              <p className="mt-1 text-xs text-muted-foreground">You have {fmt(swarm)} SWARM</p>
            </div>
            {sellToken && sellQuote && Number(sellAmount) > 0 && (
              <div className="rounded-md border bg-muted/40 p-2 text-xs">
                <Row k="You receive" v={`${fmt(sellQuote.out, 6)} ${sellToken.symbol}`} />
                {sellQuote.error && <p className="pt-1 text-destructive">{sellQuote.error}</p>}
              </div>
            )}
            <Button type="button" className="w-full" disabled={busy || !canTrade || !user?.id || !sellToken || !sellQuote || !!sellQuote.error}
              onClick={() => { if (!user?.id || !sellToken || !canTrade) return; const userId = user.id; const token = sellToken; void run(async () => { const q = await swapSwarmForToken(userId, token.address, Number(sellAmount)); return `Received ${fmt(q.out, 6)} ${token.symbol}`; }); }}>
              {busy ? "Selling…" : "Sell to vault"}
            </Button>
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
