import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Coins, TrendingUp, TrendingDown, Shield, Users, Wallet as WalletIcon, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getProfileToken } from "@/lib/blockchain/storage";
import { creatorVaultAddress } from "@/lib/blockchain/creatorVaultCustody";
import { creatorVaultBacking } from "@/lib/blockchain/creatorVaultBacking";
import type { CreatorToken, CreatorVault } from "@/lib/blockchain/types";
import {
  buyCreatorTokens,
  closeCreatorMarket,
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
  const [custody, setCustody] = useState(0);
  const refreshVersion = useRef(0);
  const [heldTokens, setHeldTokens] = useState(0);
  const [buyAmount, setBuyAmount] = useState("10");
  const [sellAmount, setSellAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    const t = await getProfileToken(profileUserId);
    const [v, holding, balance, held] = await Promise.all([
      t ? getCreatorVault(t.tokenId) : Promise.resolve(null),
      t && viewerId ? getProfileTokenHolding(viewerId, t.tokenId) : Promise.resolve(null),
      viewerId ? getSwarmBalance(viewerId) : Promise.resolve(0),
      t ? getSwarmBalance(creatorVaultAddress(t.tokenId)) : Promise.resolve(0),
    ]);
    if (version !== refreshVersion.current) return;
    setToken(t); setVault(v); setHeldTokens(holding?.amount ?? 0);
    setSwarm(balance); setCustody(held);
  }, [profileUserId, viewerId]);

  useEffect(() => {
    void refresh();
    const onUpdate = () => void refresh();
    if (typeof window !== "undefined") {
      window.addEventListener("creator-token-updated", onUpdate);
      window.addEventListener("creator-vault-update", onUpdate);
      window.addEventListener("blockchain-transaction", onUpdate);
      return () => {
        ++refreshVersion.current;
        window.removeEventListener("creator-token-updated", onUpdate);
        window.removeEventListener("creator-vault-update", onUpdate);
        window.removeEventListener("blockchain-transaction", onUpdate);
      };
    }
  }, [refresh]);

  const buyN = Number.isFinite(Number(buyAmount)) ? Math.max(0, Number(buyAmount)) : 0;
  const sellN = Number.isFinite(Number(sellAmount)) ? Math.max(0, Number(sellAmount)) : 0;
  const buyQuote = useMemo(() => quoteBuy(vault, buyN), [vault, buyN]);
  const sellQuote = useMemo(() => quoteSell(vault, sellN), [vault, sellN]);
  const ladder = useMemo(() => ladderState(vault), [vault]);
  const currentPrice = priceAtSupply(vault?.circulatingSupply ?? 0);
  const unlockedSupply = token?.supply ?? 0;
  const circulating = vault?.circulatingSupply ?? 0;
  const availableForSale = Math.max(0, unlockedSupply - circulating);
  const buyExceedsAvailable = buyN > availableForSale;
  const isClosed = !!(vault?.closed || token?.closedAt);
  const backing = creatorVaultBacking(vault, custody);
  const isCreator = isOwnProfile && viewerId === token?.userId;
  const withdrawN = Number(withdrawAmount);
  const withdrawValid = Number.isFinite(withdrawN) && withdrawN > 0 && withdrawN <= backing.claimable;

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
    if (!viewerId || !token || !isCreator || !withdrawValid) return;
    const amt = withdrawN;
    if (!window.confirm(`Claim ${fmt(amt)} SWARM from the Creator Earnings layer to your native wallet?`)) return;
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

  const handleCloseMarket = async () => {
    if (!viewerId || !token || !isCreator) return;
    if (!window.confirm("Close this market permanently? This cannot be undone. The Open Market bucket will be sent to the community pool.")) return;
    setBusy(true);
    try {
      await closeCreatorMarket({ creatorId: viewerId, tokenId: token.tokenId });
      toast({ title: "Market closed" });
      await refresh();
    } catch (err) {
      toast({ title: "Close failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  if (!token) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/30 px-6 py-16 text-center text-sm text-foreground/70 backdrop-blur-xl">
        {isOwnProfile ? (
          <>
            <p className="mb-3 font-display uppercase tracking-[0.2em] text-foreground">
              No Creator Token deployed
            </p>
            <p>
              Launch your token from Wallet → Creator Token. Your current launch cost is shown there.
            </p>
          </>
        ) : (
          "This creator hasn't launched a token market yet."
        )}
      </div>
    );
  }

  const v = vault;
  const canSell = backing.backed && heldTokens > 0 && ((v?.buybackReserve ?? 0) > 0 || (v?.stabilityFloor ?? 0) > 0);

  return (
    <div className="space-y-6">
      <div className="border-b border-border pb-4 text-sm text-muted-foreground">
        Settlement: SWARM · Held in Coin Vault: <span className="font-mono text-foreground">{fmt(custody)} SWARM</span>
        {!vault && <p className="mt-2">No vault record yet. A purchase starts a funded vault; viewing this profile does not create one.</p>}
        {vault && !backing.backed && <p className="mt-2 text-destructive">Recorded layers exceed held SWARM by {fmt(backing.shortfall)}. Sell-backs, earnings claims and closure are unavailable until the vault is reconciled. Sync your wallet before retrying.</p>}
      </div>
      {isClosed && (
        <div className="rounded-md border border-border bg-muted/30 p-4 text-sm text-foreground/80 flex items-center gap-2">
          <Lock className="h-4 w-4 text-primary" /> This market is <strong className="mx-1">closed</strong> — trading and listings are disabled.
        </div>
      )}
      {/* Header */}
      <div className="rounded-md border border-border bg-muted/30 p-6 backdrop-blur-xl">
        {token.banner && (
          <img
            src={token.banner}
            alt={`${token.name} banner`}
            className="mb-5 aspect-[3/1] w-full rounded-md border border-border object-cover"
          />
        )}
        <div className="flex flex-wrap items-center gap-4">
          {token.image && (
            <img src={token.image} alt={token.ticker} className="h-16 w-16 rounded-md object-cover" />
          )}
          <div className="min-w-0 flex-1 break-words">
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
            <div className="font-mono text-2xl text-primary">
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
        <StatCard icon={<Coins className="h-4 w-4" />} label="Lifetime Deposits" value={`${fmt(v?.totalDeposited ?? 0, 2)} SWARM`} />
        <StatCard icon={<Shield className="h-4 w-4" />} label="Stability Floor" value={`${fmt(v?.stabilityFloor ?? 0, 2)} SWARM`} />
        <StatCard icon={<Users className="h-4 w-4" />} label="Community" value={`${fmt(v?.communityContributed ?? 0, 2)} SWARM`} />
        <StatCard icon={<WalletIcon className="h-4 w-4" />} label="Open Market" value={`${fmt(v?.buybackReserve ?? 0, 2)} SWARM`} />
        <StatCard icon={<TrendingDown className="h-4 w-4" />} label="Lifetime Buybacks" value={`${fmt(v?.lifetimeBuybacks ?? 0, 2)} SWARM`} />
        <StatCard icon={<Coins className="h-4 w-4" />} label="Creator Earnings" value={`${fmt(v?.creatorEarnings ?? 0, 2)} SWARM`} />
        <StatCard icon={<TrendingUp className="h-4 w-4" />} label="You Hold" value={`${fmt(heldTokens, 2)} ${token.ticker}`} />
      </div>

      {/* Ladder */}
      <div className="rounded-md border border-border bg-muted/30 p-6">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-display uppercase tracking-[0.2em] text-foreground">Buyback Ladder</div>
          <div className="text-xs text-foreground/60">
            Active Tier: <span className="font-mono text-primary">T{ladder.active}</span> · Ratio{" "}
            {(ladder.ratio * 100).toFixed(1)}%
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {ladder.tiers.map((step) => {
            const active = ladder.active >= step.tier;
            return (
              <div
                key={step.tier}
                className={`rounded-md border p-3 text-center text-xs transition ${
                  active
                    ? "border-border bg-muted/30 text-foreground"
                    : "border-border bg-muted/30 text-foreground/50"
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
      {viewerId && !isClosed && (
        <div className="grid gap-6 md:grid-cols-2">
          <div role="form" className="rounded-md border border-border bg-muted/30 p-6 space-y-3">
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

          <div role="form" className="rounded-md border border-border bg-muted/30 p-6 space-y-3">
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
                <span className="text-[10px] text-primary">(liquidity-capped)</span>
              )}
            </div>
            {sellN > 0 && sellQuote.source !== "none" && (
              <div className="text-[10px] uppercase tracking-widest text-foreground/50">
                Paid from{" "}
                {sellQuote.source === "reserve"
                  ? `Ladder Tier ${sellQuote.tier}`
                  : sellQuote.source === "floor"
                    ? "Stability Floor"
                    : `Ladder Tier ${sellQuote.tier} + Stability Floor`}
              </div>
            )}
            <Button
              type="button"
              variant="secondary"
              onClick={handleSell}
              disabled={busy || !canSell || sellN <= 0 || sellN > heldTokens || sellN > circulating || sellQuote.proceeds <= 0}
              className="w-full"
            >
              {heldTokens <= 0
                ? "No tokens held"
                : sellN > 0 && sellQuote.proceeds <= 0
                  ? "No vault liquidity"
                  : `Sell ${sellN || 0} ${token.ticker}`}
            </Button>
          </div>
        </div>
      )}

      {/* Creator earnings withdraw */}
      {isCreator && viewerId && (
        <div role="form" className="rounded-md border border-border bg-muted/30 p-6 space-y-3">
          <div className="font-display uppercase tracking-[0.2em] text-foreground">Creator Earnings</div>
          <div className="text-sm text-foreground/70">
            Claimable: <span className="font-mono">{fmt(backing.claimable, 4)} SWARM</span>
          </div>
          <div className="flex gap-2">
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              max={backing.claimable}
              value={withdrawAmount}
              onChange={(e) => setWithdrawAmount(e.target.value)}
              placeholder="Amount to withdraw"
            />
            <Button
              type="button"
              onClick={handleWithdraw}
              disabled={busy || !withdrawValid}
            >
              Claim
            </Button>
          </div>
        </div>
      )}


      {/* Close Market — creator only */}
      {isCreator && viewerId && !isClosed && (
        <div className="rounded-md border border-border bg-muted/30 p-6 space-y-2">
          <div className="flex items-center gap-2 font-display uppercase tracking-[0.2em] text-foreground">
            <Lock className="h-4 w-4" /> Market Closure Protocol
          </div>
          <div className="text-xs text-foreground/60">
            Dissolves the Open Market bucket to the community pool and freezes this token forever (cannot be redeployed).
          </div>
          <Button type="button" variant="destructive" onClick={handleCloseMarket} disabled={busy || !backing.backed}>
            Close Market Permanently
          </Button>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-4">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-foreground/60">
        {icon} {label}
      </div>
      <div className="mt-1 break-words font-mono text-lg text-foreground">{value}</div>
    </div>
  );
}