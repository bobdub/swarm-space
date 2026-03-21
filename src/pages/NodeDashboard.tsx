import { useCallback, useState } from 'react';
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

const NodeDashboard = () => {
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const snapshot = useNodeDashboard();
  const {
    enable,
    disable,
    connectToPeer,
    setControlFlag,
  } = useP2PContext();
  const alertingStatus = useAlertingStatus();
  const networkEnabled = snapshot.isEnabled;
  const networkConnecting = snapshot.isConnecting;

  const flags = getFeatureFlags();
  const isSwarmMeshMode = flags.swarmMeshMode;

  const [blockchainSync, setBlockchainSync] = useState(true);
  const buildMeshMode = snapshot.controls.isolate;
  const autoConnect = snapshot.controls.autoConnect;
  const approveOnly = snapshot.controls.manualAccept;

  const handleToggleNetwork = useCallback(() => {
    if (networkConnecting) { disable(); return; }
    if (networkEnabled) { disable(); } else { void enable(); }
  }, [networkConnecting, networkEnabled, disable, enable]);

  const handleGoOffline = () => { disable(); toast.info("Network disabled"); };
  const handleBlockNode = () => { toast.info("Block node feature — coming soon"); };
  const handleConnectToPeer = (inputId: string) => {
    const resolved = resolveNetworkId(inputId);
    const displayLabel = formatNetworkId(inputId);

    if (resolved.format === 'unknown') {
      toast.error('Unrecognized ID format. Enter a Node ID (16-char hex) or Peer ID (peer-xxx).');
      return;
    }

    // Connect via both systems for cross-mode reach
    if (resolved.nodeId) {
      connectToPeer(resolved.nodeId);
    }
    if (resolved.peerId) {
      connectToPeer(resolved.peerId);
    }
    // If only one format was available, also try the raw input
    if (!resolved.nodeId && !resolved.peerId) {
      connectToPeer(inputId);
    }

    toast.success(`Connecting to ${displayLabel}`, { id: `connect-${inputId}` });
  };

  // Inline stats
  const peerCount = snapshot.meshStats?.totalPeers ?? 0;
  const chainLen = (snapshot.meshStats as Record<string, unknown>)?.chainLength as number ?? 0;
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
                  networkEnabled
                    ? "border-emerald-500/40 text-emerald-400"
                    : "border-foreground/20 text-foreground/40"
                )}
              >
                {networkConnecting ? "connecting" : networkEnabled ? "online" : "offline"}
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
              ) : networkEnabled ? (
                <><WifiOff className="h-3.5 w-3.5" /> Disconnect</>
              ) : (
                <><Wifi className="h-3.5 w-3.5" /> Connect</>
              )}
            </Button>
          </div>
        </div>

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

        {!snapshot.isEnabled && user && (
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
          <BuilderModePanel
            isOnline={networkEnabled}
            buildMeshMode={buildMeshMode}
            blockchainSync={blockchainSync}
            autoConnect={autoConnect}
            approveOnly={approveOnly}
            onToggleBuildMesh={(v) => setControlFlag('isolate', v)}
            onToggleBlockchainSync={setBlockchainSync}
            onToggleAutoConnect={(v) => setControlFlag('autoConnect', v)}
            onToggleApproveOnly={(v) => setControlFlag('manualAccept', v)}
            onConnectToPeer={handleConnectToPeer}
            onGoOffline={handleGoOffline}
            onBlockNode={handleBlockNode}
          />
        )}

        {/* Advanced: Observability — collapsed by default */}
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
