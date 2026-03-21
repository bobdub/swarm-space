/**
 * Builder Mode Panel — Fully wired to builderMode.standalone.ts
 * No P2PContext dependencies. All toggles persist across refresh.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Settings2, Shield, WifiOff, Pickaxe, UserPlus, Users,
  XCircle, Trash2, ShieldOff, ChevronDown, CheckCircle2, UserCheck, UserX
} from "lucide-react";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import { BlockUserModal } from "./BlockUserModal";
import {
  getStandaloneBuilderMode,
  type BuilderPhase,
  type BuilderPeer,
  type LibraryPeer,
  type PendingPeer,
  type BuilderToggles,
  type MiningStats,
} from "@/lib/p2p/builderMode.standalone";
import { getMiningRewards } from "@/lib/blockchain/miningRewards";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

export function BuilderModePanel() {
  const builder = getStandaloneBuilderMode();

  const [manualPeerId, setManualPeerId] = useState("");
  const [blockUserModalOpen, setBlockUserModalOpen] = useState(false);

  // Builder state — all driven by standalone events
  const [phase, setPhase] = useState<BuilderPhase>(() => builder.getPhase());
  const [peers, setPeers] = useState<BuilderPeer[]>([]);
  const [library, setLibrary] = useState<LibraryPeer[]>([]);
  const [blocked, setBlocked] = useState<string[]>(() => builder.getBlockedPeers());
  const [pending, setPending] = useState<PendingPeer[]>([]);
  const [toggles, setToggles] = useState<BuilderToggles>(() => builder.getToggles());
  const [miningStats, setMiningStats] = useState<MiningStats>(() => builder.getMiningStats());

  useEffect(() => {
    const unsubs = [
      builder.onPhaseChange(setPhase),
      builder.onPeersChange(setPeers),
      builder.onLibraryChange(setLibrary),
      builder.onPendingChange(setPending),
      builder.onToggleChange(setToggles),
      builder.onMiningChange(setMiningStats),
      builder.onAlert((msg, level) => {
        if (level === 'info') toast.success(msg);
        else if (level === 'warn') toast.info(msg);
        else toast.error(msg);
      }),
    ];
    setBlocked(builder.getBlockedPeers());
    return () => unsubs.forEach(u => u());
  }, []);

  const connectedIds = new Set(peers.map(p => p.peerId));
  const rewards = getMiningRewards();

  const handleToggle = (key: keyof BuilderToggles, value: boolean) => {
    builder.setToggle(key, value);
    if (key === 'mining') {
      toast.info(value ? "Mining started" : "Mining paused");
    }
  };

  const handleConnectManual = () => {
    if (!manualPeerId.trim()) { toast.error("Enter a Peer ID"); return; }
    builder.connectToPeer(manualPeerId.trim());
    setManualPeerId("");
  };

  const handleBlockUser = (peerId: string) => {
    builder.blockPeer(peerId);
    setBlocked(builder.getBlockedPeers());
  };

  const handleRemoveFromLibrary = (peerId: string) => {
    builder.removeFromLibrary(peerId);
  };

  const handleUnblock = (peerId: string) => {
    builder.unblockPeer(peerId);
    setBlocked(builder.getBlockedPeers());
  };

  const handleGoOffline = () => {
    builder.stop();
    toast.info("Builder Mode disconnected");
  };

  return (
    <div className="space-y-4">
      {/* Toggle Controls */}
      <Card className="border-amber-500/20">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Settings2 className="h-4 w-4 text-amber-500" />
            Builder Controls
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="build-mesh">Build a Mesh</Label>
              <p className="text-xs text-muted-foreground">Accept and create peer connections</p>
            </div>
            <Switch id="build-mesh" checked={toggles.buildMesh} onCheckedChange={(v) => handleToggle('buildMesh', v)} />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="blockchain-sync">Blockchain Sync</Label>
              <p className="text-xs text-muted-foreground">Sync chain data with connected peers</p>
            </div>
            <Switch id="blockchain-sync" checked={toggles.blockchainSync} onCheckedChange={(v) => handleToggle('blockchainSync', v)} />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="auto-connect">Auto-Connect</Label>
              <p className="text-xs text-muted-foreground">Auto-dial saved library peers on connect</p>
            </div>
            <Switch id="auto-connect" checked={toggles.autoConnect} onCheckedChange={(v) => handleToggle('autoConnect', v)} />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="approve-only">Approve Only</Label>
              <p className="text-xs text-muted-foreground">Require manual approval for incoming peers</p>
            </div>
            <Switch id="approve-only" checked={toggles.approveOnly} onCheckedChange={(v) => handleToggle('approveOnly', v)} />
          </div>
        </CardContent>
      </Card>

      {/* Approval Queue */}
      {pending.length > 0 && (
        <Card className="border-blue-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <UserCheck className="h-4 w-4 text-blue-400" />
              Pending Approval
              <Badge variant="outline" className="ml-auto text-[10px]">{pending.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {pending.map(p => (
              <div key={p.peerId} className="flex items-center justify-between rounded-md border border-blue-500/10 p-2">
                <div className="min-w-0">
                  <code className="text-xs font-mono truncate block">{p.peerId}</code>
                  <span className="text-[10px] text-muted-foreground">Received {Math.round((Date.now() - p.receivedAt) / 1000)}s ago</span>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => builder.approvePeer(p.peerId)} title="Approve">
                    <UserCheck className="h-3.5 w-3.5 text-emerald-400" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => builder.rejectPeer(p.peerId)} title="Reject">
                    <UserX className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Mining */}
      <Card className="border-amber-500/20">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <Pickaxe className="h-4 w-4 text-amber-500" />
              Mining
            </span>
            <Switch
              checked={toggles.mining}
              onCheckedChange={(v) => handleToggle('mining', v)}
              disabled={phase !== 'online'}
            />
          </CardTitle>
        </CardHeader>
        {toggles.mining && (
          <CardContent className="pt-0">
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <div className="flex items-center gap-2 mb-2">
                <Pickaxe className="h-3.5 w-3.5 text-amber-500 animate-pulse" />
                <span className="text-xs font-medium text-amber-400">Mining Active</span>
              </div>
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div>
                  <div className="text-muted-foreground">Transactions</div>
                  <div className="font-bold">{miningStats.transactionsProcessed}</div>
                  <div className="text-amber-400">
                    +{(miningStats.transactionsProcessed * rewards.TRANSACTION_PROCESSED * (1 - rewards.NETWORK_POOL_PERCENTAGE)).toFixed(2)} SWARM
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Space Hosted</div>
                  <div className="font-bold">{miningStats.spaceHosted} MB</div>
                  <div className="text-amber-400">
                    +{(miningStats.spaceHosted * rewards.MB_HOSTED * (1 - rewards.NETWORK_POOL_PERCENTAGE)).toFixed(2)} SWARM
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Blocks</div>
                  <div className="font-bold">{miningStats.blocksMinedTotal}</div>
                </div>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Manual connect */}
      <Card className="border-foreground/10">
        <CardContent className="pt-5 space-y-2">
          <Label htmlFor="manual-peer-builder">Connect to User (Network ID)</Label>
          <p className="text-xs text-muted-foreground">
            Enter a Node ID or Peer ID — the system auto-detects the format
          </p>
          <div className="flex gap-2">
            <Input
              id="manual-peer-builder"
              placeholder="peer-xxx or Node ID..."
              value={manualPeerId}
              onChange={(e) => setManualPeerId(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleConnectManual(); }}
            />
            <Button onClick={handleConnectManual} variant="secondary">
              <UserPlus className="mr-2 h-4 w-4" />
              Connect
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Connected Peers */}
      {peers.length > 0 && (
        <Card className="border-emerald-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Users className="h-4 w-4 text-emerald-400" />
              Connected Peers
              <Badge variant="outline" className="ml-auto text-[10px]">{peers.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {peers.map(p => (
              <div key={p.peerId} className="flex items-center justify-between rounded-md border border-foreground/10 p-2">
                <div className="min-w-0">
                  <code className="text-xs font-mono truncate block">{p.peerId}</code>
                  <span className="text-[10px] text-muted-foreground">{p.messagesReceived} msgs received</span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => handleBlockUser(p.peerId)}>
                  <XCircle className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Connection Library */}
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="w-full justify-between text-xs text-muted-foreground hover:text-foreground">
            <span>Connection Library ({library.length})</span>
            <ChevronDown className="h-3.5 w-3.5 transition-transform [[data-state=open]>&]:rotate-180" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-1 space-y-1">
          {library.length === 0 ? (
            <p className="text-xs text-muted-foreground px-2">No saved peers yet.</p>
          ) : (
            library.map(lp => (
              <div key={lp.peerId} className="flex items-center justify-between rounded-md border border-foreground/5 px-2 py-1.5 text-xs">
                <div className="min-w-0">
                  <span className="font-mono truncate block">{lp.alias}</span>
                  <span className="text-muted-foreground">{connectedIds.has(lp.peerId) ? '🟢 online' : '⚫ offline'}</span>
                </div>
                <Button variant="ghost" size="sm" onClick={() => handleRemoveFromLibrary(lp.peerId)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* Blocked Peers */}
      {blocked.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-between text-xs text-destructive/60 hover:text-destructive">
              <span>Blocked ({blocked.length})</span>
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-1 space-y-1">
            {blocked.map(id => (
              <div key={id} className="flex items-center justify-between rounded-md border border-destructive/10 px-2 py-1.5 text-xs">
                <code className="font-mono truncate">{id}</code>
                <Button variant="ghost" size="sm" onClick={() => handleUnblock(id)}>
                  <ShieldOff className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3">
        <Button variant="outline" onClick={() => setBlockUserModalOpen(true)} className="w-full">
          <Shield className="mr-2 h-4 w-4" />
          Block User
        </Button>
        <Button variant="outline" onClick={handleGoOffline} className="w-full">
          <WifiOff className="mr-2 h-4 w-4" />
          Go Offline
        </Button>
      </div>

      {/* Status checks */}
      <div className="text-xs text-muted-foreground space-y-1 px-1">
        <p className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3 w-3 text-emerald-400" /> Build mesh: {toggles.buildMesh ? 'on' : 'off'}
        </p>
        <p className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3 w-3 text-emerald-400" /> Blockchain sync: {toggles.blockchainSync ? 'on' : 'off'}
        </p>
        <p className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3 w-3 text-emerald-400" /> Auto-connect: {toggles.autoConnect ? 'on' : 'off'}
        </p>
        <p className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3 w-3 text-emerald-400" /> Approve only: {toggles.approveOnly ? 'on' : 'off'}
        </p>
        <p className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3 w-3 text-emerald-400" /> Mining: {toggles.mining ? 'active' : 'off'}
        </p>
        <p className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3 w-3 text-emerald-400" /> Content auto-served to peers
        </p>
        <p className="font-medium text-amber-500 mt-2">⚠️ Advanced Mode — Manual network management</p>
      </div>

      <BlockUserModal
        open={blockUserModalOpen}
        onOpenChange={setBlockUserModalOpen}
        onBlock={handleBlockUser}
      />
    </div>
  );
}
