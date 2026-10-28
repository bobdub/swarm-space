import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Save } from "lucide-react";
import { getMintMeMiner } from "@/lib/blockchain/mintmeMiner/miner";
import { getMintMeMiningCell } from "@/lib/blockchain/mintmeMiner/miningCell";
import { getStratumProxyUrl, setStratumProxyUrl, MINTME_POOL_LOW_DIFF } from "@/lib/blockchain/mintmeMiner/stratum";
import { getMintMeCommunityVaultAddress } from "@/lib/blockchain/mintmeMiner/communityCustody";

export function MintMeConnectionDetails() {
  const [endpoint, setEndpoint] = useState(getStratumProxyUrl() ?? "");
  const [selected, setSelected] = useState(getMintMeMiningCell().selectedEndpoint);
  const [snapshot, setSnapshot] = useState(getMintMeMiner().snapshot);
  const [note, setNote] = useState("");
  useEffect(() => getMintMeMiner().subscribe(setSnapshot), []);
  useEffect(() => getMintMeMiningCell().subscribe(() => setSelected(getMintMeMiningCell().selectedEndpoint)), []);
  return <div className="mt-4 space-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
    <p className="font-medium text-foreground">Community mining connection</p>
    <p role="status">{snapshot.message || (snapshot.status === "off" ? "Miner off" : snapshot.status === "mining" ? "Mining" : "Waiting for mining readiness")}</p>
    <p className="break-all">Bridge: {selected ?? "Waiting for a connected host"}</p>
    <p>Pool: {MINTME_POOL_LOW_DIFF} · difficulty 12,500</p>
    <p className="break-all">Community vault: {getMintMeCommunityVaultAddress() ?? "Not configured"}</p>
    <Label htmlFor="mintme-public-bridge">Public community bridge (WSS)</Label>
    <div className="flex min-w-0 gap-2">
      <Input id="mintme-public-bridge" className="min-w-0" placeholder="wss://…" value={endpoint} onChange={event => setEndpoint(event.target.value)} />
      <Button type="button" size="icon" variant="outline" title="Save community bridge" aria-label="Save community bridge" onClick={() => {
        setNote(setStratumProxyUrl(endpoint.trim() || null) ? "Community bridge preference saved." : "Use a public wss:// address without credentials, query parameters or a local host.");
      }}><Save className="h-4 w-4" /></Button>
    </div>
    {note && <p role="status">{note}</p>}
    <p>Pool proceeds collect in the community vault first. Payouts are not active.</p>
  </div>;
}