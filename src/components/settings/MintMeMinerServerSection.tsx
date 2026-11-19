import { useEffect, useState } from "react";
import { Pickaxe } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { PersonalServer } from "@/lib/storage/providers/personalServerStore";
import {
  getMintMeMinerEnabled,
  setMintMeMinerEnabled,
  onMintMeMinerEnabledChange,
  getMintMeMinerServerId,
  setMintMeMinerServerId,
  mintMeBridgeUrlForServer,
} from "@/lib/mining/mintmeMinerPreference";
import { getMintMeMiner } from "@/lib/blockchain/mintmeMiner/miner";
import { MINTME_POOL_LOW_DIFF } from "@/lib/blockchain/mintmeMiner/stratum";
import { getMintMeCommunityVaultAddress } from "@/lib/blockchain/mintmeMiner/communityCustody";

/** MintMe miner switch. Only rendered when at least one personal server is attached. */
export function MintMeMinerServerSection({ servers }: { servers: PersonalServer[] }) {
  const [enabled, setEnabled] = useState(() => getMintMeMinerEnabled());
  const [serverId, setServerId] = useState(() => getMintMeMinerServerId());
  const [snapshot, setSnapshot] = useState(() => getMintMeMiner().snapshot);
  useEffect(() => onMintMeMinerEnabledChange((on) => { setEnabled(on); setServerId(getMintMeMinerServerId()); }), []);
  useEffect(() => getMintMeMiner().subscribe(setSnapshot), []);

  const server = servers.find((s) => s.id === serverId) ?? servers[0];
  if (!server) return null;
  const bridge = mintMeBridgeUrlForServer(server);
  const status = !enabled
    ? "Miner off"
    : snapshot.message || (snapshot.status === "mining" ? "Mining" : "Getting ready to mine");

  return (
    <div className="mt-4 rounded-xl border border-border/40 bg-background/30 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <Label htmlFor="mintme-miner-switch" className="flex items-center gap-1.5">
            <Pickaxe className="h-3.5 w-3.5 text-primary" />
            MintMe Miner
          </Label>
          <p className="text-xs text-muted-foreground">
            Off by default. Mines through a bridge on your personal server. Your choice is saved on this device.
          </p>
        </div>
        <Switch
          id="mintme-miner-switch"
          checked={enabled && !!bridge}
          disabled={!bridge}
          onCheckedChange={(on) => setMintMeMinerEnabled(on)}
        />
      </div>

      {servers.length > 1 ? (
        <div className="mt-3 space-y-1">
          <Label htmlFor="mintme-miner-server" className="text-xs">Server</Label>
          <select
            id="mintme-miner-server"
            className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm"
            value={server.id}
            onChange={(event) => setMintMeMinerServerId(event.target.value)}
          >
            {servers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      ) : null}

      <div className="mt-3 space-y-1 text-xs text-muted-foreground">
        <p className="break-all">Bridge: {bridge ?? "Not available"}</p>
        {!bridge ? (
          <p className="text-amber-400/90">
            This server uses a local or non-HTTPS address, so the miner cannot use it.
            Expose it over public HTTPS to mine.
          </p>
        ) : null}
        <p role="status">{status}</p>
        <p>Pool: {MINTME_POOL_LOW_DIFF} · difficulty 12,500</p>
        <p className="break-all">Community vault: {getMintMeCommunityVaultAddress() ?? "Not configured"}</p>
        <p>Your server needs a WebSocket to pool bridge at the path shown above.</p>
      </div>
    </div>
  );
}
