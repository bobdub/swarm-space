import { useCallback, useEffect, useMemo, useState } from "react";
import { Coins, TrendingUp, TrendingDown, Shield, Users, Wallet as WalletIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getUserProfileToken } from "@/lib/blockchain/profileToken";
import type { CreatorToken, CreatorVault } from "@/lib/blockchain/types";
import {
  buyCreatorTokens,
  ensureCreatorVault,
  getCreatorVault,
  ladderState,
  priceAtSupply,
  quoteBuy,
  quoteSell,
  sellCreatorTokens,
  withdrawCreatorEarnings,
} from "@/lib/blockchain/creatorVault";
import { getSwarmBalance } from "@/lib/blockchain/token";
import { getProfileTokenHolding } from "@/lib/blockchain/profileTokenBalance";
import { useToast } from "@/hooks/use-toast";

interface Props {
  profileUserId: string;
  isOwnProfile: boolean;
  viewerId: string | null;
}

function fmt(n: number, digits = 4) {
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function CreatorMarketTab({ profileUserId, isOwnProfile, viewerId }: Props) {
  const { toast } = useToast();
  const [token, setToken] = useState<CreatorToken | null>(null);
  const [vault, setVault] = useState<CreatorVault | null>(null);
  const [swarm, setSwarm] = useState(0);
  const [heldTokens, setHeldTokens] = useState(0);
  const [buyAmount, setBuyAmount] = useState("10");
  const [sellAmount, setSellAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const t = await getUserProfileToken(profileUserId);
    setToken(t);
    if (t) {
      const v = (await getCreatorVault(t.tokenId)) ?? (await ensureCreatorVault(t.tokenId, profileUserId));
      setVault(v);
      if (viewerId) {
        const holding = await getProfileTokenHolding(viewerId, t.tokenId);
        setHeldTokens(holding?.amount ?? 0);
      }
    } else {
      setVault(null);
      setHeldTokens(0);
    }
    if (viewerId) setSwarm(await getSwarmBalance(viewerId));
  }, [profileUserId, viewerId]);

  useEffect(() => {
    void refresh();
    const onUpdate = () => void refresh();
    if (typeof window !== "undefined") {
      window.addEventListener("creator-vault-update", onUpdate);
      window.addEventListener("blockchain-transaction", onUpdate);
      return () => {
        window.removeEventListener("creator-vault-update", onUpdate);
        window.removeEventListener("blockchain-transaction", onUpdate);
      };
    }
  }, [refresh]);

  const buyN = Math.max(0, Number(buyAmount) || 0);
  const sellN = Math.max(0, Number(sellAmount) || 0);
  const buyQuote = useMemo(() => quoteBuy(vault, buyN), [vault, buyN]);
  const sellQuote = useMemo(() => quoteSell(vault, sellN), [vault, sellN]);
  const ladder = useMemo(() => ladderState(vault), [vault]);
  const currentPrice = priceAtSupply(vault?.circulatingSupply ?? 0);
  const unlockedSupply = token?.supply ?? 0;
  const circulating = vault?.circulatingSupply ?? 0;
  const availableForSale = Math.max(0, unlockedSupply - circulating);
  const buyExceedsAvailable = buyN > availableForSale;

  const handleBuy = async () => {
    if (!viewerId || !token || buyN <= 0) return;
    setBusy(true);
    try {
      await buyCreatorTokens({ buyerId: viewerId, tokenId: token.tokenId, tokens: buyN });
      toast({ title: "Purchase complete", description: `Bought ${buyN} ${token.ticker}` });
      await refresh();
    } catch (err) {
      toast({ title: "Purchase failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleSell = async () => {
    if (!viewerId || !token || sellN <= 0) return;
    setBusy(true);
    try {
      await sellCreatorTokens({ sellerId: viewerId, tokenId: token.tokenId, tokens: sellN });
      toast({ title: "Sold to vault", description: `Sold ${sellN} ${token.ticker}` });
      setSellAmount("");
      await refresh();
    } catch (err) {
      toast({ title: "Sell failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const handleWithdraw = async () => {
    if (!viewerId || !token) return;
    const amt = Number(withdrawAmount) || 0;
    if (amt <= 0) return;
    setBusy(true);
    try {
      await withdrawCreatorEarnings({ creatorId: viewerId, tokenId: token.tokenId, amount: amt });
      toast({ title: "Withdrawn", description: `${amt} SWARM to your wallet` });
      setWithdrawAmount("");
      await refresh();
    } catch (err) {
      toast({ title: "Withdraw failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <div className="rounded-3xl border border-dashed border-[hsla(174,59%,56%,0.25)] bg-[hsla(245,70%,12%,0.45)] px-6 py-16 text-center text-sm text-foreground/70 backdrop-blur-xl">
        {isOwnProfile ? (
          <>
            <p className="mb-3 font-display uppercase tracking-[0.2em] text-foreground">
              No Creator Token deployed
            </p>
            <p>
              Launch your token from the Wallet → Creator Token panel. It costs{" "}
              <span className="font-mono">1,000 credits + 50 SWARM</span>. Once live, this tab becomes
              your personal market.
            </p>
          </>
        ) : (
          "This creator hasn't launched a token market yet."
        )}
      </div>
    );
  }

  const v = vault;
  const canSell = (v?.currentTier ?? 0) > 0 && heldTokens > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-3xl border border-[hsla(174,59%,56%,0.22)] bg-[hsla(245,70%,10%,0.6)] p-6 backdrop-blur-xl">
        <div className="flex flex-wrap items-center gap-4">
          {token.image && (
            <img src={token.image} alt={token.ticker} className="h-16 w-16 rounded-2xl object-cover" />
          )}
          <div className="flex-1">
            <div className="font-display text-2xl uppercase tracking-[0.2em] text-foreground">
              {token.name}
            </div>
            <div className="text-sm text-foreground/60">
              ${token.ticker} · Creator Token Market
            </div>
            {token.description && (
              <p className="mt-2 text-sm text-foreground/70">{token.description}</p>
            )}
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-widest text-foreground/50">Current Price</div>
            <div className="font-mono text-2xl text-[hsl(174,59%,66%)]">
              {fmt(currentPrice, 6)} SWARM
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={<TrendingUp className="h-4 w-4" />} label="Circulating" value={fmt(v?.circulatingSupply ?? 0, 2)} />
        <StatCard
          icon={<Coins className="h-4 w-4" />}
          label="Available for Sale"
          value={`${fmt(availableForSale, 2)} / ${fmt(unlockedSupply, 0)}`}
        />
        <StatCard icon={<Coins className="h-4 w-4" />} label="Vault Total" value={`${fmt(v?.totalDeposited ?? 0, 2)} SWARM`} />
        <StatCard icon={<Shield className="h-4 w-4" />} label="Stability Floor" value={`${fmt(v?.stabilityFloor ?? 0, 2)} SWARM`} />
        <StatCard icon={<Users className="h-4 w-4" />} label="Community" value={`${fmt(v?.communityContributed ?? 0, 2)} SWARM`} />
        <StatCard icon={<WalletIcon className="h-4 w-4" />} label="Buyback Reserve" value={`${fmt(v?.buybackReserve ?? 0, 2)} SWARM`} />
        <StatCard icon={<TrendingDown className="h-4 w-4" />} label="Lifetime Buybacks" value={`${fmt(v?.lifetimeBuybacks ?? 0, 2)} SWARM`} />
        <StatCard icon={<Coins className="h-4 w-4" />} label="Creator Earnings" value={`${fmt(v?.creatorEarnings ?? 0, 2)} SWARM`} />
        <StatCard icon={<TrendingUp className="h-4 w-4" />} label="You Hold" value={`${fmt(heldTokens, 2)} ${token.ticker}`} />
      </div>

      {/* Ladder */}
      <div className="rounded-3xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,10%,0.45)] p-6">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-display uppercase tracking-[0.2em] text-foreground">Buyback Ladder</div>
          <div className="text-xs text-foreground/60">
            Active Tier: <span className="font-mono text-[hsl(174,59%,66%)]">T{ladder.active}</span> · Ratio{" "}
            {(ladder.ratio * 100).toFixed(1)}%
          </div>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {ladder.tiers.map((step) => {
            const active = ladder.active >= step.tier;
            return (
              <div
                key={step.tier}
                className={`rounded-xl border p-3 text-center text-xs transition ${
                  active
                    ? "border-[hsl(174,59%,56%)] bg-[hsla(174,59%,56%,0.15)] text-foreground"
                    : "border-[hsla(174,59%,56%,0.15)] bg-[hsla(245,70%,10%,0.35)] text-foreground/50"
                }`}
              >
                <div className="font-mono">T{step.tier}</div>
                <div className="mt-1 font-display uppercase tracking-widest">{step.label}</div>
                <div className="mt-1 text-[10px] text-foreground/60">
                  unlocks {Math.round(step.unlockShare * 100)}%
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Buy / Sell — open to everyone, including the creator */}
      {viewerId && (
        <div className="grid gap-6 md:grid-cols-2">
          <div role="form" className="rounded-3xl border border-[hsla(174,59%,56%,0.22)] bg-[hsla(245,70%,10%,0.55)] p-6 space-y-3">
            <div className="font-display uppercase tracking-[0.2em] text-foreground">Buy {token.ticker}</div>
            <div className="text-xs text-foreground/60">Your SWARM: {fmt(swarm, 4)}</div>
            <div className="text-[10px] uppercase tracking-widest text-foreground/50">
              Market has {fmt(availableForSale, 2)} {token.ticker} unlocked · {fmt(unlockedSupply, 0)}/
              {token.maxSupply.toLocaleString()} total supply unlocked
            </div>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              max={availableForSale}
              value={buyAmount}
              onChange={(e) => setBuyAmount(e.target.value)}
              placeholder="Tokens to buy"
            />
            <div className="text-sm text-foreground/70">
              Cost: <span className="font-mono">{fmt(buyQuote.cost, 4)} SWARM</span> · avg{" "}
              <span className="font-mono">{fmt(buyQuote.perToken, 6)}</span>/token
            </div>
            <Button
              type="button"
              onClick={handleBuy}
              disabled={busy || buyN <= 0 || buyQuote.cost > swarm || buyExceedsAvailable}
              className="w-full"
            >
              {buyExceedsAvailable
                ? `Only ${fmt(availableForSale, 2)} available`
                : buyQuote.cost > swarm
                  ? "Insufficient SWARM"
                  : `Buy ${buyN || 0} ${token.ticker}`}
            </Button>
          </div>

          <div role="form" className="rounded-3xl border border-[hsla(174,59%,56%,0.22)] bg-[hsla(245,70%,10%,0.55)] p-6 space-y-3">
            <div className="font-display uppercase tracking-[0.2em] text-foreground">Sell to Vault</div>
            <div className="text-xs text-foreground/60">You hold: {fmt(heldTokens, 4)} {token.ticker}</div>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              max={heldTokens}
              value={sellAmount}
              onChange={(e) => setSellAmount(e.target.value)}
              placeholder="Tokens to sell"
              disabled={!canSell}
            />
            <div className="text-sm text-foreground/70">
              Proceeds: <span className="font-mono">{fmt(sellQuote.proceeds, 4)} SWARM</span>{" "}
              {sellQuote.capped && sellN > 0 && (
                <span className="text-[10px] text-[hsl(45,90%,66%)]">(tier-capped)</span>
              )}
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={handleSell}
              disabled={busy || !canSell || sellN <= 0 || sellN > heldTokens || sellQuote.proceeds <= 0}
              className="w-full"
            >
              {ladder.active === 0
                ? "Buyback inactive"
                : `Sell ${sellN || 0} ${token.ticker}`}
            </Button>
          </div>
        </div>
      )}

      {/* Creator earnings withdraw */}
      {isOwnProfile && viewerId && (
        <div role="form" className="rounded-3xl border border-[hsla(326,71%,62%,0.25)] bg-[hsla(245,70%,10%,0.55)] p-6 space-y-3">
          <div className="font-display uppercase tracking-[0.2em] text-foreground">Creator Earnings</div>
          <div className="text-sm text-foreground/70">
            Available: <span className="font-mono">{fmt(v?.creatorEarnings ?? 0, 4)} SWARM</span>
          </div>
          <div className="flex gap-2">
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              max={v?.creatorEarnings ?? 0}
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              placeholder="Amount to withdraw"
            />
            <Button
              type="button"
              onClick={handleWithdraw}
              disabled={busy || !v || v.creatorEarnings <= 0 || Number(withdrawAmount) <= 0}
            >
              Withdraw
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,10%,0.45)] p-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-foreground/60">
        {icon} {label}
      </div>
      <div className="mt-1 font-mono text-lg text-foreground">{value}</div>
    </div>
  );
}