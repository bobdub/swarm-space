import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, LogIn, Wifi, WifiOff, Pickaxe, Shield, Users, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TopNavigationBar } from '@/components/TopNavigationBar';
import { useNodeDashboard } from '@/hooks/useNodeDashboard';
import { useP2PContext } from '@/contexts/P2PContext';
import { SwarmMeshModePanel } from '@/components/p2p/dashboard/SwarmMeshModePanel';
import { BuilderModePanel } from '@/components/p2p/dashboard/BuilderModePanel';
import { AlertStatusBanner } from '@/components/p2p/dashboard/AlertStatusBanner';
import { useAlertingStatus } from '@/hooks/useAlertingStatus';
import { loadConnectionState } from '@/lib/p2p/connectionState';
import { toast } from 'sonner';
import { resolveNetworkId, formatNetworkId } from '@/lib/p2p/idResolver';
import { useAuth } from '@/hooks/useAuth';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { NetworkModeToggle } from '@/components/NetworkModeToggle';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { TorrentSwarmPanel } from '@/components/p2p/dashboard/TorrentSwarmPanel';
import { getTestMode, type TestModePhase } from '@/lib/p2p/testMode.standalone';
import { getSwarmMeshStandalone, type SwarmPhase } from '@/lib/p2p/swarmMesh.standalone';
import { getStandaloneBuilderMode, type BuilderPhase } from '@/lib/p2p/builderMode.standalone';
import { ConnectedPeersPanel } from '@/components/ConnectedPeersPanel';
import { BlockUserModal } from '@/components/p2p/dashboard/BlockUserModal';

