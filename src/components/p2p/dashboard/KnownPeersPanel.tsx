import { useState } from 'react';
import { Plus, Trash2, Clock } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  loadKnownPeers,
  addKnownPeer,
  removeKnownPeer,
  isAutoConnectEnabled,
  setAutoConnectEnabled,
  type KnownPeerEntry
} from '@/lib/p2p/knownPeers';
import { formatDistanceToNow } from 'date-fns';

export function KnownPeersPanel() {
  const [peers, setPeers] = useState<KnownPeerEntry[]>(loadKnownPeers());
  const [autoConnect, setAutoConnect] = useState(isAutoConnectEnabled());
  const [newPeerId, setNewPeerId] = useState('');
  const [newLabel, setNewLabel] = useState('');

  const handleToggleAutoConnect = (enabled: boolean) => {
    setAutoConnectEnabled(enabled);
    setAutoConnect(enabled);
  };

  const handleAddPeer = () => {
    if (!newPeerId.trim()) return;

    addKnownPeer(newPeerId.trim(), newLabel.trim() || undefined);
    setPeers(loadKnownPeers());
    setNewPeerId('');
    setNewLabel('');
  };

  const handleRemovePeer = (peerId: string) => {
    removeKnownPeer(peerId);
    setPeers(loadKnownPeers());
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>Known Peers</CardTitle>
            <CardDescription>
              Manage trusted node or peer IDs for automatic network connection
            </CardDescription>
          </div>
          <Badge variant="secondary" className="ml-2">
            {peers.length} {peers.length === 1 ? 'peer' : 'peers'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Auto-connect toggle */}
        <div className="flex items-center justify-between rounded-lg border border-border/40 bg-card/50 p-4">
          <div className="space-y-0.5">
            <Label htmlFor="auto-connect" className="text-sm font-medium">
              Auto-connect to network
            </Label>
            <p className="text-xs text-muted-foreground">
              Automatically connect to known peers when joining the swarm
            </p>
          </div>
          <Switch
            id="auto-connect"
            checked={autoConnect}
            onCheckedChange={handleToggleAutoConnect}
          />
        </div>

        {/* Add peer form */}
        <div className="space-y-3 rounded-lg border border-border/40 bg-card/50 p-4">
          <Label className="text-sm font-medium">Add Known Peer</Label>
          <div className="space-y-2">
            <Input
              placeholder="node-id or peer-xxxxxxxx-xxxxxxxx-xxxxxxx"
              value={newPeerId}
              onChange={(e) => setNewPeerId(e.target.value)}
              className="font-mono text-xs"
            />
            <Input
              placeholder="Label (optional)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="text-sm"
            />
            <Button
              onClick={handleAddPeer}
              disabled={!newPeerId.trim()}
              className="w-full"
              size="sm"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Peer
            </Button>
          </div>
        </div>

        {/* Known peers list */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Known Peer List</Label>
          {peers.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/40 p-6 text-center">
              <p className="text-sm text-muted-foreground">
                No known peers configured. Add a node ID or peer ID to enable auto-connect.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {peers.map((peer) => (
                <div
                  key={peer.peerId}
                  className="flex items-start justify-between rounded-lg border border-border/40 bg-card/50 p-3"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    {peer.label && (
                      <p className="text-sm font-medium">{peer.label}</p>
                    )}
                    <p className="font-mono text-xs text-muted-foreground break-all">
                      {peer.peerId}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {peer.peerId.startsWith('peer-') ? 'Peer ID' : 'Node ID'}
                    </p>
                    {peer.lastSeen && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        Last seen {formatDistanceToNow(peer.lastSeen, { addSuffix: true })}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleRemovePeer(peer.peerId)}
                    className="ml-2 shrink-0"
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {autoConnect && peers.length > 0 && (
          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
            <p className="text-xs text-muted-foreground">
              <strong className="text-foreground">Auto-connect enabled:</strong> The system will
              automatically attempt to connect to these peers when you join the network. If all
              peers are offline, you can manually enter a node or peer ID to connect.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
