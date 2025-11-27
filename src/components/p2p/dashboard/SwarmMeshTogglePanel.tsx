import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Network, Radio, Shield, TrendingUp } from 'lucide-react';
import { getFeatureFlags, setFeatureFlag } from '@/config/featureFlags';
import { useState, useEffect } from 'react';

interface SwarmMeshStats {
  totalPeers: number;
  directConnections: number;
  averageQuality: number;
  averageReputation: number;
  meshHealth: number;
  blockchainSynced: boolean;
}

interface SwarmMeshTogglePanelProps {
  meshStats?: SwarmMeshStats | null;
}

export function SwarmMeshTogglePanel({ meshStats }: SwarmMeshTogglePanelProps) {
  const [swarmMeshEnabled, setSwarmMeshEnabled] = useState(() => getFeatureFlags().swarmMeshMode);

  useEffect(() => {
    const flags = getFeatureFlags();
    setSwarmMeshEnabled(flags.swarmMeshMode);
  }, []);

  const handleToggle = (checked: boolean) => {
    setSwarmMeshEnabled(checked);
    setFeatureFlag('swarmMeshMode', checked);
    
    // Notify user that refresh is needed
    if (checked) {
      console.log('[SWARM Mesh] 🌐 Unified mesh mode enabled - refresh page to activate');
    } else {
      console.log('[SWARM Mesh] 📡 Legacy P2P mode enabled - refresh page to activate');
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Network className="h-5 w-5" />
              Network Mode
            </CardTitle>
            <CardDescription>
              Switch between Legacy P2P and unified SWARM Mesh
            </CardDescription>
          </div>
          <Badge variant={swarmMeshEnabled ? 'default' : 'secondary'}>
            {swarmMeshEnabled ? 'SWARM Mesh' : 'Legacy'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <Label htmlFor="swarm-mesh-toggle" className="text-base font-medium">
              {swarmMeshEnabled ? 'SWARM Mesh Mode' : 'Legacy P2P Mode'}
            </Label>
            <p className="text-sm text-muted-foreground">
              {swarmMeshEnabled 
                ? 'Unified mesh with blockchain routing, dynamic timeouts, and tab persistence'
                : 'Classic PeerJS with auto-connect and mesh maintenance'
              }
            </p>
          </div>
          <Switch
            id="swarm-mesh-toggle"
            checked={swarmMeshEnabled}
            onCheckedChange={handleToggle}
          />
        </div>

        {swarmMeshEnabled && meshStats && (
          <div className="space-y-3">
            <div className="text-sm font-medium">SWARM Mesh Statistics</div>
            <div className="grid gap-3">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Network className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Total Peers</span>
                </div>
                <span className="font-mono text-sm font-semibold">{meshStats.totalPeers}</span>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Radio className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Direct Connections</span>
                </div>
                <span className="font-mono text-sm font-semibold">{meshStats.directConnections}</span>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Mesh Health</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-2 w-24 overflow-hidden rounded-full bg-muted">
                    <div 
                      className="h-full bg-primary transition-all"
                      style={{ width: `${meshStats.meshHealth}%` }}
                    />
                  </div>
                  <span className="font-mono text-sm font-semibold">{meshStats.meshHealth}%</span>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Avg Reputation</span>
                </div>
                <span className="font-mono text-sm font-semibold">{meshStats.averageReputation}</span>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/50">
                <span className="text-sm">Quality Score</span>
                <span className="font-mono text-sm font-semibold">{meshStats.averageQuality}</span>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/50">
                <span className="text-sm">Blockchain Synced</span>
                <Badge variant={meshStats.blockchainSynced ? 'default' : 'secondary'}>
                  {meshStats.blockchainSynced ? 'Yes' : 'No'}
                </Badge>
              </div>
            </div>
          </div>
        )}

        {swarmMeshEnabled && !meshStats && (
          <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            Refresh the page to activate SWARM Mesh mode and view statistics
          </div>
        )}

        {!swarmMeshEnabled && (
          <div className="rounded-lg border border-border/50 bg-muted/20 p-4">
            <div className="text-sm font-medium mb-2">Legacy Mode Features:</div>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>• PeerJS cloud signaling</li>
              <li>• Auto-connect to known peers</li>
              <li>• Periodic mesh maintenance</li>
              <li>• Bootstrap peer discovery</li>
              <li>• Gossip protocol synchronization</li>
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
