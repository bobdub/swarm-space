import { useCallback } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNodeDashboard } from '@/hooks/useNodeDashboard';
import { useP2PContext } from '@/contexts/P2PContext';
import { NodeStatusOverview } from '@/components/p2p/dashboard/NodeStatusOverview';
import { MeshControlsPanel } from '@/components/p2p/dashboard/MeshControlsPanel';
import { ConnectionHealthPanel } from '@/components/p2p/dashboard/ConnectionHealthPanel';
import { PeerInventoryPanel } from '@/components/p2p/dashboard/PeerInventoryPanel';
import type { P2PControlState } from '@/lib/p2p/manager';

const NodeDashboard = () => {
  const snapshot = useNodeDashboard();
  const {
    setRendezvousMeshEnabled,
    refreshPeerRegistry,
    setControlFlag,
  } = useP2PContext();

  const handleToggleMesh = useCallback(
    (enabled: boolean) => {
      setRendezvousMeshEnabled(enabled);
    },
    [setRendezvousMeshEnabled]
  );

  const handleControlChange = useCallback(
    (key: keyof P2PControlState, value: boolean) => {
      setControlFlag(key, value);
    },
    [setControlFlag]
  );

  const handleRefreshPeers = useCallback(() => {
    refreshPeerRegistry();
  }, [refreshPeerRegistry]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Node dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Observe swarm telemetry and exercise rendezvous controls without leaving the networking tab.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => window.history.back()}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
      </div>

      {!snapshot.isEnabled && (
        <div className="rounded-md border border-border/40 bg-amber-500/10 p-4 text-sm text-amber-600">
          The P2P network is currently disabled. Enable it from the networking tab to populate live metrics.
        </div>
      )}

      <NodeStatusOverview snapshot={snapshot} />
      <MeshControlsPanel
        snapshot={snapshot}
        onToggleMesh={handleToggleMesh}
        onRefreshPeers={handleRefreshPeers}
        onControlChange={handleControlChange}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ConnectionHealthPanel snapshot={snapshot} />
        <PeerInventoryPanel snapshot={snapshot} />
      </div>
    </div>
  );
};

export default NodeDashboard;
