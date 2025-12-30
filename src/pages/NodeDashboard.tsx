import { useCallback, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNodeDashboard } from '@/hooks/useNodeDashboard';
import { useP2PContext } from '@/contexts/P2PContext';
import { SwarmMeshModePanel } from '@/components/p2p/dashboard/SwarmMeshModePanel';
import { BuilderModePanel } from '@/components/p2p/dashboard/BuilderModePanel';
import { AlertStatusBanner } from '@/components/p2p/dashboard/AlertStatusBanner';
import { useAlertingStatus } from '@/hooks/useAlertingStatus';
import { getFeatureFlags, setFeatureFlag } from '@/config/featureFlags';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';

const NodeDashboard = () => {
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

  // Legacy mode toggles
  const [blockchainSync, setBlockchainSync] = useState(true);
  const buildMeshMode = snapshot.controls.isolate;
  const autoConnect = snapshot.controls.autoConnect;
  const approveOnly = snapshot.controls.manualAccept;

  const handleToggleNetwork = useCallback(() => {
    if (networkConnecting) {
      disable();
      return;
    }

    if (networkEnabled) {
      disable();
    } else {
      void enable();
    }
  }, [networkConnecting, networkEnabled, disable, enable]);

  const handleSwitchMode = async () => {
    const newMode = !isSwarmMeshMode;
    const targetModeName = newMode ? 'SWARM Mesh' : 'Builder';
    
    // If network is enabled, do a clean switch with exactly 2 alerts
    if (networkEnabled) {
      // Alert 1: Switching Networks
      toast.info('Switching Networks...', {
        id: 'network-switch',
        duration: 2000,
      });
      
      // Disconnect
      disable();
      
      // Wait for clean disconnect
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Set new mode
      setFeatureFlag('swarmMeshMode', newMode);
      
      // Wait a moment before reconnect
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Auto-reconnect
      await enable();
      
      // Alert 2: Connected to new mode
      toast.success(`Connected to ${targetModeName}`, {
        id: 'network-switch',
        duration: 3000,
      });
    } else {
      // Network not enabled, just switch mode
      setFeatureFlag('swarmMeshMode', newMode);
      toast.success(`Switched to ${targetModeName} mode`, {
        id: 'network-switch',
      });
    }
  };

  const handleGoOffline = () => {
    disable();
    toast.info("Network disabled");
  };

  const handleBlockNode = () => {
    toast.info("Block node feature - coming soon");
  };

  const handleConnectToPeer = (peerId: string) => {
    connectToPeer(peerId);
    toast.success(`Connecting to ${peerId}`);
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Node Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {isSwarmMeshMode 
              ? 'Unified SWARM Mesh network with blockchain integration'
              : 'Builder Mode: Advanced P2P controls with custom configuration'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={networkEnabled ? 'outline' : 'default'}
            size="sm"
            onClick={handleToggleNetwork}
          >
            {networkConnecting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Cancel
              </>
            ) : networkEnabled ? (
              'Disable Network'
            ) : (
              'Enable Network'
            )}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleSwitchMode}
          >
            Switch to {isSwarmMeshMode ? 'Builder' : 'SWARM Mesh'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => window.history.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Button>
        </div>
      </div>

      {!snapshot.isEnabled && (
        <div className="rounded-md border border-border/40 bg-amber-500/10 p-4 text-sm text-amber-600">
          The P2P network is currently disabled. Enable it to start connecting.
        </div>
      )}

      <AlertStatusBanner view={alertingStatus} />

      {/* Mode-specific panels */}
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
          onToggleBuildMesh={(value) => setControlFlag('isolate', value)}
          onToggleBlockchainSync={setBlockchainSync}
          onToggleAutoConnect={(value) => setControlFlag('autoConnect', value)}
          onToggleApproveOnly={(value) => setControlFlag('manualAccept', value)}
          onConnectToPeer={handleConnectToPeer}
          onGoOffline={handleGoOffline}
          onBlockNode={handleBlockNode}
        />
      )}

      {/* Feature comparison */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <div className="p-4 rounded-lg border bg-primary/5 border-primary/20">
          <h3 className="font-semibold mb-2">SWARM Mesh Features</h3>
          <ul className="space-y-1 text-muted-foreground">
            <li>✅ Auto-connect to main network</li>
            <li>✅ Blockchain sync (always active)</li>
            <li>✅ Auto-mining when connected</li>
            <li>✅ Reduced connection alerts</li>
            <li>✅ Unified transport layer</li>
          </ul>
        </div>
        <div className="p-4 rounded-lg border bg-amber-500/5 border-amber-500/20">
          <h3 className="font-semibold mb-2">Builder Mode Features</h3>
          <ul className="space-y-1 text-muted-foreground">
            <li>⚙️ Manual peer connections</li>
            <li>⚙️ Blockchain sync toggle</li>
            <li>⚙️ Auto-connect control</li>
            <li>⚙️ Approve-only mode</li>
            <li>⚙️ Advanced network management</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default NodeDashboard;
