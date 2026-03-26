/**
 * SWARM Mesh Mode Panel
 * Wired to the new StandaloneSwarmMesh for auto-connect, library exchange, and content serving.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Pickaxe, UserPlus, CheckCircle2, Users, XCircle, Trash2, ShieldOff, ChevronDown, Eye } from "lucide-react";
import { toast } from "sonner";
import { useState, useEffect } from "react";
import { getMiningRewards } from "@/lib/blockchain/miningRewards";
import { BlockUserModal } from "./BlockUserModal";
import { getSwarmMeshStandalone, type SwarmPhase, type SwarmPeer, type LibraryPeer } from "@/lib/p2p/swarmMesh.standalone";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { getShowNetworkContent, setShowNetworkContent } from "@/lib/feed";
import { getRealmGraphStore } from "@/lib/p2p/realmGraph";

interface SwarmMeshModePanelProps {
  meshStats?: unknown;
  isOnline: boolean;
  onGoOffline: () => void;
  onBlockNode: () => void;
  onConnectToPeer: (peerId: string) => void;
}

export function SwarmMeshModePanel({
  isOnline,
  onGoOffline,
  onBlockNode,
  onConnectToPeer,
}: SwarmMeshModePanelProps) {
  const realmGraph = getRealmGraphStore();
  const mesh = getSwarmMeshStandalone();

  const [isMining, setIsMining] = useState<boolean>(() => mesh.getToggles().mining);
  const [manualPeerId, setManualPeerId] = useState("");
  const [miningStats, setMiningStats] = useState(() => mesh.getMiningStats());
  const [blockUserModalOpen, setBlockUserModalOpen] = useState(false);

  // SwarmMesh state
  const [phase, setPhase] = useState<SwarmPhase>(() => mesh.getPhase());
  const [peers, setPeers] = useState<SwarmPeer[]>([]);
  const [library, setLibrary] = useState<LibraryPeer[]>([]);
  const [blocked, setBlocked] = useState<string[]>(() => mesh.getBlockedPeers());
  const [alert, setAlert] = useState<{ msg: string; level: string } | null>(null);
  const [showNetContent, setShowNetContent] = useState(() => getShowNetworkContent());

  useEffect(() => {
    realmGraph.identifyLocalAccount({
      nodeId: mesh.getNodeId(),
      peerId: mesh.getPeerId(),
    });
    realmGraph.ingestPeerInventory({
      trusted: peers.map((peer) => peer.peerId),
      blocked,
      source: 'swarm-mesh-standalone',
      surface: 'panel:SwarmMeshModePanel',
      account: {
        nodeId: mesh.getNodeId(),
        peerId: mesh.getPeerId(),
      },
    });
  }, [blocked, mesh, peers, realmGraph]);

  useEffect(() => {
    const unsubs = [
      mesh.onPhaseChange(setPhase),
      mesh.onPeersChange(setPeers),
      mesh.onLibraryChange(setLibrary),
      mesh.onToggleChange((toggles) => setIsMining(toggles.mining)),
      mesh.onMiningChange(setMiningStats),
      mesh.onAlert((msg, level) => {
        setAlert({ msg, level });
        if (level === 'info') toast.success(msg);
        else if (level === 'warn') toast.info(msg);
        else toast.error(msg);
      }),
    ];
    setBlocked(mesh.getBlockedPeers());
    setIsMining(mesh.getToggles().mining);
    setMiningStats(mesh.getMiningStats());
    return () => unsubs.forEach(u => u());
  }, [mesh]);

  const connectedIds = new Set(peers.map(p => p.peerId));
  const rewards = getMiningRewards();

  const handleToggleMining = () => {
    const next = !isMining;
    mesh.setToggle('mining', next);
    toast.info(next ? "Auto-mining resumed" : "Auto-mining paused");
  };

  const handleConnectManual = () => {
    if (!manualPeerId.trim()) { toast.error("Enter a Peer ID"); return; }
    mesh.connectToPeer(manualPeerId.trim());
    onConnectToPeer(manualPeerId.trim());
    toast.success(`Connecting to ${manualPeerId.trim()}`);
    setManualPeerId("");
  };

  const handleBlockUser = (peerId: string) => {
    mesh.blockPeer(peerId);
    setBlocked(mesh.getBlockedPeers());
    onBlockNode();
  };

  const handleRemoveFromLibrary = (peerId: string) => {
    mesh.removeFromLibrary(peerId);
  };

  const handleUnblock = (peerId: string) => {
    mesh.unblockPeer(peerId);
    setBlocked(mesh.getBlockedPeers());
  };

  return (
    <div className="space-y-4">
      {/* Identity */}
      <Card className="border-foreground/10">
        <CardContent className="pt-5 space-y-1">
          <Label className="text-xs text-muted-foreground">Your Peer ID</Label>
          <code className="block text-xs font-mono bg-muted/50 rounded px-2 py-1.5 select-all break-all">
            {mesh.getPeerId()}
          </code>
          <p className="text-[10px] text-muted-foreground">Share this with others so they can connect to you</p>
        </CardContent>
      </Card>

      {/* Connection Alert */}
      {alert && phase === 'online' && peers.length === 0 && alert.level === 'warn' && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-400/80">
          {alert.msg}
        </div>
      )}

      {/* Mining */}
      <Card className="border-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <Pickaxe className="h-4 w-4 text-primary" />
              Mining
            </span>
            <Button onClick={handleToggleMining} variant={isMining ? "secondary" : "default"} size="sm">
              {isMining ? "Pause" : "Start"}
            </Button>
          </CardTitle>
        </CardHeader>
        {isMining && (
          <CardContent className="pt-0">
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
              <div className="flex items-center gap-2 mb-2">
                <Pickaxe className="h-3.5 w-3.5 text-primary animate-pulse" />
                <span className="text-xs font-medium text-primary">CREATOR Mining Active</span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-muted-foreground">Confirmed Blocks</div>
                  <div className="font-bold">{miningStats.confirmedBlocks ?? 0}</div>
                  <div className="text-primary">
                    +{((miningStats.confirmedBlocks ?? 0) * rewards.TRANSACTION_PROCESSED * (1 - rewards.NETWORK_POOL_PERCENTAGE)).toFixed(2)} SWARM
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Pending / Relayed</div>
                  <div className="font-bold">{miningStats.pendingBlocks ?? 0} / {miningStats.blocksRelayed ?? 0}</div>
                  <div className="text-muted-foreground">Awaiting consensus</div>
                </div>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Show Network Content toggle */}
      <Card className="border-foreground/10">
        <CardContent className="pt-5">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5 pr-4">
              <Label htmlFor="show-net-content-swarm" className="flex items-center gap-1.5">
                <Eye className="h-3.5 w-3.5 text-primary" />
                Show Network Content
              </Label>
              <p className="text-xs text-muted-foreground">
                Display posts synced from peers in your feed. Off = only your own posts appear.
              </p>
            </div>
            <Switch
              id="show-net-content-swarm"
              checked={showNetContent}
              onCheckedChange={(v) => {
                setShowNetContent(v);
                setShowNetworkContent(v);
              }}
            />
          </div>
        </CardContent>
      </Card>
      <Card className="border-foreground/10">
        <CardContent className="pt-5 space-y-2">
          <Label htmlFor="manual-peer-swarm">Connect to User (Network ID)</Label>
          <p className="text-xs text-muted-foreground">
            Enter a Node ID or Peer ID — the mesh auto-detects and connects
          </p>
          <div className="flex gap-2">
            <Input
              id="manual-peer-swarm"
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
                  <span className="text-[10px] text-muted-foreground">via {p.source} · {p.messagesReceived} msgs</span>
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
                  <span className="text-muted-foreground">{lp.source} · {connectedIds.has(lp.peerId) ? '🟢 online' : '⚫ offline'}</span>
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
      <div className="flex justify-center">
        <Button variant="outline" onClick={() => setBlockUserModalOpen(true)} className="w-full max-w-xs">
          Block User
        </Button>
      </div>

      {/* Status checks */}
      <div className="text-xs text-muted-foreground space-y-1 px-1">
        <p className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3 w-3 text-emerald-400" /> Auto-connect enabled (bootstrap + library)
        </p>
        <p className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3 w-3 text-emerald-400" /> Library exchange active
        </p>
        <p className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3 w-3 text-emerald-400" /> Blockchain sync active
        </p>
        <p className="flex items-center gap-1.5">
          <CheckCircle2 className="h-3 w-3 text-emerald-400" /> Content auto-served to peers
        </p>
      </div>

      <BlockUserModal
        open={blockUserModalOpen}
        onOpenChange={setBlockUserModalOpen}
        onBlock={handleBlockUser}
      />
    </div>
  );
}
