import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExternalLink, ShieldAlert, Store, TrendingDown, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { getCurrentUser } from "@/lib/auth";
import type { CoinListing, CoinMarketCurrency } from "@/lib/blockchain/types";
import {
  blockExplorerUrl,
  cancelListing,
  computeMarketTier,
  confirmPayment,
  disputeListing,
  getAllListings,
  getCoinMarketStats,
  listSwarmForSale,
  listingStatusLabel,
  quoteBaseAsk,
  reserveListing,
  settleListing,
} from "@/lib/blockchain/coinMarket";
import { formatSyncAge, usePoolConnectivity } from "@/hooks/usePoolConnectivity";
import { getSwarmBalance } from "@/lib/blockchain/token";
import { BridgePanel } from "./BridgePanel";

const CURRENCIES: { value: CoinMarketCurrency; label: string; hint: string }[] = [
  { value: "ETH",    label: "ETH — Ethereum", hint: "Proceeds credit your in-app ETH balance." },
  { value: "BTC",    label: "BTC — Bitcoin",  hint: "Proceeds credit your in-app BTC balance." },
  { value: "MINTME", label: "MintMe",         hint: "Proceeds credit your in-app MintMe balance." },
];

export function CoinMarketTab() {
  const user = getCurrentUser();
  const { pool, lastSyncedAt, isLive, isConnected, isFresh } = usePoolConnectivity();
  const [listings, setListings] = useState<CoinListing[]>([]);
  const [walletSwarm, setWalletSwarm] = useState(0);
  const [marketStats, setMarketStats] = useState<Awaited<ReturnType<typeof getCoinMarketStats>> | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(async () => {
    const [all, balance, stats] = await Promise.all([
      getAllListings(),
      user?.id ? getSwarmBalance(user.id) : Promise.resolve(0),
      getCoinMarketStats(),
    ]);
    setListings(all);
    setMarketStats(stats);
    setWalletSwarm(balance);
  }, [user?.id]);

  useEffect(() => {
    refresh();
    const handler = () => setRefreshTick((n) => n + 1);
    window.addEventListener("coin-market-update", handler);
    window.addEventListener("blockchain-transaction", handler);
    return () => {
      window.removeEventListener("coin-market-update", handler);
      window.removeEventListener("blockchain-transaction", handler);
    };
  }, [refresh]);

  useEffect(() => { refresh(); }, [refresh, refreshTick]);

  const tier = useMemo(() => computeMarketTier(pool?.balance ?? 0), [pool?.balance]);
  const myListings   = useMemo(() => listings.filter((l) => l.sellerId === user?.id), [listings, user?.id]);
  const myPurchases  = useMemo(() => listings.filter((l) => l.buyerId === user?.id), [listings, user?.id]);
  const openListings = useMemo(
    () =>
      listings
        .filter((l) => l.status === "open" || l.status === "reserved" || l.status === "paid")
        .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1)),
    [listings],
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Store className="h-5 w-5 text-primary" /> Coin Market
              </CardTitle>
              <CardDescription>
                List wallet SWARM for ETH, Bitcoin, or MintMe — proceeds land in
                your in-app wallet and only leave through the MetaMask bridge.
              </CardDescription>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Badge variant={isLive ? "default" : "secondary"}>
                {isLive ? "Live · Mesh synced" : isConnected ? "Syncing…" : "Offline"}
              </Badge>
              <span className="text-[10px] text-muted-foreground">
                Last synced {lastSyncedAt ? formatSyncAge(Date.now() - Date.parse(lastSyncedAt)) : "never"}
              </span>
              <Badge variant="outline" className="text-[10px]">
                Tier {tier.tier} · {tier.label}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {!isLive && !isConnected && (
            <Alert>
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Read-only until mesh connects</AlertTitle>
              <AlertDescription>
                Cached listings are visible. New actions are saved locally and sync through the mesh when peers are available.
              </AlertDescription>
            </Alert>
          )}
          {isConnected && !isFresh && (
            <Alert>
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Mesh connected · refreshing pool</AlertTitle>
              <AlertDescription>
                Market actions stay available while the local ledger derives the newest community-pool balance.
              </AlertDescription>
            </Alert>
          )}
          {marketStats && (
            <div className="grid gap-2 sm:grid-cols-4 text-xs">
              <div className="rounded-md border p-2">
                <div className="text-muted-foreground">Base listing guide</div>
                <div className="font-semibold">{marketStats.basePriceSwarm.toFixed(4)} SWARM</div>
              </div>
              <div className="rounded-md border p-2">
                <div className="text-muted-foreground">Pool liquid</div>
                <div className="font-semibold">{(marketStats.poolLiquidRatio * 100).toFixed(2)}%</div>
              </div>
              <div className="rounded-md border p-2">
                <div className="text-muted-foreground">Known mined</div>
                <div className="font-semibold">{marketStats.minedCoinsKnown.toLocaleString()} coins</div>
              </div>
              <div className="rounded-md border p-2">
                <div className="text-muted-foreground">48h trend</div>
                <div className="font-semibold inline-flex items-center gap-1">
                  {marketStats.trendDirection === "down" ? <TrendingDown className="h-3 w-3" /> : <TrendingUp className="h-3 w-3" />}
                  {marketStats.trend48hPct === 0 ? "Flat" : `${marketStats.trend48hPct > 0 ? "+" : ""}${marketStats.trend48hPct.toFixed(2)}%`}
                </div>
              </div>
            </div>
          )}
          <Alert>
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Settles into your in-app wallet</AlertTitle>
            <AlertDescription>
              Sale proceeds credit your in-app ETH / BTC / MintMe balance —
              no external address needed. Move funds in and out through
              MetaMask in the bridge panel below. The app never touches your
              seed phrase or private keys.
            </AlertDescription>
          </Alert>
          <div className="flex flex-wrap items-center gap-3">
            <ListSwarmDialog
              disabled={!user?.id || walletSwarm <= 0}
              userId={user?.id ?? ""}
              walletSwarm={walletSwarm}
              marketStats={marketStats}
              onListed={refresh}
            />
          </div>
        </CardContent>
      </Card>

      <BridgePanel />

      <Tabs defaultValue="open" className="space-y-4">
        <TabsList className="grid grid-cols-3 gap-1 h-auto">
          <TabsTrigger value="open">Open market ({openListings.length})</TabsTrigger>
          <TabsTrigger value="mine">My listings ({myListings.length})</TabsTrigger>
          <TabsTrigger value="buys">My purchases ({myPurchases.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="open">
          <ListingGrid listings={openListings} currentUserId={user?.id ?? ""} onChange={refresh} empty="No open listings yet. Be the first to list SWARM." />
        </TabsContent>
        <TabsContent value="mine">
          <ListingGrid listings={myListings} currentUserId={user?.id ?? ""} onChange={refresh} empty="You haven’t listed any SWARM yet." />
        </TabsContent>
        <TabsContent value="buys">
          <ListingGrid listings={myPurchases} currentUserId={user?.id ?? ""} onChange={refresh} empty="You haven’t reserved any listings yet." />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── List dialog ────────────────────────────────────────────────────────

function ListSwarmDialog({
  disabled,
  userId,
  walletSwarm,
  marketStats,
  onListed,
}: {
  disabled: boolean;
  userId: string;
  walletSwarm: number;
  marketStats: Awaited<ReturnType<typeof getCoinMarketStats>> | null;
  onListed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [swarmAmount, setSwarmAmount] = useState("");
  const [askAmount, setAskAmount] = useState("");
  const [currency, setCurrency] = useState<CoinMarketCurrency>("ETH");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);

  const suggestedAsk = useMemo(() => quoteBaseAsk(currency, marketStats), [currency, marketStats]);
  const parsedSwarm = Number(swarmAmount);
  const suggestedTotal = Number.isFinite(parsedSwarm) && parsedSwarm > 0 ? suggestedAsk * parsedSwarm : suggestedAsk;

  const submit = async () => {
    if (!userId) return;
    setBusy(true);
    try {
      await listSwarmForSale({
        sellerId: userId,
        swarmAmount: Number(swarmAmount),
        askAmount: Number(askAmount),
        askCurrency: currency,
        memo,
      });
      toast.success("SWARM listed on the market");
      onListed();
      setOpen(false);
      setSwarmAmount("");
      setAskAmount("");
      setMemo("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to list SWARM");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={disabled}>
          <Store className="mr-2 h-4 w-4" />
          List SWARM for sale
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>List SWARM for sale</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>SWARM amount</Label>
            <Input
              type="number"
              step="0.000001"
              min="0"
              max={walletSwarm}
              placeholder="25"
              value={swarmAmount}
              onChange={(e) => setSwarmAmount(e.target.value)}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Available: {walletSwarm.toFixed(2)} SWARM. Listed SWARM moves into market escrow immediately.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Total ask price</Label>
              <Input
                type="number"
                step="0.0001"
                min="0"
                placeholder="0.05"
                value={askAmount}
                onChange={(e) => setAskAmount(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Dynamic guide: {suggestedTotal ? suggestedTotal.toFixed(6) : "—"} {currency} from synced pool liquidity.
              </p>
            </div>
            <div>
              <Label>Currency</Label>
              <Select value={currency} onValueChange={(v) => setCurrency(v as CoinMarketCurrency)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
            Proceeds credit your in-app <span className="font-medium text-foreground">{currency}</span> balance.
            Move funds in or out through MetaMask in the Bridge panel — no external address needed here.
          </div>
          <div>
            <Label>Note to buyers (optional)</Label>
            <Textarea placeholder="Memo / payment reference" value={memo} onChange={(e) => setMemo(e.target.value)} />
          </div>
          <Alert>
            <ShieldAlert className="h-4 w-4" />
            <AlertDescription className="text-xs">
              You are responsible for confirming the buyer's payment before
              releasing escrowed SWARM. Never share your seed phrase.
            </AlertDescription>
          </Alert>
        </div>
        <DialogFooter>
          <Button
            onClick={submit}
            disabled={busy || !swarmAmount || Number(swarmAmount) <= 0 || Number(swarmAmount) > walletSwarm || !askAmount || Number(askAmount) <= 0}
          >
            {busy ? "Listing…" : "List SWARM"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Listing card + grid ────────────────────────────────────────────────

function ListingGrid({
  listings,
  currentUserId,
  onChange,
  empty,
}: {
  listings: CoinListing[];
  currentUserId: string;
  onChange: () => void;
  empty: string;
}) {
  if (listings.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {empty}
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {listings.map((l) => (
        <ListingCard
          key={l.listingId}
          listing={l}
          currentUserId={currentUserId}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

function ListingCard({
  listing,
  currentUserId,
  onChange,
}: {
  listing: CoinListing;
  currentUserId: string;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [payHash, setPayHash] = useState("");
  const isSeller = listing.sellerId === currentUserId;
  const isBuyer = listing.buyerId === currentUserId;
  const isSwarmListing = (listing.assetType ?? "coin") === "swarm";
  const assetLabel = isSwarmListing
    ? `${(listing.swarmAmount ?? 0).toLocaleString()} SWARM`
    : `Coin ${listing.coinId.slice(0, 10)}…`;

  const run = async (fn: () => Promise<unknown>, label: string) => {
    setBusy(true);
    try {
      await fn();
      toast.success(label);
      onChange();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const statusColor: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
    open: "default",
    reserved: "secondary",
    paid: "outline",
    settled: "secondary",
    cancelled: "outline",
    disputed: "destructive",
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">
              {listing.askAmount} {listing.askCurrency}
            </CardTitle>
            <CardDescription className="text-xs">
              {assetLabel} · Tier {listing.tier}
            </CardDescription>
          </div>
          <Badge variant={statusColor[listing.status] ?? "default"}>
            {listingStatusLabel(listing.status)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {listing.receivingAddress ? (
          <div className="text-xs text-muted-foreground break-all">
            <span className="font-medium text-foreground">Legacy payout:</span> {listing.receivingAddress}
          </div>
        ) : (
          <div className="text-xs text-muted-foreground">
            Settles into seller's in-app {listing.askCurrency} wallet.
          </div>
        )}
        {listing.memo && (
          <div className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Note:</span> {listing.memo}
          </div>
        )}
        {listing.paymentTxHash && (
          <a
            href={blockExplorerUrl(listing.askCurrency, listing.paymentTxHash)}
            target="_blank"
            rel="noreferrer"
            className="text-xs inline-flex items-center gap-1 text-primary hover:underline break-all"
          >
            Payment: {listing.paymentTxHash.slice(0, 16)}… <ExternalLink className="h-3 w-3" />
          </a>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          {/* Buyer actions */}
          {!isSeller && listing.status === "open" && (
            <Button size="sm" disabled={!currentUserId || busy} onClick={() => {
              toast.info(`Load ${listing.askCurrency} payment — coming soon`);
              void run(() => reserveListing({ listingId: listing.listingId, buyerId: currentUserId }), "Listing reserved");
            }}>Buy</Button>
          )}
          {isBuyer && listing.status === "reserved" && (
            <div className="w-full space-y-2">
              <Label className="text-xs">Payment tx hash / reference</Label>
              <Input
                value={payHash}
                onChange={(e) => setPayHash(e.target.value)}
                placeholder="0xabc… or txid"
              />
              <div className="flex gap-2">
                <Button size="sm" disabled={busy || payHash.trim().length < 6} onClick={() => run(() =>
                  confirmPayment({ listingId: listing.listingId, buyerId: currentUserId, paymentTxHash: payHash }),
                  "Payment recorded — waiting for seller to release",
                )}>I paid</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() =>
                  cancelListing({ listingId: listing.listingId, actorId: currentUserId }),
                  "Reservation cancelled",
                )}>Cancel</Button>
              </div>
            </div>
          )}
          {isBuyer && listing.status === "paid" && (
            <Button size="sm" variant="destructive" disabled={busy} onClick={() => run(() =>
              disputeListing({ listingId: listing.listingId, buyerId: currentUserId, reason: "Seller has not released" }),
              "Dispute filed",
            )}>Dispute</Button>
          )}

          {/* Seller actions */}
          {isSeller && listing.status === "paid" && (
            <Button size="sm" disabled={busy} onClick={() => run(() =>
              settleListing({ listingId: listing.listingId, sellerId: currentUserId }),
              isSwarmListing ? "SWARM released to buyer" : "Coin released to buyer",
            )}>{isSwarmListing ? "Release SWARM" : "Release coin"}</Button>
          )}
          {isSeller && (listing.status === "open" || listing.status === "reserved") && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() =>
              cancelListing({ listingId: listing.listingId, actorId: currentUserId }),
              "Listing cancelled",
            )}>Cancel</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
