import { useState, useEffect } from "react";
import { TopNavigationBar } from "@/components/TopNavigationBar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  Coins, TrendingUp, History, Rocket, ArrowLeft, Wallet as WalletIcon,
  Trophy, Pickaxe, ArrowUpRight, ArrowDownLeft, Globe, ArrowDownUp,
  Link2, Repeat,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useP2PContext } from "@/contexts/P2PContext";
import { getCurrentUser } from "@/lib/auth";
import { getSwarmBalance, getSwarmTicker } from "@/lib/blockchain/token";
import { getUserNFTs } from "@/lib/blockchain/nft";
import { getSwarmChain } from "@/lib/blockchain/chain";
import { getMiningStats, startMining, pauseMining, resumeMining } from "@/lib/blockchain/mining";
import { deployProfileToken, getUserProfileToken } from "@/lib/blockchain/profileToken";
import type { NFTMetadata, MiningSession, CreatorToken } from "@/lib/blockchain/types";
import { CREATOR_TOKEN_DEPLOY_COST, CREATOR_TOKEN_MAX_SUPPLY } from "@/lib/blockchain/types";
import { toast } from "sonner";
import { QuantumMetricsPanel } from "@/components/wallet/QuantumMetricsPanel";
import { ProfileTokenHoldings } from "@/components/wallet/ProfileTokenHoldings";
import { CreditWrappingPanel } from "@/components/wallet/CreditWrappingPanel";
import { CreditHistory } from "@/components/CreditHistory";
import { initializeDailyBurn } from "@/lib/blockchain/burn";
import { CoinDeploymentPanel } from "@/components/wallet/CoinDeploymentPanel";
import { ChainSwitcher } from "@/components/wallet/ChainSwitcher";
import { CrossChainSwapPanel } from "@/components/wallet/CrossChainSwapPanel";
import {
  getActiveChain,
  getChainBalance,
  getEnrichedTransactions,
  type ChainContext,
  type EnrichedTransaction,
} from "@/lib/blockchain/multiChainManager";
import { getFeatureFlags } from "@/config/featureFlags";

