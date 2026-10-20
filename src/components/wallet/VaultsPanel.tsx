import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Vault as VaultIcon, TrendingUp, Coins, Plus, ArrowDownToLine } from "lucide-react";
import { toast } from "sonner";
import { getCurrentUser } from "@/lib/auth";
import { getProfileToken } from "@/lib/blockchain/storage";
import { creatorVaultBacking } from "@/lib/blockchain/creatorVaultBacking";
import { getCreatorVault, ladderState, withdrawCreatorEarnings } from "@/lib/blockchain/creatorVault";
import { creatorVaultAddress, getCreatorVaultCoin } from "@/lib/blockchain/creatorVaultCustody";
import { addVaultLiquidity } from "@/lib/blockchain/creatorVaultLiquidity";
import { getSwarmBalance } from "@/lib/blockchain/token";
import { depositAssetToCreatorVault, type StagedVault } from "@/lib/blockchain/creatorVaultAssets";
import { listCustomTokens, getRecordedTokenBalance } from "@/lib/blockchain/deposits/customTokens";
import { getCreditBalance } from "@/lib/credits";
import { CREDIT_TO_SWARM_RATIO } from "@/lib/blockchain/types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CreatorToken, CreatorVault } from "@/lib/blockchain/types";

function pct(n: number, d: number) {
  if (!d || !Number.isFinite(d)) return 0;
  return Math.max(0, Math.min(100, (n / d) * 100));
}
function fmt(n: number, d = 4) { return Number(n).toLocaleString(undefined, { maximumFractionDigits: d }); }