const NodeDashboard = () => {
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const snapshot = useNodeDashboard();
  const {
    enable,
    disable,
  } = useP2PContext();
  const alertingStatus = useAlertingStatus();
  const [testPhase, setTestPhase] = useState<TestModePhase>(() => getTestMode().getPhase());
  const [swarmPhase, setSwarmPhase] = useState<SwarmPhase>(() => getSwarmMeshStandalone().getPhase());
  const [builderPhase, setBuilderPhase] = useState<BuilderPhase>(() => getStandaloneBuilderMode().getPhase());
  const [blockUserOpen, setBlockUserOpen] = useState(false);

  useEffect(() => {
    const u1 = getTestMode().onPhaseChange(setTestPhase);
    const u2 = getSwarmMeshStandalone().onPhaseChange(setSwarmPhase);
    const u3 = getStandaloneBuilderMode().onPhaseChange(setBuilderPhase);
    return () => { u1(); u2(); u3(); };
  }, []);

  const testModeActive = testPhase === 'online' || testPhase === 'connecting' || testPhase === 'reconnecting';
  const swarmActive = swarmPhase === 'online' || swarmPhase === 'connecting' || swarmPhase === 'reconnecting';
  const builderConnecting = builderPhase === 'connecting';
  const builderRetrying = builderPhase === 'reconnecting';
  const builderActive = builderPhase === 'online' || builderConnecting || builderRetrying;
  const networkEnabled = snapshot.isEnabled || testModeActive || swarmActive || builderActive;
  const networkConnecting = snapshot.isConnecting || testPhase === 'connecting' || testPhase === 'reconnecting' || swarmPhase === 'connecting' || swarmPhase === 'reconnecting' || builderConnecting;
  const networkRetrying = builderRetrying && !networkConnecting;

  const connState = loadConnectionState();
  const isSwarmMeshMode = connState.mode === 'swarm';

  const handleToggleNetwork = useCallback(() => {
    const tm = getTestMode();
    const sm = getSwarmMeshStandalone();
    const bm = getStandaloneBuilderMode();
    if (networkConnecting || networkRetrying) {
      disable(); tm.stop(); sm.stop(); bm.stop();
      return;
    }
    if (networkEnabled) {
      disable(); tm.stop(); sm.stop(); bm.stop();
    } else {
      void enable();
      if (isSwarmMeshMode) { void sm.start(); } else { void bm.start(); }
    }
  }, [networkConnecting, networkRetrying, networkEnabled, disable, enable, isSwarmMeshMode]);

  const handleGoOffline = () => {
    disable();
    getTestMode().stop();
    getSwarmMeshStandalone().stop();
    getStandaloneBuilderMode().stop();
    toast.info("Network disabled");
  };
  const handleBlockNode = () => { toast.info("Block node feature — coming soon"); };
  const handleConnectToPeer = (inputId: string) => {
    const resolved = resolveNetworkId(inputId);
    const displayLabel = formatNetworkId(inputId);
    const tm = getTestMode();
    const sm = getSwarmMeshStandalone();
    const bm = getStandaloneBuilderMode();

    if (resolved.format === 'unknown') {
      toast.error('Unrecognized ID format. Enter a Node ID (16-char hex) or Peer ID (peer-xxx).');
      return;
    }

    // Route through the active standalone mode
    const target = resolved.peerId ?? (resolved.nodeId ? `peer-${resolved.nodeId}` : inputId);
    if (isSwarmMeshMode) {
      if (sm.getPhase() === 'off' || sm.getPhase() === 'failed') void sm.start();
      sm.connectToPeer(target);
      toast.success(`Connecting to ${displayLabel}`, { id: `connect-${inputId}` });
    } else {
      const started = bm.connectToPeer(target);
      if (started) {
        toast.success(`Connecting to ${displayLabel}`, { id: `connect-${inputId}` });
      } else {
        toast.info(`Connection queued for ${displayLabel}`, { id: `connect-${inputId}` });
      }
    }
  };

  // Inline stats
  const peerCount = snapshot.peers.connected.length > 0
    ? snapshot.peers.connected.length
    : (snapshot.meshStats?.totalPeers ?? 0);
  const chainLen = snapshot.meshStats?.contentBlocks ?? snapshot.metrics.relayCount ?? 0;
  const health = snapshot.meshStats?.meshHealth ?? 0;

  return (
    <div className="min-h-screen">
      <TopNavigationBar />

      <main className="mx-auto max-w-5xl px-4 pt-36 pb-20 space-y-6">
        {/* Header with inline status */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-2xl font-display font-bold tracking-wide uppercase">
                Node Dashboard
              </h1>
              <Badge
                variant="outline"
                className={cn(
                  "text-[0.65rem] uppercase tracking-widest",
                    networkConnecting || networkRetrying
                      ? "border-amber-500/40 text-amber-400"
                      : networkEnabled
                    ? "border-emerald-500/40 text-emerald-400"
                    : "border-foreground/20 text-foreground/40"
                )}
              >
                  {networkConnecting ? "connecting" : networkRetrying ? "retrying" : networkEnabled ? "online" : "offline"}
              </Badge>
            </div>
            <p className="text-sm text-foreground/50">
              {isSwarmMeshMode
                ? 'SWARM Mesh — auto-connect, auto-mine, blockchain sync'
                : 'Builder Mode — manual controls, approve-only connections'}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant={networkEnabled ? 'outline' : 'default'}
              size="sm"
              onClick={handleToggleNetwork}
              disabled={!user || authLoading}
              className="gap-2"
            >
              {networkConnecting ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Cancel</>
              ) : networkRetrying ? (
                <><WifiOff className="h-3.5 w-3.5" /> Retry queued</>
              ) : networkEnabled ? (
                <><WifiOff className="h-3.5 w-3.5" /> Disconnect</>
              ) : (
                <><Wifi className="h-3.5 w-3.5" /> Connect</>
              )}
            </Button>
          </div>
        </div>

        {builderRetrying && !isSwarmMeshMode && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-400/90">
            Signaling is unreachable right now. Builder Mode is retrying in the background.
          </div>
        )}

        {/* Mode toggle */}
        <NetworkModeToggle variant="full" />

        {/* Inline stats bar */}
        {networkEnabled && (
          <div className="grid grid-cols-3 gap-3">
            <Card className="flex items-center gap-3 p-3 bg-[hsla(245,70%,8%,0.5)] border-foreground/10">
              <Users className="h-4 w-4 text-[hsl(174,59%,56%)]" />
              <div>
                <div className="text-lg font-bold leading-none">{peerCount}</div>
                <div className="text-[0.6rem] uppercase tracking-wider text-foreground/40 mt-0.5">Peers</div>
              </div>
            </Card>
            <Card className="flex items-center gap-3 p-3 bg-[hsla(245,70%,8%,0.5)] border-foreground/10">
              <Pickaxe className="h-4 w-4 text-[hsl(326,71%,62%)]" />
              <div>
                <div className="text-lg font-bold leading-none">{chainLen}</div>
                <div className="text-[0.6rem] uppercase tracking-wider text-foreground/40 mt-0.5">Blocks</div>
              </div>
            </Card>
            <Card className="flex items-center gap-3 p-3 bg-[hsla(245,70%,8%,0.5)] border-foreground/10">
              <Shield className="h-4 w-4 text-emerald-400" />
              <div>
                <div className="text-lg font-bold leading-none">{health}%</div>
                <div className="text-[0.6rem] uppercase tracking-wider text-foreground/40 mt-0.5">Health</div>
              </div>
            </Card>
          </div>
        )}

        {/* Auth required */}
        {!authLoading && !user && (
          <Alert className="border-primary/30 bg-primary/10">
            <LogIn className="h-4 w-4" />
            <AlertTitle>Sign in required</AlertTitle>
            <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>You need to sign in before you can enable the P2P network.</span>
              <Button size="sm" onClick={() => navigate('/auth?redirect=/node-dashboard')}>
                Sign In
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {!snapshot.isEnabled && user && !builderActive && !swarmActive && (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-400/80">
            Network is offline. Hit <strong>Connect</strong> to join the mesh.
          </div>
        )}

        {/* Mode panel */}
        {isSwarmMeshMode ? (
          <SwarmMeshModePanel
            meshStats={snapshot.meshStats}
            isOnline={networkEnabled}
            onGoOffline={handleGoOffline}
            onBlockNode={handleBlockNode}
            onConnectToPeer={handleConnectToPeer}
          />
        ) : (
          <BuilderModePanel />
        )}

        {/* Torrent Swarm Status — content distribution lives here */}
        {networkEnabled && <TorrentSwarmPanel />}

        {/* Connection Library — unified peer inventory */}
        {networkEnabled && <ConnectedPeersPanel title="Connection Library" />}

        {/* Block User — directly under the library */}
        {networkEnabled && (
          <div className="flex justify-center">
            <Button variant="outline" onClick={() => setBlockUserOpen(true)} className="w-full max-w-xs">
              Block User
            </Button>
          </div>
        )}
        <BlockUserModal
          open={blockUserOpen}
          onOpenChange={setBlockUserOpen}
          onBlock={(peerId) => {
            getSwarmMeshStandalone().blockPeer(peerId);
            handleBlockNode();
          }}
        />

        {/* Advanced: Observability & Webhooks — collapsed by default */}
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-between text-xs text-muted-foreground hover:text-foreground">
              <span>Advanced — Observability & Webhooks</span>
              <ChevronDown className="h-3.5 w-3.5 transition-transform [[data-state=open]>&]:rotate-180" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2 space-y-3">
            <Alert className="border-muted bg-muted/30">
              <Shield className="h-4 w-4" />
              <AlertTitle className="text-xs font-medium">What are webhooks?</AlertTitle>
              <AlertDescription className="text-xs text-muted-foreground leading-relaxed">
                Webhooks use known hooks to check mesh health and update health alerts — this is for helpers improving connections. Editing webhooks may affect your connection; disable them to restore default settings. Feel free to help!
              </AlertDescription>
            </Alert>
            <AlertStatusBanner view={alertingStatus} />
          </CollapsibleContent>
        </Collapsible>
      </main>
    </div>
  );
};

export default NodeDashboard;