export default function Wallet() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isEnabled, getActivePeerConnections } = useP2PContext();
  const [balance, setBalance] = useState<number>(0);
  const [nfts, setNfts] = useState<NFTMetadata[]>([]);
  const [transactions, setTransactions] = useState<EnrichedTransaction[]>([]);
  const [miningSession, setMiningSession] = useState<MiningSession | null>(null);
  const [profileToken, setProfileToken] = useState<CreatorToken | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeChain, setActiveChain] = useState<ChainContext>(getActiveChain());

  const swarmModeEnabled = getFeatureFlags().swarmMeshMode;
  const activePeerCount = getActivePeerConnections().length;
  const autoMiningActive = swarmModeEnabled && isEnabled && activePeerCount > 0;
  const walletMiningStatus = autoMiningActive
    ? { label: "Auto-Mining Active", variant: "default" as const, detail: `SWARM Mesh · ${activePeerCount} peer${activePeerCount === 1 ? "" : "s"} connected` }
    : miningSession?.status === "active"
      ? { label: miningSession.status, variant: "default" as const, detail: `${miningSession.blocksFound} blocks | ${miningSession.totalReward} ${activeChain.ticker}` }
      : miningSession?.status
        ? { label: miningSession.status, variant: "secondary" as const, detail: `${miningSession.blocksFound} blocks | ${miningSession.totalReward} ${activeChain.ticker}` }
        : { label: "Not Started", variant: "secondary" as const, detail: "Start mining manually or connect to SWARM Mesh for auto-mining." };

  // Profile token deployment
  const [deployDialogOpen, setDeployDialogOpen] = useState(false);
  const [tokenName, setTokenName] = useState("");
  const [tokenTicker, setTokenTicker] = useState("");
  const [tokenDescription, setTokenDescription] = useState("");

  useEffect(() => {
    void loadWalletData();

    const handleCreditTransaction = () => void loadWalletData();
    const handleVisibilityChange = () => { if (!document.hidden) void loadWalletData(); };
    const handleChainChanged = (e: Event) => {
      const ctx = (e as CustomEvent<ChainContext>).detail;
      setActiveChain(ctx);
      void loadWalletData();
    };

    window.addEventListener("credit-transaction", handleCreditTransaction);
    window.addEventListener("active-chain-changed", handleChainChanged);
    window.addEventListener("cross-chain-swap", handleCreditTransaction);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const interval = setInterval(() => void loadWalletData(), 10000);

    return () => {
      window.removeEventListener("credit-transaction", handleCreditTransaction);
      window.removeEventListener("active-chain-changed", handleChainChanged);
      window.removeEventListener("cross-chain-swap", handleCreditTransaction);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearInterval(interval);
    };
  }, [user]);

  const loadWalletData = async () => {
    try {
      const currentUser = user || await getCurrentUser();
      if (!currentUser) { navigate("/auth"); return; }

      initializeDailyBurn(currentUser.id);

      const chain = getActiveChain();

      // Load balance for active chain
      const bal = chain.isMainChain
        ? await getSwarmBalance(currentUser.id)
        : await getChainBalance(currentUser.id, chain.chainId);
      setBalance(bal);

      // Load enriched transactions
      const enriched = await getEnrichedTransactions(currentUser.id, 50);
      setTransactions(enriched);

      // Load NFTs — filter by active chain via their mint transaction's chainId
      const allNfts = await getUserNFTs(currentUser.id);
      // Check the chain ledger for each NFT's chain origin
      const swarmChain = getSwarmChain();
      const allTxs = swarmChain.getChain().flatMap(b => b.transactions).concat(swarmChain.getPendingTransactions());
      const nftChainMap = new Map<string, string>();
      for (const tx of allTxs) {
        if (tx.tokenId && (tx.type === "nft_mint")) {
          nftChainMap.set(tx.tokenId, tx.chainId || "SWARM");
        }
      }
      const filteredNfts = allNfts.filter(nft => {
        const nftChain = nftChainMap.get(nft.tokenId) || "SWARM";
        return nftChain === chain.chainId;
      });
      setNfts(filteredNfts);

      // Load mining session
      const mining = await getMiningStats(currentUser.id);
      setMiningSession(mining);

      // Load profile token
      const token = await getUserProfileToken(currentUser.id);
      setProfileToken(token);
    } catch (error) {
      console.error("Failed to load wallet data:", error);
      toast.error("Failed to load wallet");
    } finally {
      setLoading(false);
    }
  };

  const handleStartMining = async () => {
    if (!user) return;
    try {
      await startMining(user.id);
      toast.success(`Mining started on ${activeChain.ticker}!`);
      loadWalletData();
    } catch (error: any) {
      toast.error(error.message || "Failed to start mining");
    }
  };

  const handlePauseMining = async () => {
    if (!user) return;
    try {
      await pauseMining(user.id);
      toast.success("Mining paused");
      loadWalletData();
    } catch (error) {
      toast.error("Failed to pause mining");
    }
  };

  const handleResumeMining = async () => {
    if (!user) return;
    try {
      await resumeMining(user.id);
      toast.success(`Mining resumed on ${activeChain.ticker}!`);
      loadWalletData();
    } catch (error) {
      toast.error("Failed to resume mining");
    }
  };

  const handleDeployToken = async () => {
    if (!user) return;
    try {
      await deployProfileToken({
        userId: user.id,
        name: tokenName,
        ticker: tokenTicker.toUpperCase(),
        description: tokenDescription,
      });
      toast.success(`Creator token ${tokenTicker} deployed!`);
      setDeployDialogOpen(false);
      setTokenName("");
      setTokenTicker("");
      setTokenDescription("");
      loadWalletData();
    } catch (error: any) {
      toast.error(error.message || "Failed to deploy token");
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto py-8 px-4">
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
        </div>
      </div>
    );
  }

  return (
    <>
      <TopNavigationBar />
      <div className="container mx-auto py-8 px-4 max-w-7xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-3xl sm:text-4xl font-bold mb-1">Blockchain Wallet</h1>
              <p className="text-muted-foreground text-sm">Manage tokens, NFTs, mining & swaps</p>
            </div>
          </div>
          <WalletIcon className="h-10 w-10 text-primary hidden sm:block" />
        </div>

        {/* Chain Switcher */}
        <div className="mb-6">
          <ChainSwitcher onChainChanged={() => void loadWalletData()} />
        </div>

        {/* Balance Overview */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Card className="border-primary/20">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">
                {activeChain.ticker} Balance
              </CardTitle>
              {activeChain.isMainChain ? (
                <Coins className="h-4 w-4 text-primary" />
              ) : (
                <Link2 className="h-4 w-4 text-primary" />
              )}
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold tabular-nums">
                {balance.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {activeChain.ticker}
                {!activeChain.isMainChain && (
                  <span className="ml-1 text-muted-foreground/60">({activeChain.chainName})</span>
                )}
              </p>
            </CardContent>
          </Card>

          <Card className="border-primary/20">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">NFTs Owned</CardTitle>
              <Trophy className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{nfts.length}</div>
              <p className="text-xs text-muted-foreground mt-1">Achievements & Badges</p>
            </CardContent>
          </Card>

          <Card className="border-primary/20">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Mining Status</CardTitle>
              <Pickaxe className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Badge variant={walletMiningStatus.variant}>
                  {walletMiningStatus.label}
                </Badge>
                {(autoMiningActive || miningSession?.status === "active") && (
                  <Badge variant="outline" className="text-[10px]">
                    {autoMiningActive ? "SWARM Mesh" : activeChain.ticker}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {walletMiningStatus.detail}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Quantum Metrics */}
        <div className="mb-8">
          <QuantumMetricsPanel />
        </div>

        {/* Tabs */}
        <Tabs defaultValue="transactions" className="space-y-6">
          <TabsList className="flex w-full overflow-x-auto">
            <TabsTrigger value="transactions" className="flex-1 min-w-0">Ledger</TabsTrigger>
            <TabsTrigger value="credits" className="flex-1 min-w-0">Credits</TabsTrigger>
            <TabsTrigger value="swap" className="flex-1 min-w-0">Swap</TabsTrigger>
            <TabsTrigger value="nfts" className="flex-1 min-w-0">NFTs</TabsTrigger>
            <TabsTrigger value="mining" className="flex-1 min-w-0">Mining</TabsTrigger>
            <TabsTrigger value="creator-token" className="flex-1 min-w-0">Creator</TabsTrigger>
            <TabsTrigger value="coins" className="flex-1 min-w-0">Coins</TabsTrigger>
          </TabsList>

          {/* ── Transactions / Ledger ─────────────────────────────── */}
          <TabsContent value="transactions">
            <Card>
              <CardHeader>
                <CardTitle>Transaction History</CardTitle>
                <CardDescription>
                  All blockchain activity — labelled by type, chain, and direction
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px] pr-4">
                  {transactions.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      No transactions yet
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {transactions.map((tx) => (
                        <div
                          key={tx.id}
                          className="flex items-start justify-between p-3 border rounded-lg hover:bg-accent/30 transition-colors gap-3"
                        >
                          <div className="flex items-start gap-3 min-w-0">
                            {tx.direction === "in" ? (
                              <ArrowDownLeft className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                            ) : (
                              <ArrowUpRight className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                            )}
                            <div className="min-w-0">
                              <p className="font-medium text-sm leading-tight">{tx.label}</p>
                              <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                <Badge
                                  variant={tx.chainTicker === "SWARM" ? "default" : "outline"}
                                  className="text-[9px] px-1 py-0"
                                >
                                  {tx.chainTicker}
                                </Badge>
                                <span className="text-[10px] text-muted-foreground">
                                  {tx.type}
                                </span>
                              </div>
                              <p className="text-[10px] text-muted-foreground mt-0.5">
                                {new Date(tx.timestamp).toLocaleString()}
                              </p>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-bold text-sm tabular-nums">
                              {tx.direction === "in" ? "+" : "-"}
                              {tx.amount || 0}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {tx.chainTicker}
                            </p>
                            {tx.fee > 0 && (
                              <p className="text-[10px] text-muted-foreground">
                                Fee: {tx.fee}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Credits ───────────────────────────────────────────── */}
          <TabsContent value="credits" className="space-y-6">
            <CreditWrappingPanel />
            <CreditHistory userId={user?.id || ""} />
          </TabsContent>

          {/* ── Swap ──────────────────────────────────────────────── */}
          <TabsContent value="swap">
            <CrossChainSwapPanel />
          </TabsContent>

          {/* ── NFTs ──────────────────────────────────────────────── */}
          <TabsContent value="nfts" className="space-y-6">
            <ProfileTokenHoldings />

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>NFT Collection — {activeChain.ticker}</CardTitle>
                    <CardDescription>
                      {activeChain.isMainChain
                        ? "All posts, comments, and achievements minted on SWARM"
                        : `NFTs minted on ${activeChain.chainName} (${activeChain.ticker})`}
                    </CardDescription>
                  </div>
                  <Button variant="outline" size="sm" onClick={loadWalletData}>
                    Refresh
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-[500px]">
                  {nfts.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      No NFTs on {activeChain.ticker} yet. Create posts and unlock achievements while on this chain!
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {nfts.map((nft) => (
                        <NFTCard key={nft.tokenId} nft={nft} />
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Mining ────────────────────────────────────────────── */}
          <TabsContent value="mining">
            <Card>
              <CardHeader>
                <CardTitle>Mining Dashboard</CardTitle>
                <CardDescription>
                  Mining on: <span className="font-semibold text-foreground">{activeChain.ticker}</span>
                  {!activeChain.isMainChain && (
                    <span className="text-muted-foreground"> ({activeChain.chainName})</span>
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Active chain indicator */}
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 flex items-center gap-3">
                  <Pickaxe className="h-5 w-5 text-primary" />
                  <div className="text-sm">
                    <span className="text-muted-foreground">Mining rewards go to your </span>
                    <span className="font-semibold">{activeChain.ticker}</span>
                    <span className="text-muted-foreground"> wallet. Switch chains above to mine elsewhere.</span>
                  </div>
                </div>

                {miningSession ? (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="text-center p-4 border rounded-lg">
                        <p className="text-sm text-muted-foreground">Status</p>
                        <Badge className="mt-2" variant={miningSession.status === "active" ? "default" : "secondary"}>
                          {miningSession.status}
                        </Badge>
                      </div>
                      <div className="text-center p-4 border rounded-lg">
                        <p className="text-sm text-muted-foreground">Blocks Found</p>
                        <p className="text-2xl font-bold mt-2 tabular-nums">{miningSession.blocksFound}</p>
                      </div>
                      <div className="text-center p-4 border rounded-lg">
                        <p className="text-sm text-muted-foreground">Total Reward</p>
                        <p className="text-2xl font-bold mt-2 tabular-nums">{miningSession.totalReward}</p>
                      </div>
                      <div className="text-center p-4 border rounded-lg">
                        <p className="text-sm text-muted-foreground">Hash Rate</p>
                        <p className="text-2xl font-bold mt-2 tabular-nums">{miningSession.hashRate.toFixed(2)}</p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      {miningSession.status === "active" ? (
                        <Button onClick={handlePauseMining} variant="outline" className="flex-1">
                          Pause Mining
                        </Button>
                      ) : (
                        <Button onClick={handleResumeMining} className="flex-1">
                          Resume Mining
                        </Button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="text-center py-12">
                    <Pickaxe className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
                    <h3 className="text-lg font-semibold mb-2">Start Mining {activeChain.ticker}</h3>
                    <p className="text-muted-foreground mb-6">
                      Mine {activeChain.ticker} tokens by validating transactions on the {activeChain.chainName} blockchain
                    </p>
                    <Button onClick={handleStartMining} size="lg">
                      <Pickaxe className="mr-2 h-5 w-5" />
                      Start Mining
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Creator Token ─────────────────────────────────────── */}
          <TabsContent value="creator-token">
            <Card>
              <CardHeader>
                <CardTitle>Creator Token</CardTitle>
                <CardDescription>
                  Your personal token on the SWARM blockchain — one per account, {CREATOR_TOKEN_MAX_SUPPLY.toLocaleString()} max supply
                </CardDescription>
              </CardHeader>
              <CardContent>
                {profileToken ? (
                  <div className="space-y-6">
                    <div className="p-6 border rounded-lg bg-accent/30">
                      <div className="flex items-center justify-between mb-4">
                        <div>
                          <h3 className="text-2xl font-bold">{profileToken.ticker}</h3>
                          <p className="text-sm text-muted-foreground">Your creator channel token</p>
                        </div>
                        <Badge variant="outline">Creator Token</Badge>
                      </div>
                      <p className="text-lg font-semibold mb-2">{profileToken.name}</p>
                      {profileToken.description && (
                        <p className="text-muted-foreground mb-4">{profileToken.description}</p>
                      )}
                      <div className="grid grid-cols-2 gap-4 mt-4">
                        <div>
                          <p className="text-sm text-muted-foreground">Supply</p>
                          <p className="text-xl font-bold">{profileToken.supply.toLocaleString()}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Max Supply</p>
                          <p className="text-xl font-bold">{profileToken.maxSupply.toLocaleString()}</p>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mt-4">
                        Deployed: {new Date(profileToken.deployedAt).toLocaleString()}
                      </p>
                      <div className="mt-6 flex flex-wrap gap-3">
                        <Dialog open={deployDialogOpen} onOpenChange={setDeployDialogOpen}>
                          <DialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setTokenName(profileToken.name);
                                setTokenTicker(profileToken.ticker);
                                setTokenDescription(profileToken.description ?? "");
                              }}
                            >
                              Rename / Redeploy (unused only)
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Redeploy Creator Token</DialogTitle>
                            </DialogHeader>
                            <div className="space-y-4">
                              <div>
                                <Label htmlFor="token-name">Token Name</Label>
                                <Input id="token-name" placeholder="My Token" value={tokenName} onChange={(e) => setTokenName(e.target.value)} />
                              </div>
                              <div>
                                <Label htmlFor="token-ticker">Ticker (3-5 letters)</Label>
                                <Input id="token-ticker" placeholder="TKN" value={tokenTicker} onChange={(e) => setTokenTicker(e.target.value.toUpperCase())} maxLength={5} />
                              </div>
                              <div>
                                <Label htmlFor="token-description">Description</Label>
                                <Textarea id="token-description" placeholder="Describe the purpose of your token" value={tokenDescription} onChange={(e) => setTokenDescription(e.target.value)} />
                              </div>
                              <Button onClick={handleDeployToken} className="w-full">
                                Redeploy Token
                              </Button>
                              <p className="text-xs text-muted-foreground">
                                You can only redeploy if this token has not been used to lock any NFT posts yet.
                              </p>
                            </div>
                          </DialogContent>
                        </Dialog>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <Rocket className="h-16 w-16 mx-auto mb-4 text-muted-foreground" />
                    <h3 className="text-lg font-semibold mb-2">Deploy Your Creator Token</h3>
                    <p className="text-muted-foreground mb-6">
                      Create your own token with a max supply of {CREATOR_TOKEN_MAX_SUPPLY.toLocaleString()} tokens.
                      Costs {CREATOR_TOKEN_DEPLOY_COST.toLocaleString()} credits.
                    </p>
                    <Dialog open={deployDialogOpen} onOpenChange={setDeployDialogOpen}>
                      <DialogTrigger asChild>
                        <Button size="lg">
                          <Rocket className="mr-2 h-5 w-5" />
                          Deploy Token
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Deploy Creator Token</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div>
                            <Label htmlFor="token-name">Token Name</Label>
                            <Input id="token-name" placeholder="My Token" value={tokenName} onChange={(e) => setTokenName(e.target.value)} />
                          </div>
                          <div>
                            <Label htmlFor="token-ticker">Ticker (3-5 letters)</Label>
                            <Input id="token-ticker" placeholder="TKN" value={tokenTicker} onChange={(e) => setTokenTicker(e.target.value.toUpperCase())} maxLength={5} />
                          </div>
                          <div>
                            <Label htmlFor="token-description">Description (Optional)</Label>
                            <Textarea id="token-description" placeholder="Describe your token..." value={tokenDescription} onChange={(e) => setTokenDescription(e.target.value)} />
                          </div>
                          <div className="p-3 border rounded-lg bg-muted/50">
                            <p className="text-sm text-muted-foreground">
                              Deployment cost: <span className="font-bold text-foreground">{CREATOR_TOKEN_DEPLOY_COST.toLocaleString()} credits</span>
                            </p>
                            <p className="text-sm text-muted-foreground mt-1">
                              Max supply: <span className="font-bold text-foreground">{CREATOR_TOKEN_MAX_SUPPLY.toLocaleString()} tokens</span>
                            </p>
                          </div>
                          <Button
                            onClick={handleDeployToken}
                            className="w-full"
                            disabled={!tokenName || !tokenTicker || tokenTicker.length < 3}
                          >
                            Deploy Token ({CREATOR_TOKEN_DEPLOY_COST.toLocaleString()} credits)
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Coins ─────────────────────────────────────────────── */}
          <TabsContent value="coins">
            <CoinDeploymentPanel />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
