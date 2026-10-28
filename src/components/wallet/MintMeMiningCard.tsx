import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Pickaxe } from "lucide-react";
import { getMintMeMinerEnabled, onMintMeMinerEnabledChange } from "@/lib/mining/mintmeMinerPreference";
import { getMintMeMiner, type MinerSnapshot } from "@/lib/blockchain/mintmeMiner/miner";
import { MINTME_POOL_LOW_DIFF } from "@/lib/blockchain/mintmeMiner/stratum";
import { MINTME_PAYOUT_THRESHOLD, MINTME_PAYOUT_PERCENT } from "@/lib/blockchain/mintmeMiner/payoutPolicy";

export const MINTME_TOGGLE_OFF_MESSAGE = "Turn on Miner in the node dashboard to start mining";

export function MintMeMiningCard({ connectedPeers }: { connectedPeers: number }) {
  const [enabled, setEnabled] = useState(getMintMeMinerEnabled());
  const [snap, setSnap] = useState<MinerSnapshot>(getMintMeMiner().snapshot);

  useEffect(() => onMintMeMinerEnabledChange(setEnabled), []);
  useEffect(() => getMintMeMiner().subscribe(setSnap), []);


  if (!enabled) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><Pickaxe className="h-4 w-4" /> MintMe Miner</CardTitle>
        </CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">{MINTME_TOGGLE_OFF_MESSAGE}</p></CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2"><Pickaxe className="h-4 w-4" /> MintMe Miner</span>
          <Badge variant={snap.status === "mining" ? "default" : "secondary"}>{snap.status}</Badge>
        </CardTitle>
        <CardDescription>MintMe community mining · {MINTME_POOL_LOW_DIFF} · target difficulty 12,500</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Hashrate" value={`${snap.hashrate.toFixed(1)} H/s`} />
          <Stat label="Accepted" value={String(snap.accepted)} />
          <Stat label="Rejected" value={String(snap.rejected)} />
        </div>
        <div className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-1">
          <div className="font-medium">Community payout</div>
          <Row label="Pool threshold" value={`${MINTME_PAYOUT_THRESHOLD} MINTME`} />
          <Row label="Community retains" value={`${MINTME_PAYOUT_PERCENT.community}%`} />
          <Row label="Connected network peers" value={`${MINTME_PAYOUT_PERCENT.peers}% · equal shares`} />
          <Row label="Your mesh connections" value={String(connectedPeers)} />
          <p className="text-xs text-muted-foreground">Peer-reported receipts: {snap.peerShares} (unverified). Pool balance unverified · wallet payouts not active.</p>
        </div>
        <Link className="text-xs text-primary underline" to="/node-dashboard">Mining connection details</Link>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/30 p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-2 text-xs"><span>{label}</span><span className="text-right">{value}</span></div>;
}
