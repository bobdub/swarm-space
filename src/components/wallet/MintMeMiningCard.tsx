import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Pickaxe } from "lucide-react";
import { getMintMeMinerEnabled, onMintMeMinerEnabledChange } from "@/lib/mining/mintmeMinerPreference";
import { getMintMeMiner, type MinerSnapshot } from "@/lib/blockchain/mintmeMiner/miner";
import { MINTME_POOL_LOW_DIFF } from "@/lib/blockchain/mintmeMiner/stratum";
import { splitShareWeight, MINTME_SPLIT } from "@/lib/blockchain/mintmeMiner/shareTracker";

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

  const split = splitShareWeight(snap.acceptedWeight, connectedPeers);

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
          <div className="font-medium">Share split</div>
          <Row label={`You (${MINTME_SPLIT.miner * 100}%)`} value={split.miner} />
          <Row label={`Connected peers (${MINTME_SPLIT.peers * 100}%, ${connectedPeers})`} value={split.peersTotal} />
          <Row label={`Community vault (${MINTME_SPLIT.vault * 100}%${connectedPeers ? "" : " + peer share"})`} value={split.vault} />
          <p className="text-xs text-muted-foreground">Peer-reported receipts: {snap.peerShares} (unverified). Shares are not MINTME balances. Pool proceeds must reach the community vault before the 80/15/5 split; payouts are not active yet.</p>
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

function Row({ label, value }: { label: string; value: number }) {
  return <div className="flex justify-between text-xs"><span>{label}</span><span>{value.toLocaleString()} weight</span></div>;
}