export function VaultsPanel() {
  const user = getCurrentUser();
  const [token, setToken] = useState<CreatorToken | null>(null);
  const [vault, setVault] = useState<CreatorVault | null>(null);
  const [swarmBal, setSwarmBal] = useState(0);
  const [addAmount, setAddAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [claimOpen, setClaimOpen] = useState(false);
  const [claimAmount, setClaimAmount] = useState("");
  const [custodyBalance, setCustodyBalance] = useState(0);
  const [coinId, setCoinId] = useState<string | null>(null);
  const [asset, setAsset] = useState("swarm");
  const [credits, setCredits] = useState(0);

  const refresh = useCallback(async () => {
    if (!user?.id) return;
    const [t, bal] = await Promise.all([
      getProfileToken(user.id),
      getSwarmBalance(user.id).catch(() => 0),
    ]);
    setToken(t);
    setSwarmBal(bal);
    setCredits(await getCreditBalance(user.id).catch(() => 0));
    if (t?.tokenId) {
      const v = await getCreatorVault(t.tokenId);
      setVault(v);
      const [held, coin] = await Promise.all([getSwarmBalance(creatorVaultAddress(t.tokenId)).catch(() => 0), getCreatorVaultCoin(t.tokenId)]);
      setCustodyBalance(held);
      setCoinId(coin?.coinId ?? null);
    }
  }, [user?.id]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const h = () => { void refresh(); };
    window.addEventListener("creator-vault-update", h);
    window.addEventListener("blockchain-transaction", h);
    return () => {
      window.removeEventListener("creator-vault-update", h);
      window.removeEventListener("blockchain-transaction", h);
    };
  }, [refresh]);

  const onAddLiquidity = async () => {
    if (!user?.id || !token) return;
    const amt = Number(addAmount);
    if (!(amt > 0) || !Number.isFinite(amt)) { toast.error("Enter a positive SWARM amount"); return; }
    setBusy(true);
    try {
      if (asset !== "swarm") {
        const r = await depositAssetToCreatorVault({
          fromId: user.id, tokenId: token.tokenId, amount: amt,
          asset: asset === "credits" ? { kind: "credits" } : { kind: "custom", contract: asset },
        });
        toast.success(r.message);
        setAddAmount("");
        await refresh();
        return;
      }
      if (amt > swarmBal) { toast.error("Exceeds your SWARM balance"); return; }
      await addVaultLiquidity({ creatorId: user.id, tokenId: token.tokenId, amount: amt });
      toast.success(`Added ${fmt(amt)} SWARM across the vault layers (40/40/15/5)`);
      setAddAmount("");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Top-up failed");
    } finally { setBusy(false); }
  };

  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><VaultIcon className="h-5 w-5 text-primary" /> Vaults</CardTitle>
          <CardDescription>Deploy a Creator Token to open your transparent vault dashboard.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const vaultAddr = creatorVaultAddress(token.tokenId);
  const tokens = user?.id ? listCustomTokens(user.id) : [];
  const ownedTokens = tokens.map((t) => ({ t, bal: getRecordedTokenBalance(user!.id, t.address) })).filter((x) => x.bal > 0);
  const heldTokens = tokens.map((t) => ({ t, bal: getRecordedTokenBalance(vaultAddr, t.address) })).filter((x) => x.bal > 0);
  const staged = (vault as StagedVault | null)?.stagedCredits ?? 0;
  const ladder = ladderState(vault);
  const total = vault?.totalDeposited ?? 0;
  const claim = Number(claimAmount);
  const backing = creatorVaultBacking(vault, custodyBalance);
  const claimMax = backing.claimable;
  const claimValid = Number.isFinite(claim) && claim > 0 && claim <= claimMax;
  const onClaim = async () => {
    if (!user?.id || !claimValid || busy) return;
    setBusy(true);
    try {
      await withdrawCreatorEarnings({ creatorId: user.id, tokenId: token.tokenId, amount: claim });
      setClaimOpen(false); setClaimAmount("");
      await refresh();
      toast.success(`${fmt(claim)} SWARM released to your native wallet`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "Could not claim earnings"); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      {/* Creator Vault transparency */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <VaultIcon className="h-5 w-5 text-primary" /> Creator Vault · {token.ticker}
              </CardTitle>
              <CardDescription>
                Peer-owned liquidity backing your Creator Token. Every buy splits 40 / 40 / 15 / 5.
              </CardDescription>
            </div>
            <Badge variant={vault?.closed ? "destructive" : "default"}>
              {vault?.closed ? "Closed" : `Tier ${ladder.active} · ${(ladder.ratio * 100).toFixed(1)}% reserve`}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!vault ? (
            <p className="text-sm text-muted-foreground">Vault initializes on first buy.</p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <VaultBucket label="Buyback Reserve · 40%" value={vault.buybackReserve} total={total} tone="primary" />
                <VaultBucket label="Stability Floor · 40%" value={vault.stabilityFloor} total={total} tone="emerald" />
                <VaultBucket label="Creator Earnings · 15%" value={vault.creatorEarnings} total={total} tone="amber" />
                <VaultBucket label="Community Pool · 5%" value={vault.communityContributed} total={total} tone="violet" />
              </div>

              <div className="grid gap-3 sm:grid-cols-3 text-xs">
                <Stat label="Total deposited" value={`${fmt(total)} SWARM`} icon={<TrendingUp className="h-3 w-3" />} />
                <Stat label="Lifetime buybacks paid" value={`${fmt(vault.lifetimeBuybacks)} SWARM`} icon={<Coins className="h-3 w-3" />} />
                <Stat label="Circulating supply" value={`${fmt(vault.circulatingSupply, 0)} ${token.ticker}`} icon={<Coins className="h-3 w-3" />} />
              </div>

              <div className="space-y-2 border-t pt-3">
                <Label>Coin Vault custody</Label>
                <p className="break-all font-mono text-xs text-muted-foreground">{coinId ?? "No custody coin recorded for this market yet."}</p>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm">Claimable earnings: <b>{fmt(claimMax)} SWARM</b></span>
                  <Button type="button" size="sm" variant="outline" disabled={busy || claimMax <= 0} onClick={() => { setClaimAmount(String(claimMax)); setClaimOpen(true); }}>
                    <ArrowDownToLine className="mr-1 h-4 w-4" />Claim earnings
                  </Button>
                </div>
                {(staged > 0 || heldTokens.length > 0) && (
                  <div className="space-y-1 text-xs">
                    {staged > 0 && <div>Held credits: {fmt(staged, 2)} / {CREDIT_TO_SWARM_RATIO} to wrap <Progress value={pct(staged % CREDIT_TO_SWARM_RATIO, CREDIT_TO_SWARM_RATIO)} className="mt-1 h-1.5" /></div>}
                    {heldTokens.map(({ t, bal }) => <div key={t.address}>Held {t.symbol}: {fmt(bal)} / 5,000,000</div>)}
                  </div>
                )}
                {(!backing.backed) && <p className="text-xs text-destructive">Recorded layers exceed held SWARM. Claims remain unavailable until all layers are backed; sync or reconcile before retrying.</p>}
              </div>

              <div className="rounded-md border p-3 space-y-2">
                <Label className="text-xs flex items-center gap-1"><Plus className="h-3 w-3" /> Add liquidity to the vault</Label>
                <p className="text-[11px] text-muted-foreground">
                  Splits 40/40/15/5 across the layers, same as a purchase — lifting the Buyback Ladder while
                  strengthening the floor, your earnings and the community pool. Your SWARM: {fmt(swarmBal)}.
                </p>
                <Select value={asset} onValueChange={setAsset}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="swarm">SWARM · {fmt(swarmBal)}</SelectItem>
                    {credits > 0 && <SelectItem value="credits">Credits · {fmt(credits, 0)}</SelectItem>}
                    {ownedTokens.map(({ t, bal }) => <SelectItem key={t.address} value={t.address.toLowerCase()}>{t.symbol} · {fmt(bal)}</SelectItem>)}
                  </SelectContent>
                </Select>
                {asset !== "swarm" && <p className="text-[11px] text-muted-foreground">{asset === "credits" ? `Every ${CREDIT_TO_SWARM_RATIO} credits wrap into 1 SWARM across the layers; the rest is held.` : "Custom tokens are held in the vault (max 5,000,000 per token), not counted as liquid SWARM. Refused amounts stay in your wallet."}</p>}
                <div className="flex gap-2">
                  <Input
                    placeholder="SWARM amount"
                    inputMode="decimal"
                    value={addAmount}
                    onChange={(e) => setAddAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                  />
                  <Button type="button" onClick={onAddLiquidity} disabled={busy || !addAmount || vault.closed}>
                    Top up
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <Dialog open={claimOpen} onOpenChange={(open) => { if (!busy) setClaimOpen(open); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Claim Creator Earnings</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Release SWARM from your Coin Vault earnings layer to your native wallet. The Buyback Reserve and Stability Floor are not used.</p>
          <Label htmlFor="vault-claim-amount">SWARM amount · up to {fmt(claimMax)}</Label>
          <Input id="vault-claim-amount" type="number" inputMode="decimal" min="0" max={claimMax} step="any" value={claimAmount} onChange={(e) => setClaimAmount(e.target.value)} />
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setClaimOpen(false)}>Cancel</Button>
            <Button type="button" disabled={busy || !claimValid} onClick={() => void onClaim()}>{busy ? "Releasing…" : "Confirm claim"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VaultBucket({ label, value, total, tone }: { label: string; value: number; total: number; tone: "primary" | "emerald" | "amber" | "violet" }) {
  const bar = pct(value, total);
  const toneClass = {
    primary: "bg-primary/20",
    emerald: "bg-emerald-500/20",
    amber: "bg-amber-500/20",
    violet: "bg-violet-500/20",
  }[tone];
  return (
    <div className={`rounded-md border p-3 ${toneClass}`}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{fmt(value)} SWARM</span>
      </div>
      <Progress value={bar} className="mt-2 h-1.5" />
      <div className="text-[10px] text-muted-foreground mt-1">{bar.toFixed(1)}% of total deposited</div>
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-[10px] text-muted-foreground flex items-center gap-1">{icon}{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
