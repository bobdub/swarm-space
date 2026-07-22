import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Vault as VaultIcon, Wallet as WalletIcon, ShieldCheck, TrendingUp, Coins, Info, Plus, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { getCurrentUser } from "@/lib/auth";
import { getUserProfileToken } from "@/lib/blockchain/profileToken";
import { getCreatorVault, ladderState } from "@/lib/blockchain/creatorVault";
import { addBuybackLiquidity } from "@/lib/blockchain/creatorVaultLiquidity";
import { getSwarmBalance } from "@/lib/blockchain/token";
import type { CreatorToken, CreatorVault } from "@/lib/blockchain/types";
import { getMetaMaskAccount, getMetaMaskChainId, onMetaMaskChange, isMetaMaskAvailable } from "@/lib/blockchain/wallets/metaMaskBridge";
import { readMintMeBalance } from "@/lib/blockchain/wallets/mintmeBridge";
import { isMintMeChain, switchToMintMeNetwork, MINTME_NETWORK } from "@/lib/blockchain/wallets/mintmeNetwork";

function pct(n: number, d: number) {
  if (!d || !Number.isFinite(d)) return 0;
  return Math.max(0, Math.min(100, (n / d) * 100));
}
function fmt(n: number, d = 4) { return Number(n).toLocaleString(undefined, { maximumFractionDigits: d }); }
function shortAddr(a: string | null) { return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—"; }

export function VaultsPanel() {
  const user = getCurrentUser();
  const [token, setToken] = useState<CreatorToken | null>(null);
  const [vault, setVault] = useState<CreatorVault | null>(null);
  const [swarmBal, setSwarmBal] = useState(0);
  const [addAmount, setAddAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [mmAccount, setMmAccount] = useState<string | null>(null);
  const [mmChain, setMmChain] = useState<string | null>(null);
  const [mintmeBal, setMintmeBal] = useState<number | null>(null);
  const mmAvailable = useMemo(() => isMetaMaskAvailable(), []);

  const refresh = useCallback(async () => {
    if (!user?.id) return;
    const [t, bal] = await Promise.all([
      getUserProfileToken(user.id),
      getSwarmBalance(user.id).catch(() => 0),
    ]);
    setToken(t);
    setSwarmBal(bal);
    if (t?.tokenId) {
      const v = await getCreatorVault(t.tokenId);
      setVault(v);
    }
  }, [user?.id]);

  const refreshMm = useCallback(async () => {
    const [a, c] = await Promise.all([getMetaMaskAccount(), getMetaMaskChainId()]);
    setMmAccount(a);
    setMmChain(c);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!mmAvailable) return;
    void refreshMm();
    return onMetaMaskChange(refreshMm);
  }, [mmAvailable, refreshMm]);

  useEffect(() => {
    const h = () => { void refresh(); };
    window.addEventListener("creator-vault-update", h);
    window.addEventListener("blockchain-transaction", h);
    return () => {
      window.removeEventListener("creator-vault-update", h);
      window.removeEventListener("blockchain-transaction", h);
    };
  }, [refresh]);

  const loadMintMe = useCallback(async () => {
    if (!mmAccount) { setMintmeBal(null); return; }
    const b = await readMintMeBalance(mmAccount);
    setMintmeBal(b);
  }, [mmAccount]);

  useEffect(() => { if (isMintMeChain(mmChain)) void loadMintMe(); }, [mmChain, loadMintMe]);

  const onAddLiquidity = async () => {
    if (!user?.id || !token) return;
    const amt = Number(addAmount);
    if (!(amt > 0) || !Number.isFinite(amt)) { toast.error("Enter a positive SWARM amount"); return; }
    if (amt > swarmBal) { toast.error("Exceeds your SWARM balance"); return; }
    setBusy(true);
    try {
      await addBuybackLiquidity({ creatorId: user.id, tokenId: token.tokenId, amount: amt });
      toast.success(`Added ${fmt(amt)} SWARM to Buyback Reserve`);
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

  const ladder = ladderState(vault);
  const total = vault?.totalDeposited ?? 0;

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

              <div className="rounded-md border p-3 space-y-2">
                <Label className="text-xs flex items-center gap-1"><Plus className="h-3 w-3" /> Add liquidity to Buyback Reserve</Label>
                <p className="text-[11px] text-muted-foreground">
                  Boosts your Buyback Ladder tier so holders can sell back at fair prices. Your SWARM: {fmt(swarmBal)}.
                </p>
                <div className="flex gap-2">
                  <Input
                    placeholder="SWARM amount"
                    inputMode="decimal"
                    value={addAmount}
                    onChange={(e) => setAddAmount(e.target.value.replace(/[^0-9.]/g, ""))}
                  />
                  <Button type="button" onClick={onAddLiquidity} disabled={busy || !addAmount}>
                    Top up
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Peer bridge vault (MetaMask on MintMe) */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="flex items-center gap-2">
                <WalletIcon className="h-5 w-5 text-primary" /> Peer Bridge Vault · MintMe
              </CardTitle>
              <CardDescription>
                Your MetaMask account IS the vault. No custodian, no cloud — you sign every move.
              </CardDescription>
            </div>
            <Badge variant={mmAccount ? "default" : "secondary"}>
              {mmAccount ? shortAddr(mmAccount) : "MetaMask not connected"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">Chain</div>
              <div className="font-medium">{isMintMeChain(mmChain) ? MINTME_NETWORK.chainName : "Not on MintMe"}</div>
              {!isMintMeChain(mmChain) && mmAccount && (
                <Button size="sm" variant="outline" className="mt-2" onClick={() => switchToMintMeNetwork().catch(() => {})}>
                  Switch to MintMe
                </Button>
              )}
            </div>
            <div className="rounded-md border p-3">
              <div className="text-xs text-muted-foreground">On-chain balance</div>
              <div className="font-semibold">
                {mintmeBal == null ? "—" : `${fmt(mintmeBal, 6)} MINTME`}
              </div>
              <Button size="sm" variant="ghost" className="mt-1 h-7 px-2 text-xs" onClick={() => void loadMintMe()}>
                Refresh
              </Button>
            </div>
          </div>

          <Alert>
            <ShieldCheck className="h-4 w-4" />
            <AlertTitle>Move MintMe with MetaMask</AlertTitle>
            <AlertDescription className="text-xs">
              Use the <span className="font-medium">Bridge</span> panel in the Assets tab to send / receive MintMe.
              Your MetaMask signs every transaction — the app never holds your keys.
            </AlertDescription>
          </Alert>

          <a
            href={MINTME_NETWORK.blockExplorerUrls[0] + (mmAccount ? `/address/${mmAccount}` : "")}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            View on MintMe explorer <ExternalLink className="h-3 w-3" />
          </a>
        </CardContent>
      </Card>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Why two vaults?</AlertTitle>
        <AlertDescription className="text-xs">
          The <span className="font-medium">Creator Vault</span> holds SWARM liquidity that backs your token's Buyback Ladder.
          The <span className="font-medium">Peer Bridge Vault</span> is your MetaMask account on external chains (MintMe first).
          Top up your Creator Vault from your SWARM balance above; use MetaMask to move MintMe peer-to-peer.
        </AlertDescription>
      </Alert>
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