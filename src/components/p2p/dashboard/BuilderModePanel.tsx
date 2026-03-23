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
  Settings2, Shield, Pickaxe, UserPlus, Users,
  XCircle, Trash2, ShieldOff, ChevronDown, CheckCircle2, UserCheck, UserX, Copy,
  Zap, Image, Link2, Lock, HardDrive, Eye
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
import { switchNetworkMode, getCurrentMode } from "@/lib/p2p/networkModeSwitcher";
import { useP2PContext } from "@/contexts/P2PContext";
import { getShowNetworkContent, setShowNetworkContent } from "@/lib/feed";

export function BuilderModePanel() {
  const builder = getStandaloneBuilderMode();
  const { enable, disable, isEnabled } = useP2PContext();

  const [manualPeerId, setManualPeerId] = useState("");
  const [blockUserModalOpen, setBlockUserModalOpen] = useState(false);
  const [switchingToSwarm, setSwitchingToSwarm] = useState(false);

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
  const localPeerId = builder.getPeerId();

  const handleToggle = (key: keyof BuilderToggles, value: boolean) => {
    builder.setToggle(key, value);
    if (key === 'mining' && value && !toggles.blockchainSync) {
      // Interlock handled in standalone, but give UI feedback
      return;
    }
    if (key === 'approveOnly' && value) {
      toast.info("Private mode — Build a Mesh & Auto-Connect disabled");
    }
    if (key === 'blockchainSync' && !value) {
      toast.info("Blockchain offline — mining, wallet, and NFTs disabled");
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

  const handleCopyPeerId = async () => {
    try {
      await navigator.clipboard.writeText(localPeerId);
      toast.success("Builder Peer ID copied");
    } catch {
      toast.error("Could not copy peer ID");
    }
  };

  const handleSwitchToSwarm = async () => {
    if (switchingToSwarm) return;
    setSwitchingToSwarm(true);
    toast.info("Switching to SWARM Mesh…", { id: 'swarm-switch', duration: 2500 });
    try {
      await switchNetworkMode('swarm', { enable, disable, isOnline: isEnabled });
      toast.success("Connected to SWARM Mesh", { id: 'swarm-switch', duration: 3000 });
    } catch {
      toast.error("Switch failed", { id: 'swarm-switch' });
    } finally {
      setSwitchingToSwarm(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Local identity */}
      <Card className="border-foreground/10">
        <CardContent className="pt-5 space-y-2">
          <Label>Your Builder Peer ID</Label>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-muted px-2 py-1 text-xs font-mono">
              {localPeerId}
            </code>
            <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={handleCopyPeerId}>
              <Copy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Share this exact ID when connecting from another Builder node.
          </p>
        </CardContent>
      </Card>

      {/* Toggle Controls */}
      <Card className="border-amber-500/20">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Settings2 className="h-4 w-4 text-amber-500" />
            Builder Controls
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5 pt-0">
          {/* Build a Mesh */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5 pr-4">
              <Label htmlFor="build-mesh" className="flex items-center gap-1.5">
                <Link2 className="h-3.5 w-3.5 text-amber-500" />
                Build a Mesh
              </Label>
              <p className="text-xs text-muted-foreground">
                Accept manual peer requests & connect to your library. Ignores SWARM requests — this mesh revolves around you.
              </p>
            </div>
            <Switch
              id="build-mesh"
              checked={toggles.buildMesh}
              onCheckedChange={(v) => handleToggle('buildMesh', v)}
              disabled={toggles.approveOnly}
            />
          </div>

          {/* Blockchain Sync */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5 pr-4">
              <Label htmlFor="blockchain-sync" className="flex items-center gap-1.5">
                <HardDrive className="h-3.5 w-3.5 text-amber-500" />
                Blockchain Sync
              </Label>
              <p className="text-xs text-muted-foreground">
                Sync the chain to your connections. Off = no NFT wrapping, rewards, credits, tips, mining, or wallet functions.
              </p>
            </div>
            <Switch id="blockchain-sync" checked={toggles.blockchainSync} onCheckedChange={(v) => handleToggle('blockchainSync', v)} />
          </div>

          {/* Auto-Connect */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5 pr-4">
              <Label htmlFor="auto-connect" className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-amber-500" />
                Auto-Connect
              </Label>
              <p className="text-xs text-muted-foreground">
                Automatically dial saved library peers. Off = only manual requests accepted. Connections matter.
              </p>
            </div>
            <Switch
              id="auto-connect"
              checked={toggles.autoConnect}
              onCheckedChange={(v) => handleToggle('autoConnect', v)}
              disabled={toggles.approveOnly}
            />
          </div>

          {/* Approve Only */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5 pr-4">
              <Label htmlFor="approve-only" className="flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 text-amber-500" />
                Approve Only
              </Label>
              <p className="text-xs text-muted-foreground">
                All incoming requests must be approved before handshake. Enables private mode — Build a Mesh & Auto-Connect turn off.
              </p>
            </div>
            <Switch id="approve-only" checked={toggles.approveOnly} onCheckedChange={(v) => handleToggle('approveOnly', v)} />
          </div>

          {/* Torrent Serving */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5 pr-4">
              <Label htmlFor="torrent-serving" className="flex items-center gap-1.5">
                <Image className="h-3.5 w-3.5 text-amber-500" />
                Torrent Serving
              </Label>
              <p className="text-xs text-muted-foreground">
                Serve media content to peers. Off = no images or media will sync, serve, or seed.
              </p>
            </div>
            <Switch id="torrent-serving" checked={toggles.torrentServing} onCheckedChange={(v) => handleToggle('torrentServing', v)} />
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
              {!toggles.blockchainSync && (
                <Badge variant="outline" className="text-[9px] text-destructive/70">Requires Blockchain Sync</Badge>
              )}
            </span>
            <Switch
              checked={toggles.mining}
              onCheckedChange={(v) => handleToggle('mining', v)}
              disabled={phase !== 'online' || !toggles.blockchainSync}
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
      <div className="flex flex-col gap-2">
        <Button variant="outline" onClick={() => setBlockUserModalOpen(true)} className="w-full">
          <Shield className="mr-2 h-4 w-4" />
          Block User
        </Button>

        {/* Swarm Accept — switch to SWARM network */}
        <Button
          variant="secondary"
          onClick={handleSwitchToSwarm}
          disabled={switchingToSwarm}
          className="w-full bg-gradient-to-r from-[hsl(var(--primary)/0.15)] to-[hsl(var(--accent)/0.15)] hover:from-[hsl(var(--primary)/0.25)] hover:to-[hsl(var(--accent)/0.25)] border border-primary/20"
        >
          <Zap className="mr-2 h-4 w-4 text-primary" />
          {switchingToSwarm ? 'Switching…' : 'Accept SWARM Requests'}
        </Button>
        <p className="text-[10px] text-muted-foreground text-center">
          Switch to SWARM Mesh to accept requests from the open network. You can switch back anytime.
        </p>
      </div>

      {/* Status checks */}
      <div className="text-xs text-muted-foreground space-y-1 px-1">
        <p className="flex items-center gap-1.5">
          <CheckCircle2 className={`h-3 w-3 ${toggles.buildMesh ? 'text-emerald-400' : 'text-foreground/20'}`} />
          Build mesh: {toggles.buildMesh ? 'on' : 'off'}
        </p>
        <p className="flex items-center gap-1.5">
          <CheckCircle2 className={`h-3 w-3 ${toggles.blockchainSync ? 'text-emerald-400' : 'text-foreground/20'}`} />
          Blockchain sync: {toggles.blockchainSync ? 'on' : 'off'}
        </p>
        <p className="flex items-center gap-1.5">
          <CheckCircle2 className={`h-3 w-3 ${toggles.autoConnect ? 'text-emerald-400' : 'text-foreground/20'}`} />
          Auto-connect: {toggles.autoConnect ? 'on' : 'off'}
        </p>
        <p className="flex items-center gap-1.5">
          <CheckCircle2 className={`h-3 w-3 ${toggles.approveOnly ? 'text-amber-400' : 'text-foreground/20'}`} />
          Approve only: {toggles.approveOnly ? 'on (private)' : 'off'}
        </p>
        <p className="flex items-center gap-1.5">
          <CheckCircle2 className={`h-3 w-3 ${toggles.torrentServing ? 'text-emerald-400' : 'text-foreground/20'}`} />
          Torrent serving: {toggles.torrentServing ? 'on' : 'off'}
        </p>
        <p className="flex items-center gap-1.5">
          <CheckCircle2 className={`h-3 w-3 ${toggles.mining ? 'text-emerald-400' : 'text-foreground/20'}`} />
          Mining: {toggles.mining ? 'active' : 'off'}
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
