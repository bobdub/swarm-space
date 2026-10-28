import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pickaxe } from "lucide-react";
import { getMintMeMinerEnabled, onMintMeMinerEnabledChange } from "@/lib/mining/mintmeMinerPreference";
import { getMintMeMiner, getHasherUrl, setHasherUrl, type MinerSnapshot } from "@/lib/blockchain/mintmeMiner/miner";
import { getStratumProxyUrl, setStratumProxyUrl, MINTME_POOL_LOW_DIFF } from "@/lib/blockchain/mintmeMiner/stratum";
import { splitShareWeight, MINTME_SPLIT } from "@/lib/blockchain/mintmeMiner/shareTracker";
import { getSwarmMeshStandalone } from "@/lib/p2p/swarmMesh.standalone";
import { getCurrentUser } from "@/lib/auth";

export const MINTME_TOGGLE_OFF_MESSAGE = "Turn on Miner in the node dashboard to start mining";

export function MintMeMiningCard({ connectedPeers }: { connectedPeers: number }) {
  const [enabled, setEnabled] = useState(getMintMeMinerEnabled());
  const [snap, setSnap] = useState<MinerSnapshot>(getMintMeMiner().snapshot);
  const [proxy, setProxy] = useState(getStratumProxyUrl() ?? "");
  const [hasher, setHasher] = useState(getHasherUrl() ?? "");
  const [note, setNote] = useState("");

  useEffect(() => onMintMeMinerEnabledChange(setEnabled), []);
  useEffect(() => getMintMeMiner().subscribe(setSnap), []);

  const start = async () => {
    setNote("");
    setStratumProxyUrl(proxy || null);
    setHasherUrl(hasher || null);
    const user = getCurrentUser();
    if (!user) { setNote("Sign in to mine to your MintMe address."); return; }
    try {
      const { getColdKeyReceivingAddress } = await import("@/lib/blockchain/wallets/coldKey");
      const address = await getColdKeyReceivingAddress(user.id);
      let mesh = null, peerId = user.id;
      try { const m = getSwarmMeshStandalone(); mesh = m; peerId = m.getPeerId() || user.id; } catch { /* offline */ }
      getMintMeMiner().start({ address, peerId, mesh });
    } catch {
      setNote("Unlock your wallet so your MintMe receiving address is known.");
    }
  };

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
  const running = snap.status === "mining" || snap.status === "connecting";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2"><Pickaxe className="h-4 w-4" /> MintMe Miner</span>
          <Badge variant={snap.status === "mining" ? "default" : "secondary"}>{snap.status}</Badge>
        </CardTitle>
        <CardDescription>Dual-mining on {MINTME_POOL_LOW_DIFF} (difficulty 12,500), throttled to stay light.</CardDescription>
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
          <p className="text-xs text-muted-foreground">Share receipts from peers seen: {snap.peerShares}. This is share-weight accounting; pool payouts arrive at your MintMe address.</p>
        </div>
        {!running && (
          <div className="space-y-2">
            <Input placeholder="Pool bridge (wss://…)" value={proxy} onChange={(e) => setProxy(e.target.value)} />
            <Input placeholder="Hashing module URL" value={hasher} onChange={(e) => setHasher(e.target.value)} />
          </div>
        )}
        {(snap.message || note) && <p className="text-xs text-muted-foreground">{note || snap.message}</p>}
        <Button type="button" size="sm" variant={running ? "outline" : "default"}
          onClick={() => (running ? getMintMeMiner().stop() : void start())}>
          {running ? "Stop" : "Start MintMe mining"}
        </Button>
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
