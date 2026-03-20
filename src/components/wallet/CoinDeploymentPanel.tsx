import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { Link2, Rocket, AlertTriangle, CheckCircle2, Coins, Globe } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { getSwarmBalance } from "@/lib/blockchain/token";
import { deployCoin, getUserCoins, getActiveCoins } from "@/lib/blockchain/coinDeployment";
import { COIN_DEPLOY_COST } from "@/lib/blockchain/types";
import type { DeployedCoin } from "@/lib/blockchain/types";

export function CoinDeploymentPanel() {
  const { user } = useAuth();
  const [deployOpen, setDeployOpen] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [swarmBalance, setSwarmBalance] = useState(0);
  const [userCoins, setUserCoins] = useState<DeployedCoin[]>([]);
  const [networkCoins, setNetworkCoins] = useState<DeployedCoin[]>([]);

  // Form state
  const [chainName, setChainName] = useState("");
  const [ticker, setTicker] = useState("");
  const [projectGoal, setProjectGoal] = useState("");

  // Validation
  const tickerValid = /^[A-Z]{3,6}$/.test(ticker) && ticker !== "SWARM";
  const chainNameValid = chainName.trim().length >= 1 && chainName.length <= 32;
  const goalValid = projectGoal.trim().length >= 10;
  const canAfford = swarmBalance >= COIN_DEPLOY_COST;
  const formValid = tickerValid && chainNameValid && goalValid && canAfford;

  useEffect(() => {
    if (!user) return;
    void loadData();

    const interval = setInterval(() => void loadData(), 15000);
    return () => clearInterval(interval);
  }, [user]);

  const loadData = async () => {
    if (!user) return;
    const [bal, mine, all] = await Promise.all([
      getSwarmBalance(user.id),
      getUserCoins(user.id),
      getActiveCoins(),
    ]);
    setSwarmBalance(bal);
    setUserCoins(mine);
    setNetworkCoins(all);
  };

  const handleDeploy = async () => {
    if (!user || !formValid) return;
    setDeploying(true);
    try {
      const { coin } = await deployCoin({
        userId: user.id,
        chainName: chainName.trim(),
        ticker: ticker.toUpperCase(),
        projectGoal: projectGoal.trim(),
      });
      toast.success(`${coin.chainName} (${coin.ticker}) deployed on SWARM!`);
      setDeployOpen(false);
      setChainName("");
      setTicker("");
      setProjectGoal("");
      await loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Deployment failed");
    } finally {
      setDeploying(false);
    }
  };

  if (!user) return null;

  const affordPercent = Math.min(100, (swarmBalance / COIN_DEPLOY_COST) * 100);

  return (
    <div className="space-y-6">
      {/* Your Coins */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Globe className="h-5 w-5 text-primary" />
                Your Coins
              </CardTitle>
              <CardDescription>
                Coins you've deployed — each is its own sub-chain cross-linked to SWARM
              </CardDescription>
            </div>
            <Dialog open={deployOpen} onOpenChange={setDeployOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-2">
                  <Rocket className="h-4 w-4" />
                  Deploy Coin
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <Rocket className="h-5 w-5" />
                    Deploy a New Coin
                  </DialogTitle>
                  <DialogDescription>
                    Launch your own blockchain cross-chained to the SWARM network.
                    Costs {COIN_DEPLOY_COST.toLocaleString()} SWARM — funds go to the community pool.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-5 pt-2">
                  {/* Balance check */}
                  <div className="rounded-lg border border-border/60 p-4 space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Your SWARM</span>
                      <span className="font-semibold tabular-nums">
                        {swarmBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </span>
                    </div>
                    <Progress value={affordPercent} className="h-1.5" />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Required: {COIN_DEPLOY_COST.toLocaleString()}</span>
                      {canAfford ? (
                        <span className="flex items-center gap-1 text-primary">
                          <CheckCircle2 className="h-3 w-3" /> Sufficient
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-destructive">
                          <AlertTriangle className="h-3 w-3" /> Need {(COIN_DEPLOY_COST - swarmBalance).toLocaleString()} more
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Chain Name */}
                  <div className="space-y-1.5">
                    <Label htmlFor="coin-chain-name">Chain Name</Label>
                    <Input
                      id="coin-chain-name"
                      placeholder="e.g. ArtVerse"
                      value={chainName}
                      onChange={(e) => setChainName(e.target.value)}
                      maxLength={32}
                      className={chainName && !chainNameValid ? "border-destructive" : ""}
                    />
                    <p className="text-xs text-muted-foreground">1-32 characters. The name of your blockchain.</p>
                  </div>

                  {/* Ticker */}
                  <div className="space-y-1.5">
                    <Label htmlFor="coin-ticker">Ticker</Label>
                    <Input
                      id="coin-ticker"
                      placeholder="e.g. ART"
                      value={ticker}
                      onChange={(e) => setTicker(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
                      maxLength={6}
                      className={ticker && !tickerValid ? "border-destructive" : ""}
                    />
                    {ticker === "SWARM" && (
                      <p className="text-xs text-destructive">SWARM is reserved</p>
                    )}
                    <p className="text-xs text-muted-foreground">3-6 uppercase letters. Must be unique.</p>
                  </div>

                  {/* Project Goal */}
                  <div className="space-y-1.5">
                    <Label htmlFor="coin-goal">Project Goal</Label>
                    <Textarea
                      id="coin-goal"
                      placeholder="Describe what this coin powers — its purpose and vision..."
                      value={projectGoal}
                      onChange={(e) => setProjectGoal(e.target.value)}
                      rows={3}
                      maxLength={500}
                      className={projectGoal && !goalValid ? "border-destructive" : ""}
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Min 10 characters</span>
                      <span className="tabular-nums">{projectGoal.length}/500</span>
                    </div>
                  </div>

                  {/* Info block */}
                  <div className="rounded-lg bg-muted/40 border border-border/40 p-3 space-y-1 text-xs text-muted-foreground">
                    <p className="font-medium text-foreground/80">What happens on deploy:</p>
                    <ul className="list-disc list-inside space-y-0.5 ml-1">
                      <li>{COIN_DEPLOY_COST.toLocaleString()} SWARM is sent to the community pool</li>
                      <li>A new sub-chain is created and cross-linked to SWARM</li>
                      <li>You manage the chain — it syncs to the SWARM mesh automatically</li>
                      <li>Other users can discover and interact with your coin</li>
                    </ul>
                  </div>

                  <Button
                    onClick={handleDeploy}
                    disabled={!formValid || deploying}
                    className="w-full"
                  >
                    {deploying
                      ? "Deploying..."
                      : `Deploy ${ticker || "Coin"} — ${COIN_DEPLOY_COST.toLocaleString()} SWARM`}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {userCoins.length === 0 ? (
            <div className="text-center py-10 space-y-3">
              <Coins className="h-12 w-12 mx-auto text-muted-foreground/40" />
              <p className="text-muted-foreground text-sm">
                You haven't deployed any coins yet.
              </p>
              <p className="text-xs text-muted-foreground/70 max-w-xs mx-auto">
                Deploy your own blockchain on the SWARM network for{" "}
                {COIN_DEPLOY_COST.toLocaleString()} SWARM. Funds support the community pool.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {userCoins.map((coin) => (
                <CoinCard key={coin.coinId} coin={coin} isOwner />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Network Coins */}
      {networkCoins.filter((c) => c.deployerUserId !== user.id).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Network Coins</CardTitle>
            <CardDescription>Coins deployed by other users on the SWARM mesh</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-80">
              <div className="space-y-3">
                {networkCoins
                  .filter((c) => c.deployerUserId !== user.id)
                  .map((coin) => (
                    <CoinCard key={coin.coinId} coin={coin} />
                  ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function CoinCard({ coin, isOwner }: { coin: DeployedCoin; isOwner?: boolean }) {
  return (
    <div className="rounded-lg border border-border/60 p-4 space-y-3 transition-colors hover:bg-accent/20">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-lg leading-none">{coin.ticker}</span>
            <Badge
              variant={coin.status === "active" ? "default" : "secondary"}
              className="text-[10px] px-1.5 py-0"
            >
              {coin.status}
            </Badge>
            {isOwner && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                yours
              </Badge>
            )}
          </div>
          <p className="text-sm font-medium mt-1">{coin.chainName}</p>
        </div>
        <Link2 className="h-4 w-4 shrink-0 text-muted-foreground/50 mt-1" />
      </div>

      <p className="text-xs text-muted-foreground line-clamp-2">{coin.projectGoal}</p>

      <Separator className="opacity-40" />

      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div>
          <span className="text-muted-foreground block">Supply</span>
          <span className="font-semibold tabular-nums">{coin.totalSupply.toLocaleString()}</span>
        </div>
        <div>
          <span className="text-muted-foreground block">Max</span>
          <span className="font-semibold tabular-nums">{coin.maxSupply.toLocaleString()}</span>
        </div>
        <div>
          <span className="text-muted-foreground block">Deployed</span>
          <span className="font-semibold">{new Date(coin.deployedAt).toLocaleDateString()}</span>
        </div>
      </div>
    </div>
  );
}
