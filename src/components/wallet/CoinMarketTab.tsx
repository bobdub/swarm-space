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
import { ExternalLink, ShieldAlert, Store, Wallet as WalletIcon } from "lucide-react";
import { toast } from "sonner";
import { getCurrentUser } from "@/lib/auth";
import { getAll } from "@/lib/store";
import type { CoinListing, CoinMarketCurrency, SwarmCoin } from "@/lib/blockchain/types";
import {
  blockExplorerUrl,
  cancelListing,
  computeMarketTier,
  confirmPayment,
  disputeListing,
  getAllListings,
  isValidAddress,
  listCoinForSale,
  listingStatusLabel,
  reserveListing,
  settleListing,
} from "@/lib/blockchain/coinMarket";
import { formatSyncAge, usePoolConnectivity } from "@/hooks/usePoolConnectivity";
import { isMetaMaskAvailable } from "@/lib/blockchain/wallets/metaMaskBridge";

const CURRENCIES: { value: CoinMarketCurrency; label: string; hint: string }[] = [
  { value: "ETH",    label: "ETH — Ethereum", hint: "Send to the address shown by the seller." },
  { value: "BTC",    label: "BTC — Bitcoin",  hint: "Send to the seller's BTC address." },
  { value: "MINTME", label: "MintMe",         hint: "MintMe uses an ETH-format address." },
];

