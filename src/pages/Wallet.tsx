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
import { Coins, TrendingUp, Image, History, Cpu, Rocket, ArrowLeft, Wallet as WalletIcon, Trophy, Pickaxe, ArrowUpRight, ArrowDownLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { getCurrentUser } from "@/lib/auth";
import { getSwarmBalance, getSwarmTicker } from "@/lib/blockchain/token";
import { getUserNFTs } from "@/lib/blockchain/nft";
import { getSwarmChain } from "@/lib/blockchain/chain";
import { getMiningStats, startMining, pauseMining, resumeMining } from "@/lib/blockchain/mining";
import { deployProfileToken, getUserProfileToken, getMaxProfileTokenSupply } from "@/lib/blockchain/profileToken";
import type { NFTMetadata, MiningSession, ProfileToken, SwarmTransaction } from "@/lib/blockchain/types";
import { toast } from "sonner";
import { QuantumMetricsPanel } from "@/components/wallet/QuantumMetricsPanel";
import { NFTPostCreator } from "@/components/wallet/NFTPostCreator";
import { NFTImageCreator } from "@/components/wallet/NFTImageCreator";
import { MiningPanel } from "@/components/wallet/MiningPanel";
import { ProfileTokenHoldings } from "@/components/wallet/ProfileTokenHoldings";
import { CreditWrappingPanel } from "@/components/wallet/CreditWrappingPanel";
import { CreditHistory } from "@/components/CreditHistory";
import { initializeDailyBurn } from "@/lib/blockchain/burn";

export default function Wallet() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [balance, setBalance] = useState<number>(0);
  const [nfts, setNfts] = useState<NFTMetadata[]>([]);
  const [transactions, setTransactions] = useState<SwarmTransaction[]>([]);
  const [miningSession, setMiningSession] = useState<MiningSession | null>(null);
  const [profileToken, setProfileToken] = useState<ProfileToken | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Profile token deployment
  const [deployDialogOpen, setDeployDialogOpen] = useState(false);
  const [tokenName, setTokenName] = useState("");
  const [tokenTicker, setTokenTicker] = useState("");
  const [tokenDescription, setTokenDescription] = useState("");

  useEffect(() => {
    void loadWalletData();
  }, [user]);

  const loadWalletData = async () => {
    try {
      const currentUser = user || await getCurrentUser();
      if (!currentUser) {
        navigate("/auth");
        return;
      }
      
      // Initialize daily burn
      initializeDailyBurn(currentUser.id);
      
      // Load SWARM balance
      const swarmBalance = await getSwarmBalance(currentUser.id);
      console.log("[Wallet] Loaded balance:", swarmBalance);
      setBalance(swarmBalance);

      // Load NFTs
      const userNfts = await getUserNFTs(currentUser.id);
      setNfts(userNfts);

      // Load transactions
      const chain = getSwarmChain();
      const allTransactions = chain.getChain()
        .flatMap(block => block.transactions)
        .filter(tx => tx.from === currentUser.id || tx.to === currentUser.id)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 50);
      setTransactions(allTransactions);

      // Load mining session
      const mining = await getMiningStats(currentUser.id);
      setMiningSession(mining);

      // Load profile token
      const token = await getUserProfileToken(currentUser.id);
      console.log("[Wallet] Loaded profile token:", token);
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
      toast.success("Mining started!");
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
      toast.success("Mining resumed!");
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
      toast.success(`Profile token ${tokenTicker} deployed!`);
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
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
        </div>
      </div>
    );
  }

  return (
    <>
      <TopNavigationBar />
      <div className="container mx-auto py-8 px-4 max-w-7xl">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-4xl font-bold mb-2">Blockchain Wallet</h1>
              <p className="text-muted-foreground">Manage your SWARM tokens, NFTs, and mining</p>
            </div>
          </div>
          <WalletIcon className="h-12 w-12 text-primary" />
        </div>

      {/* Balance Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card className="border-primary/20">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">SWARM Balance</CardTitle>
            <Coins className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{balance.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">{getSwarmTicker()}</p>
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
              <Badge variant={miningSession?.status === "active" ? "default" : "secondary"}>
                {miningSession?.status || "Not Started"}
              </Badge>
            </div>
            {miningSession && (
              <p className="text-xs text-muted-foreground mt-1">
                {miningSession.blocksFound} blocks | {miningSession.totalReward} SWARM
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quantum Metrics */}
      <div className="mb-8">
        <QuantumMetricsPanel />
      </div>

      <Tabs defaultValue="transactions" className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="credits">Credits</TabsTrigger>
          <TabsTrigger value="nfts">NFTs</TabsTrigger>
          <TabsTrigger value="mining">Mining</TabsTrigger>
          <TabsTrigger value="profile-token">Profile Token</TabsTrigger>
        </TabsList>

        {/* Transactions Tab */}
        <TabsContent value="transactions">
          <Card>
            <CardHeader>
              <CardTitle>Transaction History</CardTitle>
              <CardDescription>Your recent SWARM blockchain transactions</CardDescription>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px] pr-4">
                {transactions.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    No transactions yet
                  </div>
                ) : (
                  <div className="space-y-3">
                    {transactions.map((tx) => (
                      <div key={tx.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent/50 transition-colors">
                        <div className="flex items-center gap-4">
                          {tx.to === user?.id ? (
                            <ArrowDownLeft className="h-5 w-5 text-green-500" />
                          ) : (
                            <ArrowUpRight className="h-5 w-5 text-red-500" />
                          )}
                          <div>
                            <p className="font-medium">{tx.type.replace(/_/g, " ").toUpperCase()}</p>
                            <p className="text-sm text-muted-foreground">
                              {new Date(tx.timestamp).toLocaleString()}
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="font-bold">
                            {tx.to === user?.id ? "+" : "-"}
                            {tx.amount || 0} {getSwarmTicker()}
                          </p>
                          {tx.fee > 0 && (
                            <p className="text-xs text-muted-foreground">Fee: {tx.fee}</p>
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

        {/* Credits Tab */}
        <TabsContent value="credits" className="space-y-6">
          <CreditWrappingPanel />
          <CreditHistory userId={user?.id || ""} />
        </TabsContent>

        {/* NFTs Tab */}
        <TabsContent value="nfts" className="space-y-6">
          {profileToken && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Create NFT Post</CardTitle>
                  <CardDescription>Mint exclusive content for your {profileToken.ticker} token holders</CardDescription>
                </CardHeader>
                <CardContent>
                  <NFTPostCreator onSuccess={loadWalletData} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Create NFT Image</CardTitle>
                  <CardDescription>Lock an image as a collectible NFT with your {profileToken.ticker} tokens</CardDescription>
                </CardHeader>
                <CardContent>
                  <NFTImageCreator onSuccess={loadWalletData} />
                </CardContent>
              </Card>
            </div>
          )}

          <ProfileTokenHoldings />

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>NFT Collection</CardTitle>
                  <CardDescription>Your wrapped achievements and exclusive content</CardDescription>
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
                    No NFTs yet. Unlock achievements to automatically mint NFTs!
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {nfts.map((nft) => (
                      <Card key={nft.tokenId} className="overflow-hidden">
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base">{nft.name}</CardTitle>
                          {nft.rarity && (
                            <Badge variant="outline" className="w-fit">
                              {nft.rarity}
                            </Badge>
                          )}
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm text-muted-foreground mb-3">{nft.description}</p>
                          <div className="space-y-1">
                            {nft.attributes.map((attr, i) => (
                              <div key={i} className="flex justify-between text-xs">
                                <span className="text-muted-foreground">{attr.trait_type}</span>
                                <span className="font-medium">{attr.value}</span>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Mining Tab */}
        <TabsContent value="mining">
          <Card>
            <CardHeader>
              <CardTitle>Mining Dashboard</CardTitle>
              <CardDescription>Mine SWARM tokens by processing transactions</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
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
                      <p className="text-2xl font-bold mt-2">{miningSession.blocksFound}</p>
                    </div>
                    <div className="text-center p-4 border rounded-lg">
                      <p className="text-sm text-muted-foreground">Total Reward</p>
                      <p className="text-2xl font-bold mt-2">{miningSession.totalReward}</p>
                    </div>
                    <div className="text-center p-4 border rounded-lg">
                      <p className="text-sm text-muted-foreground">Hash Rate</p>
                      <p className="text-2xl font-bold mt-2">{miningSession.hashRate.toFixed(2)}</p>
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
                  <h3 className="text-lg font-semibold mb-2">Start Mining SWARM</h3>
                  <p className="text-muted-foreground mb-6">
                    Mine SWARM tokens by validating transactions on the blockchain
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

        {/* Profile Token Tab */}
        <TabsContent value="profile-token">
          <Card>
            <CardHeader>
              <CardTitle>Profile Token</CardTitle>
              <CardDescription>Deploy your own token on the SWARM blockchain</CardDescription>
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
                      <Badge variant="outline">Profile Token</Badge>
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
                            <DialogTitle>Redeploy Profile Token</DialogTitle>
                          </DialogHeader>
                          <div className="space-y-4">
                            <div>
                              <Label htmlFor="token-name">Token Name</Label>
                              <Input
                                id="token-name"
                                placeholder="My Token"
                                value={tokenName}
                                onChange={(e) => setTokenName(e.target.value)}
                              />
                            </div>
                            <div>
                              <Label htmlFor="token-ticker">Ticker (3-5 letters)</Label>
                              <Input
                                id="token-ticker"
                                placeholder="TKN"
                                value={tokenTicker}
                                onChange={(e) => setTokenTicker(e.target.value.toUpperCase())}
                                maxLength={5}
                              />
                            </div>
                            <div>
                              <Label htmlFor="token-description">Description</Label>
                              <Textarea
                                id="token-description"
                                placeholder="Describe the purpose of your token"
                                value={tokenDescription}
                                onChange={(e) => setTokenDescription(e.target.value)}
                              />
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
                  <h3 className="text-lg font-semibold mb-2">Deploy Your Profile Token</h3>
                  <p className="text-muted-foreground mb-6">
                    Create your own token with a max supply of {getMaxProfileTokenSupply().toLocaleString()} tokens
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
                        <DialogTitle>Deploy Profile Token</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <Label htmlFor="token-name">Token Name</Label>
                          <Input
                            id="token-name"
                            placeholder="My Token"
                            value={tokenName}
                            onChange={(e) => setTokenName(e.target.value)}
                          />
                        </div>
                        <div>
                          <Label htmlFor="token-ticker">Ticker (3-5 letters)</Label>
                          <Input
                            id="token-ticker"
                            placeholder="TKN"
                            value={tokenTicker}
                            onChange={(e) => setTokenTicker(e.target.value.toUpperCase())}
                            maxLength={5}
                          />
                        </div>
                        <div>
                          <Label htmlFor="token-description">Description (Optional)</Label>
                          <Textarea
                            id="token-description"
                            placeholder="Describe your token..."
                            value={tokenDescription}
                            onChange={(e) => setTokenDescription(e.target.value)}
                          />
                        </div>
                        <div className="p-3 border rounded-lg bg-muted/50">
                          <p className="text-sm text-muted-foreground">
                            Deployment fee: <span className="font-bold text-foreground">1,000 SWARM</span>
                          </p>
                          <p className="text-sm text-muted-foreground mt-1">
                            Max supply: <span className="font-bold text-foreground">{getMaxProfileTokenSupply().toLocaleString()} tokens</span>
                          </p>
                        </div>
                        <Button 
                          onClick={handleDeployToken} 
                          className="w-full"
                          disabled={!tokenName || !tokenTicker || tokenTicker.length < 3}
                        >
                          Deploy Token (1,000 SWARM)
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
    </>
  );
}
