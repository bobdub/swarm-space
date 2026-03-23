import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Heart, Blocks, Radio, Users, Clock, Wifi, WifiOff } from "lucide-react";
import { useP2PContext } from "@/contexts/P2PContext";
import { getSwarmMeshStandalone, type MiningStats } from "@/lib/p2p/swarmMesh.standalone";
import { getMiningRewards } from "@/lib/blockchain/miningRewards";
import { formatDistanceToNow } from "date-fns";

export function MiningPanel() {
  const { isEnabled, stats: p2pStats } = useP2PContext();
  const rewards = getMiningRewards();
  const isConnected = isEnabled && p2pStats.connectedPeers > 0;

  const [miningStats, setMiningStats] = useState<MiningStats>({
    blocksMinedTotal: 0, blocksRelayed: 0, peersDiscovered: 0,
    heartbeatsSent: 0, heartbeatsReceived: 0, chunksServed: 0,
    acksReceived: 0, lastBlockMinedAt: null, lastHeartbeatAt: null,
    transactionsProcessed: 0, spaceHosted: 0,
  });

  useEffect(() => {
    try {
      const mesh = getSwarmMeshStandalone();
      const unsub = mesh.onMiningChange(setMiningStats);
      return unsub;
    } catch {
      // Mesh not initialized
    }
  }, []);

  // Honest earnings: blocks produced + relayed = mesh work rewards
  const meshWork = miningStats.blocksMinedTotal + miningStats.blocksRelayed + miningStats.peersDiscovered;
  const networkService = Math.ceil((miningStats.heartbeatsSent + miningStats.acksReceived) / 10);
  const grossEarned = (meshWork * rewards.TRANSACTION_PROCESSED) + (networkService * rewards.MB_HOSTED);
  const netEarned = grossEarned * (1 - rewards.NETWORK_POOL_PERCENTAGE);

  // Network health score (simple 0-100)
  const healthScore = isConnected
    ? Math.min(100, Math.round(
        (p2pStats.connectedPeers * 15) +
        (miningStats.heartbeatsReceived > 0 ? 25 : 0) +
        (miningStats.blocksRelayed > 0 ? 20 : 0) +
        (miningStats.acksReceived > 0 ? 15 : 0) +
        (miningStats.peersDiscovered > 0 ? 10 : 0)
      ))
    : 0;

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-xl">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            Mesh Mining
          </CardTitle>
          {isConnected ? (
            <Badge variant="outline" className="border-emerald-500/50 text-emerald-400 gap-1">
              <Wifi className="h-3 w-3" /> Active
            </Badge>
          ) : (
            <Badge variant="outline" className="border-destructive/50 text-destructive gap-1">
              <WifiOff className="h-3 w-3" /> Offline
            </Badge>
          )}
        </div>
        <CardDescription>
          {isConnected
            ? "You're strengthening the network. Mining rewards are earned through real mesh participation."
            : "Connect to SWARM Mesh to begin mining. Rewards require active peer connections."
          }
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Network Health */}
        <div className="rounded-lg border border-border/50 bg-muted/30 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium flex items-center gap-1.5">
              <Heart className="h-4 w-4 text-primary" /> Network Health
            </span>
            <span className="text-lg font-bold text-primary">{healthScore}%</span>
          </div>
          <div className="w-full h-2 rounded-full bg-muted">
            <div
              className="h-2 rounded-full transition-all duration-500"
              style={{
                width: `${healthScore}%`,
                background: healthScore > 70
                  ? 'hsl(var(--primary))'
                  : healthScore > 40
                    ? 'hsl(var(--accent))'
                    : 'hsl(var(--destructive))',
              }}
            />
          </div>
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

        {/* Real Mining Stats */}
        <div className="grid gap-3 sm:grid-cols-2">
          <StatCard
            icon={<Blocks className="h-4 w-4" />}
            label="Blocks Produced"
            value={miningStats.blocksMinedTotal}
            sub={miningStats.lastBlockMinedAt
              ? `Last: ${formatDistanceToNow(miningStats.lastBlockMinedAt, { addSuffix: true })}`
              : 'No blocks yet'
            }
          />
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
        </div>

        {/* Earnings */}
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Net SWARM Earned</span>
            <span className="text-xl font-bold text-primary">
              {netEarned.toFixed(2)} SWARM
            </span>
          </div>
          <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
            <span>Mesh work: {meshWork} actions × {rewards.TRANSACTION_PROCESSED} SWARM</span>
            <span>Service: {networkService} units × {rewards.MB_HOSTED} SWARM</span>
          </div>
          <div className="mt-1 text-xs text-primary/70">
            5% network pool contribution: {(grossEarned * rewards.NETWORK_POOL_PERCENTAGE).toFixed(3)} SWARM
          </div>
        </div>

        {/* Honest explainer */}
        <div className="space-y-2 text-xs text-muted-foreground">
          <p className="rounded-lg bg-muted/50 border border-border/30 p-3">
            <span className="font-medium text-foreground">How mining works:</span>{' '}
            Your node produces blocks every 15s, relays blocks from other peers, discovers new nodes through PEX, and sends heartbeats to keep the mesh healthy. Each of these real actions earns SWARM tokens.
            <strong className="text-primary"> You are the network.</strong> Every pulse you send helps other peers stay connected.
          </p>
          {!isConnected && (
            <p className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-destructive">
              Mining requires an active SWARM Mesh connection. Go to the Node Dashboard to connect.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function StatCard({ icon, label, value, sub }: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  sub: string;
}) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 p-3">
      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        {icon} {label}
      </div>
      <div className="mt-1 text-xl font-bold">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}
