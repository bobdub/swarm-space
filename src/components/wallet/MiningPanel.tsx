import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Activity, Heart, Blocks, Radio, Users, Clock, Wifi, WifiOff,
  CheckCircle2, AlertTriangle, Zap, Leaf, Shield, Timer, PlugZap
} from "lucide-react";
import { useP2PContext } from "@/contexts/P2PContext";
import { getSwarmMeshStandalone, type MiningStats } from "@/lib/p2p/swarmMesh.standalone";
import { getMiningRewards } from "@/lib/blockchain/miningRewards";
import { formatDistanceToNow } from "date-fns";

const EMPTY_STATS: MiningStats = {
  blocksMinedTotal: 0, blocksRelayed: 0, peersDiscovered: 0,
  heartbeatsSent: 0, heartbeatsReceived: 0, chunksServed: 0,
  acksReceived: 0, lastBlockMinedAt: null, lastHeartbeatAt: null,
  confirmedBlocks: 0, pendingBlocks: 0, hollowBlocks: 0,
  lastConfirmedAt: null, contentMultiplier: 1.0, seedingActive: false,
  chunksServedSinceLastBlock: 0, blockHeight: 0, consensusFailures: 0,
  transactionsProcessed: 0, spaceHosted: 0,
};

export function MiningPanel() {
  const { isEnabled, stats: p2pStats } = useP2PContext();
  const rewards = getMiningRewards();
  const isConnected = isEnabled && p2pStats.connectedPeers > 0;

  const [miningStats, setMiningStats] = useState<MiningStats>(EMPTY_STATS);
  const estimatedNext = Math.max(10, 15 - Math.min(5, p2pStats.connectedPeers));
  const [countdown, setCountdown] = useState(estimatedNext);

  useEffect(() => {
    try {
      const mesh = getSwarmMeshStandalone();
      const unsub = mesh.onMiningChange(setMiningStats);
      return unsub;
    } catch {
      // Mesh not initialized
    }
  }, []);

  useEffect(() => {
    if (!isConnected) return;
    setCountdown(estimatedNext);
    const iv = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(iv);
  }, [isConnected, miningStats.blockHeight, estimatedNext]);

  if (!isConnected) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-muted-foreground" />
              CREATOR Mining
            </CardTitle>
            <Badge variant="outline" className="border-destructive/50 text-destructive gap-1">
              <WifiOff className="h-3 w-3" /> Offline
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col items-center justify-center py-8 text-center space-y-4">
            <div className="rounded-full bg-muted/50 p-4">
              <PlugZap className="h-8 w-8 text-muted-foreground" />
            </div>
            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-foreground">Not Mining</h3>
              <p className="text-sm text-muted-foreground max-w-xs">
                Mining requires an active SWARM Mesh connection with peers. 
                No blocks are produced, no rewards are earned while offline.
              </p>
            </div>
            <div className="rounded-lg bg-muted/50 border border-border/30 p-3 text-xs text-muted-foreground w-full">
              <span className="font-medium text-foreground">How CREATOR mining works:</span>{' '}
              Connect to the mesh → produce blocks → peers vote to confirm → earn SWARM tokens.
              Content activity (seeding files) multiplies your rewards.
            </div>
          </div>

          {/* Show previous session stats ONLY if there's real history, clearly labeled */}
          {miningStats.confirmedBlocks > 0 && (
            <div className="rounded-lg border border-border/30 bg-muted/20 p-3 space-y-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Previous Session
              </span>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-sm font-bold text-muted-foreground">{miningStats.blockHeight}</div>
                  <div className="text-xs text-muted-foreground/70">Block Height</div>
                </div>
                <div>
                  <div className="text-sm font-bold text-muted-foreground">{miningStats.confirmedBlocks}</div>
                  <div className="text-xs text-muted-foreground/70">Confirmed</div>
                </div>
                <div>
                  <div className="text-sm font-bold text-muted-foreground">
                    {miningStats.lastConfirmedAt
                      ? formatDistanceToNow(miningStats.lastConfirmedAt, { addSuffix: true })
                      : '—'
                    }
                  </div>
                  <div className="text-xs text-muted-foreground/70">Last Block</div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // ONLINE STATE — Real live mining dashboard
  // ═══════════════════════════════════════════════════════════════════

  // Honest earnings: only CONFIRMED blocks earn full rewards, hollow blocks get 50%
  const fullBlocks = miningStats.confirmedBlocks - miningStats.hollowBlocks;
  const hollowConfirmed = Math.min(miningStats.hollowBlocks, miningStats.confirmedBlocks);
  const meshWork = Math.max(0, fullBlocks) + Math.floor(hollowConfirmed * 0.5) + miningStats.blocksRelayed + miningStats.peersDiscovered;
  const networkService = Math.ceil((miningStats.heartbeatsSent + miningStats.acksReceived) / 10);
  const grossEarned = (meshWork * rewards.TRANSACTION_PROCESSED) + (networkService * rewards.MB_HOSTED);
  const netEarned = grossEarned * (1 - rewards.NETWORK_POOL_PERCENTAGE);

  // Network health score (0-100)
  const healthScore = Math.min(100, Math.round(
    (p2pStats.connectedPeers * 15) +
    (miningStats.heartbeatsReceived > 0 ? 20 : 0) +
    (miningStats.blocksRelayed > 0 ? 15 : 0) +
    (miningStats.acksReceived > 0 ? 10 : 0) +
    (miningStats.peersDiscovered > 0 ? 10 : 0) +
    (miningStats.confirmedBlocks > 0 ? 15 : 0) +
    (!miningStats.seedingActive ? 0 : 15)
  ));

  // Consensus health: only show real data, not 100% for 0 attempts
  const totalAttempted = miningStats.confirmedBlocks + miningStats.consensusFailures;
  const consensusHealth = totalAttempted > 0
    ? Math.round((miningStats.confirmedBlocks / totalAttempted) * 100)
    : null; // null = no data yet, don't fake 100%

  // Next block estimate
  const estimatedNext = Math.max(10, 15 - Math.min(5, p2pStats.connectedPeers));

  // Last block reward calculation
  const lastBlockWasHollow = miningStats.hollowBlocks > 0 && miningStats.hollowBlocks >= miningStats.confirmedBlocks;
  const perBlockReward = rewards.TRANSACTION_PROCESSED * (lastBlockWasHollow ? 0.5 : 1.0);
  const perBlockNet = perBlockReward * (1 - rewards.NETWORK_POOL_PERCENTAGE);

  // Countdown timer for next block
  const [countdown, setCountdown] = useState(estimatedNext);
  useEffect(() => {
    if (!isConnected) return;
    setCountdown(estimatedNext);
    const iv = setInterval(() => setCountdown(c => Math.max(0, c - 1)), 1000);
    return () => clearInterval(iv);
  }, [isConnected, miningStats.blockHeight, estimatedNext]);

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            CREATOR Mining
          </CardTitle>
          <Badge variant="outline" className="border-emerald-500/50 text-emerald-400 gap-1">
            <Wifi className="h-3 w-3" /> Active
          </Badge>
        </div>
        <CardDescription>
          You're strengthening the network. Blocks require mesh consensus & content proof before earning.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Block Height & Last Confirmed */}
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium flex items-center gap-1.5">
              <Blocks className="h-4 w-4 text-primary" /> Block Height
            </span>
            <span className="text-2xl font-bold text-primary font-mono">
              #{miningStats.blockHeight}
            </span>
          </div>

          {/* Last Block — timestamp + reward */}
          <div className="mt-2 rounded-md bg-background/50 border border-border/30 p-2.5 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-emerald-400" /> Last Confirmed Block
              </span>
              {miningStats.lastConfirmedAt && (
                <span className="text-xs font-bold text-emerald-400">
                  +{perBlockNet.toFixed(4)} SWARM
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground">
              {miningStats.lastConfirmedAt
                ? <>
                    <span>{new Date(miningStats.lastConfirmedAt).toLocaleTimeString()}</span>
                    <span className="mx-1">·</span>
                    <span>{formatDistanceToNow(miningStats.lastConfirmedAt, { addSuffix: true })}</span>
                    <span className="mx-1">·</span>
                    <span>{lastBlockWasHollow ? 'Hollow (50%)' : 'Full block'}</span>
                  </>
                : 'Awaiting first confirmed block'
              }
            </div>
          </div>

          {/* Next Block Prediction */}
          <div className="mt-2 rounded-md bg-background/50 border border-border/30 p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Timer className="h-3 w-3 text-amber-400" /> Next Block
              </span>
              <span className="text-xs font-bold font-mono text-amber-400">
                ~{countdown}s
              </span>
            </div>
            <div className="mt-1">
              <Progress value={((estimatedNext - countdown) / estimatedNext) * 100} className="h-1" />
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              Est. reward: {miningStats.seedingActive
                ? `${(rewards.TRANSACTION_PROCESSED * miningStats.contentMultiplier * (1 - rewards.NETWORK_POOL_PERCENTAGE)).toFixed(4)} SWARM (${miningStats.contentMultiplier.toFixed(1)}x)`
                : `${(rewards.TRANSACTION_PROCESSED * 0.5 * (1 - rewards.NETWORK_POOL_PERCENTAGE)).toFixed(4)} SWARM (hollow)`
              }
            </div>
          </div>
        </div>

        {/* Network Health */}
        <div className="rounded-lg border border-border/50 bg-muted/30 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium flex items-center gap-1.5">
              <Heart className="h-4 w-4 text-primary" /> Network Health
            </span>
            <span className="text-lg font-bold text-primary">{healthScore}%</span>
          </div>
          <Progress value={healthScore} className="h-2" />
          <div className="flex justify-between mt-2 text-xs text-muted-foreground">
            <span>{p2pStats.connectedPeers} peer{p2pStats.connectedPeers !== 1 ? 's' : ''} connected</span>
            <span>
              {miningStats.lastHeartbeatAt
                ? `Last pulse ${formatDistanceToNow(miningStats.lastHeartbeatAt, { addSuffix: true })}`
                : 'No pulses yet'
              }
            </span>
          </div>
        </div>

        {/* CREATOR Proof Stats */}
        <div className="grid gap-3 sm:grid-cols-2">
          <StatCard
            icon={<CheckCircle2 className="h-4 w-4 text-emerald-400" />}
            label="Confirmed Blocks"
            value={miningStats.confirmedBlocks}
            sub={miningStats.pendingBlocks > 0 ? `${miningStats.pendingBlocks} pending consensus` : 'All blocks settled'}
            highlight
          />
          <StatCard
            icon={<Shield className="h-4 w-4 text-primary" />}
            label="Consensus Health"
            value={consensusHealth !== null ? `${consensusHealth}%` : '—'}
            sub={totalAttempted > 0
              ? `${miningStats.consensusFailures} failed | ${totalAttempted} total`
              : 'No blocks attempted yet'
            }
          />
          <StatCard
            icon={<Zap className="h-4 w-4 text-amber-400" />}
            label="Content Multiplier"
            value={miningStats.seedingActive ? `${miningStats.contentMultiplier.toFixed(1)}x` : '—'}
            sub={miningStats.seedingActive ? 'Actively seeding content' : 'No content activity (hollow blocks)'}
          />
          <StatCard
            icon={<Leaf className="h-4 w-4" />}
            label="Block Quality"
            value={miningStats.blocksMinedTotal > 0
              ? `${miningStats.blocksMinedTotal - miningStats.hollowBlocks} / ${miningStats.blocksMinedTotal}`
              : '—'
            }
            sub={miningStats.blocksMinedTotal > 0
              ? `${miningStats.hollowBlocks} hollow (50% reward)`
              : 'No blocks produced yet'
            }
          />
        </div>

        {/* Mesh Activity */}
        <div className="grid gap-3 sm:grid-cols-2">
          <StatCard
            icon={<Radio className="h-4 w-4" />}
            label="Blocks Relayed"
            value={miningStats.blocksRelayed}
            sub="Forwarding peer blocks across mesh"
          />
          <StatCard
            icon={<Users className="h-4 w-4" />}
            label="Peers Discovered"
            value={miningStats.peersDiscovered}
            sub="New nodes found via PEX"
          />
          <StatCard
            icon={<Clock className="h-4 w-4" />}
            label="Heartbeats"
            value={`${miningStats.heartbeatsSent} / ${miningStats.heartbeatsReceived}`}
            sub={`Sent / Received — ${miningStats.acksReceived} mining acks`}
          />
          <StatCard
            icon={<Activity className="h-4 w-4" />}
            label="Chunks Served"
            value={miningStats.chunksServed}
            sub={`${miningStats.chunksServedSinceLastBlock} since last block`}
          />
        </div>

        {/* Pending Blocks Indicator */}
        {miningStats.pendingBlocks > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
            <div className="text-sm">
              <span className="font-medium text-amber-400">{miningStats.pendingBlocks} block{miningStats.pendingBlocks !== 1 ? 's' : ''}</span>
              <span className="text-muted-foreground"> awaiting mesh consensus (peers must vote)</span>
            </div>
          </div>
        )}

        {/* Earnings */}
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Net SWARM Earned</span>
            <span className="text-xl font-bold text-primary">
              {netEarned.toFixed(2)} SWARM
            </span>
          </div>
          <div className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
            <span>Confirmed mesh work: {meshWork} actions × {rewards.TRANSACTION_PROCESSED} SWARM</span>
            <span>Network service: {networkService} units × {rewards.MB_HOSTED} SWARM</span>
          </div>
          <div className="mt-1 text-xs text-primary/70">
            5% network pool contribution: {(grossEarned * rewards.NETWORK_POOL_PERCENTAGE).toFixed(3)} SWARM
          </div>
        </div>

        {/* Honest explainer */}
        <div className="text-xs text-muted-foreground">
          <p className="rounded-lg bg-muted/50 border border-border/30 p-3">
            <span className="font-medium text-foreground">CREATOR Proof:</span>{' '}
            Blocks must travel the mesh and receive peer consensus before you earn. Content activity (seeding/receiving files)
            multiplies your rewards. Hollow blocks (no content activity) earn 50%. 
            <strong className="text-primary"> Honest mining = honest rewards.</strong>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function StatCard({ icon, label, value, sub, highlight }: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  sub: string;
  highlight?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? 'border-primary/30 bg-primary/5' : 'border-border/50 bg-muted/30'}`}>
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-1 text-xl font-bold">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
