import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DoorOpen, Radio } from "lucide-react";
import {
  getGatewayStatus,
  startGatewayCell,
  stopGatewayCell,
  subscribeGatewayStatus,
  registerLocalIdentity,
  type GatewayStatus,
} from "@/lib/blockchain/gateway/swarmGatewayCell";
import { getCurrentUser } from "@/lib/auth";
import { getGlobalCell, type GatewayPeerInfo } from "@/lib/p2p/globalCell";
import {
  setRemoteGateway,
  clearRemoteGateway,
  subscribeRemoteGateway,
} from "@/lib/blockchain/wallets/swarmProvider";

export function SwarmGatewayPanel() {
  const [status, setStatus] = useState<GatewayStatus>(() => getGatewayStatus());
  const [evmAddr, setEvmAddr] = useState<string | null>(null);
  const [remotePeers, setRemotePeers] = useState<GatewayPeerInfo[]>([]);
  const [activeRemote, setActiveRemote] = useState<string | null>(null);

  useEffect(() => subscribeGatewayStatus(setStatus), []);
  useEffect(() => {
    const me = getCurrentUser();
    if (me?.id) { void registerLocalIdentity(me.id).then(setEvmAddr); }
  }, []);
  useEffect(() => {
    try { return getGlobalCell().subscribeGatewayPeers(setRemotePeers); }
    catch { return () => {}; }
  }, []);
  useEffect(() => subscribeRemoteGateway(setActiveRemote), []);

  const relTime = (ts: number) => {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return `${s}s ago`;
    return `${Math.floor(s / 60)}m ago`;
  };

  return (
    <Card className="space-y-4 rounded-3xl border border-[hsla(174,59%,56%,0.18)] bg-[hsla(245,70%,8%,0.45)] p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-xl font-bold">
            <DoorOpen className="h-5 w-5" /> Swarm Gateway Cell
          </h2>
          <p className="text-sm text-foreground/60">
            A doorway that lets MetaMask visit the Swarm chain. Your local Swarm wallet
            stays your primary wallet — this only translates outside requests into mesh messages.
          </p>
        </div>
        <Switch
          checked={status.running}
          onCheckedChange={(v) => (v ? startGatewayCell() : stopGatewayCell())}
          aria-label="Toggle Swarm gateway cell"
        />
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs text-foreground/70">
        <div>
          <div className="text-foreground/50">Status</div>
          <Badge variant={status.running ? "default" : "secondary"} className="mt-1">
            {status.running ? "Running" : "Off"}
          </Badge>
        </div>
        <div>
          <div className="text-foreground/50">Requests served</div>
          <div className="mt-1 tabular-nums">{status.requestsServed}</div>
        </div>
        <div className="col-span-2">
          <div className="text-foreground/50">Your EVM-face address</div>
          <div className="mt-1 break-all font-mono text-[10px]">{evmAddr ?? "—"}</div>
        </div>
        {status.lastMethod && (
          <div className="col-span-2">
            <div className="text-foreground/50">Last call</div>
            <div className="mt-1 font-mono text-[10px]">{status.lastMethod}</div>
          </div>
        )}
        {status.lastError && (
          <div className="col-span-2">
            <div className="text-foreground/50">Last error</div>
            <div className="mt-1 font-mono text-[10px] text-destructive">{status.lastError}</div>
          </div>
        )}
      </div>

      <div className="space-y-2 rounded-2xl border border-[hsla(174,59%,56%,0.12)] bg-[hsla(245,70%,6%,0.35)] p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Radio className="h-4 w-4" /> Remote gateways
          </div>
          <Badge variant={activeRemote ? "default" : "secondary"} className="text-[10px]">
            {activeRemote ? `via ${activeRemote.slice(0, 8)}…` : "Local"}
          </Badge>
        </div>
        <p className="text-[11px] text-foreground/50">
          Other peers announcing a gateway on the mesh. Route MetaMask through one to save local work.
        </p>
        {remotePeers.length === 0 ? (
          <div className="text-[11px] text-foreground/40 italic">No remote gateways discovered yet.</div>
        ) : (
          <ul className="space-y-1">
            {remotePeers.map((p) => {
              const isActive = activeRemote === p.peerId;
              return (
                <li key={p.peerId} className="flex items-center justify-between gap-2 rounded-lg bg-[hsla(245,70%,4%,0.4)] px-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[10px]">{p.peerId.slice(0, 20)}…</div>
                    <div className="text-[10px] text-foreground/50">
                      trust {p.trustScore.toFixed(2)} · {relTime(p.lastSeenAt)}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={isActive ? "secondary" : "default"}
                    className="h-7 text-[10px]"
                    onClick={() => (isActive ? clearRemoteGateway() : setRemoteGateway(p.peerId))}
                  >
                    {isActive ? "Disconnect" : "Use"}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
        {activeRemote && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 w-full text-[10px]"
            onClick={() => clearRemoteGateway()}
          >
            Fall back to local gateway
          </Button>
        )}
      </div>
    </Card>
  );
}