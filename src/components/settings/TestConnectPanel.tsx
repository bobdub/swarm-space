import { useCallback, useEffect, useRef, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useP2PContext } from '@/contexts/P2PContext';
import { getSwarmMeshStandalone } from '@/lib/p2p/swarmMesh.standalone';
import { getTestMode } from '@/lib/p2p/testMode.standalone';
import { compareConnections } from '@/lib/p2p/connectionCompare';
import { TestModePanel } from '@/components/p2p/dashboard/TestModePanel';

type MeshSnapshot = { phase: string; peers: string[]; at: number };

/** Test Mode shares the mesh identity, so the mesh pauses while it runs. */
const RELEASE_ID_MS = 1500;

export function TestConnectPanel() {
  const { isEnabled, enable, disable } = useP2PContext();
  const [snapshot, setSnapshot] = useState<MeshSnapshot | null>(null);
  const [testPeers, setTestPeers] = useState<string[]>([]);
  const resumeMesh = useRef(false);

  useEffect(() => getTestMode().onPeersChange(peers => setTestPeers(peers.map(p => p.peerId))), []);

  const beforeStart = useCallback(async () => {
    const mesh = getSwarmMeshStandalone();
    setSnapshot({ phase: mesh.getPhase(), peers: mesh.getConnectedPeerIds(), at: Date.now() });
    resumeMesh.current = isEnabled;
    if (isEnabled) {
      disable({ persistPreference: false });
      await new Promise(resolve => setTimeout(resolve, RELEASE_ID_MS));
    }
  }, [isEnabled, disable]);

  const afterStop = useCallback(() => {
    if (!resumeMesh.current) return;
    resumeMesh.current = false;
    setTimeout(() => { void enable().catch(() => {}); }, RELEASE_ID_MS);
  }, [enable]);

  const result = snapshot ? compareConnections(snapshot.peers, testPeers) : null;
  const short = (id: string) => id.replace(/^peer-/, '').slice(0, 10);

  return (
    <div className="space-y-4">
      <Card className="space-y-2 rounded-3xl border border-primary/20 bg-card/60 p-6">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-bold">Test Connect</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          A plain connection tool for checking whether two devices can reach each other. Starting it pauses your
          normal network for a moment (they share your ID) and stopping it brings the network back.
        </p>
        {result && snapshot && (
          <div className="grid grid-cols-3 gap-2 pt-2 text-center text-xs">
            <div className="rounded-xl border border-border bg-background/50 p-2">
              <div className="text-muted-foreground">Network before test</div>
              <div className="text-lg font-bold">{snapshot.peers.length}</div>
              <div className="text-muted-foreground">{snapshot.phase}</div>
            </div>
            <div className="rounded-xl border border-border bg-background/50 p-2">
              <div className="text-muted-foreground">Test Connect now</div>
              <div className="text-lg font-bold">{testPeers.length}</div>
              <div className="text-muted-foreground">peers</div>
            </div>
            <div className="rounded-xl border border-border bg-background/50 p-2">
              <div className="text-muted-foreground">Reached by both</div>
              <div className="text-lg font-bold">{result.both.length}</div>
              <div className="text-muted-foreground">peers</div>
            </div>
            {(result.testOnly.length > 0 || result.meshOnly.length > 0) && (
              <div className="col-span-3 space-y-1 text-left text-muted-foreground">
                {result.testOnly.length > 0 && <p>Only Test Connect reached: {result.testOnly.map(short).join(', ')}</p>}
                {result.meshOnly.length > 0 && <p>Only the network reached: {result.meshOnly.map(short).join(', ')}</p>}
              </div>
            )}
          </div>
        )}
      </Card>
      <TestModePanel onBeforeStart={beforeStart} onAfterStop={afterStop} />
    </div>
  );
}