export function CoinMarketTab() {
  const user = getCurrentUser();
  const { pool, lastSyncedAt, isLive, isConnected, isFresh } = usePoolConnectivity();
  const [listings, setListings] = useState<CoinListing[]>([]);
  const [walletCoins, setWalletCoins] = useState<SwarmCoin[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(async () => {
    const [all, coins] = await Promise.all([
      getAllListings(),
      getAll<SwarmCoin>("swarmCoins"),
    ]);
    setListings(all);
    setWalletCoins(
      coins.filter((c) => c.ownerId === user?.id && c.status === "wallet"),
    );
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
                Sell mined SWARM coins for ETH, Bitcoin, or MintMe — peer-to-peer,
                settled through the SWARM mesh.
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
          {!isLive && (
            <Alert>
              <ShieldAlert className="h-4 w-4" />
              <AlertTitle>Read-only until mesh sync completes</AlertTitle>
              <AlertDescription>
                {isConnected
                  ? "Waiting for a fresh community-pool snapshot from peers."
                  : "Connect to the SWARM mesh to list, reserve, pay, or release. Cached listings are visible below."}
              </AlertDescription>
            </Alert>
          )}
          <Alert>
            <ShieldAlert className="h-4 w-4" />
            <AlertTitle>Off-chain settlement — verify before releasing</AlertTitle>
            <AlertDescription>
              This app never touches your seed phrase or private keys. Real
              coins move outside SWARM. <strong>Always verify payment on a
              block explorer</strong> before releasing an escrowed SWARM coin.
              Automated MetaMask escrow is coming soon.
            </AlertDescription>
          </Alert>
          <div className="flex flex-wrap items-center gap-3">
            <ListCoinDialog
              disabled={!isLive || walletCoins.length === 0}
              userId={user?.id ?? ""}
              walletCoins={walletCoins}
              onListed={refresh}
            />
            <Button variant="outline" disabled title="Automated escrow lands next release">
              <WalletIcon className="mr-2 h-4 w-4" />
              {isMetaMaskAvailable() ? "Connect wallet (soon)" : "MetaMask (soon)"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="open" className="space-y-4">
        <TabsList className="grid grid-cols-3 gap-1 h-auto">
          <TabsTrigger value="open">Open market ({openListings.length})</TabsTrigger>
          <TabsTrigger value="mine">My listings ({myListings.length})</TabsTrigger>
          <TabsTrigger value="buys">My purchases ({myPurchases.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="open">
          <ListingGrid listings={openListings} currentUserId={user?.id ?? ""} isLive={isLive} onChange={refresh} empty="No open listings yet. Be the first to sell a mined coin." />
        </TabsContent>
        <TabsContent value="mine">
          <ListingGrid listings={myListings} currentUserId={user?.id ?? ""} isLive={isLive} onChange={refresh} empty="You haven’t listed any coins yet." />
        </TabsContent>
        <TabsContent value="buys">
          <ListingGrid listings={myPurchases} currentUserId={user?.id ?? ""} isLive={isLive} onChange={refresh} empty="You haven’t reserved any listings yet." />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── List dialog ────────────────────────────────────────────────────────

function ListCoinDialog({
  disabled,
  userId,
  walletCoins,
  onListed,
}: {
  disabled: boolean;
  userId: string;
  walletCoins: SwarmCoin[];
  onListed: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [coinId, setCoinId] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<CoinMarketCurrency>("ETH");
  const [address, setAddress] = useState("");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);

  const addressValid = address.trim().length === 0 || isValidAddress(currency, address);

  const submit = async () => {
    if (!userId) return;
    setBusy(true);
    try {
      await listCoinForSale({
        sellerId: userId,
        coinId,
        askAmount: Number(amount),
        askCurrency: currency,
        receivingAddress: address,
        memo,
      });
      toast.success("Coin listed on the market");
      onListed();
      setOpen(false);
      setCoinId("");
      setAmount("");
      setAddress("");
      setMemo("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to list coin");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button disabled={disabled}>
          <Store className="mr-2 h-4 w-4" />
          List a mined coin
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>List a SWARM coin for sale</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Coin</Label>
            <Select value={coinId} onValueChange={setCoinId}>
              <SelectTrigger>
                <SelectValue placeholder="Pick a mined coin from your wallet" />
              </SelectTrigger>
              <SelectContent>
                {walletCoins.map((c) => (
                  <SelectItem key={c.coinId} value={c.coinId}>
                    {c.coinId.slice(0, 10)}… · weight {c.weight}/{c.maxWeight}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Ask price</Label>
              <Input
                type="number"
                step="0.0001"
                min="0"
                placeholder="0.05"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
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
          <div>
            <Label>Your receiving address ({currency})</Label>
            <Input
              placeholder={currency === "BTC" ? "bc1..." : "0x..."}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
            {!addressValid && (
              <p className="text-xs text-destructive mt-1">Doesn’t look like a valid {currency} address.</p>
            )}
          </div>
          <div>
            <Label>Note to buyers (optional)</Label>
            <Textarea placeholder="Memo / payment reference" value={memo} onChange={(e) => setMemo(e.target.value)} />
          </div>
          <Alert>
            <ShieldAlert className="h-4 w-4" />
            <AlertDescription className="text-xs">
              You are responsible for verifying payment on a block explorer
              before releasing the escrowed coin. Never share your seed phrase.
            </AlertDescription>
          </Alert>
        </div>
        <DialogFooter>
          <Button
            onClick={submit}
            disabled={busy || !coinId || !amount || Number(amount) <= 0 || !isValidAddress(currency, address)}
          >
            {busy ? "Listing…" : "List coin"}
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
  isLive,
  onChange,
  empty,
}: {
  listings: CoinListing[];
  currentUserId: string;
  isLive: boolean;
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
          isLive={isLive}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

function ListingCard({
  listing,
  currentUserId,
  isLive,
  onChange,
}: {
  listing: CoinListing;
  currentUserId: string;
  isLive: boolean;
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [payHash, setPayHash] = useState("");
  const isSeller = listing.sellerId === currentUserId;
  const isBuyer = listing.buyerId === currentUserId;

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
              Coin {listing.coinId.slice(0, 10)}… · Tier {listing.tier}
            </CardDescription>
          </div>
          <Badge variant={statusColor[listing.status] ?? "default"}>
            {listingStatusLabel(listing.status)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="text-xs text-muted-foreground break-all">
          <span className="font-medium text-foreground">Send to:</span> {listing.receivingAddress}
        </div>
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
            <Button size="sm" disabled={!isLive || busy} onClick={() => run(() =>
              reserveListing({ listingId: listing.listingId, buyerId: currentUserId }),
              "Listing reserved",
            )}>Reserve</Button>
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
                <Button size="sm" disabled={!isLive || busy || payHash.trim().length < 6} onClick={() => run(() =>
                  confirmPayment({ listingId: listing.listingId, buyerId: currentUserId, paymentTxHash: payHash }),
                  "Payment recorded — waiting for seller to release",
                )}>I paid</Button>
                <Button size="sm" variant="outline" disabled={!isLive || busy} onClick={() => run(() =>
                  cancelListing({ listingId: listing.listingId, actorId: currentUserId }),
                  "Reservation cancelled",
                )}>Cancel</Button>
              </div>
            </div>
          )}
          {isBuyer && listing.status === "paid" && (
            <Button size="sm" variant="destructive" disabled={!isLive || busy} onClick={() => run(() =>
              disputeListing({ listingId: listing.listingId, buyerId: currentUserId, reason: "Seller has not released" }),
              "Dispute filed",
            )}>Dispute</Button>
          )}

          {/* Seller actions */}
          {isSeller && listing.status === "paid" && (
            <Button size="sm" disabled={!isLive || busy} onClick={() => run(() =>
              settleListing({ listingId: listing.listingId, sellerId: currentUserId }),
              "Coin released to buyer",
            )}>Release coin</Button>
          )}
          {isSeller && (listing.status === "open" || listing.status === "reserved") && (
            <Button size="sm" variant="outline" disabled={!isLive || busy} onClick={() => run(() =>
              cancelListing({ listingId: listing.listingId, actorId: currentUserId }),
              "Listing cancelled",
            )}>Cancel</Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
