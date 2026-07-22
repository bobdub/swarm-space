import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { DoorOpen } from "lucide-react";
import {
  getGatewayStatus,
  startGatewayCell,
  stopGatewayCell,
  subscribeGatewayStatus,
  registerLocalIdentity,
  type GatewayStatus,
} from "@/lib/blockchain/gateway/swarmGatewayCell";
import { getCurrentUser } from "@/lib/auth";

export function SwarmGatewayPanel() {
  const [status, setStatus] = useState<GatewayStatus>(() => getGatewayStatus());
  const [evmAddr, setEvmAddr] = useState<string | null>(null);

  useEffect(() => subscribeGatewayStatus(setStatus), []);
  useEffect(() => {
    const me = getCurrentUser();
    if (me?.id) { void registerLocalIdentity(me.id).then(setEvmAddr); }
  }, []);

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
    </Card>
  );
}