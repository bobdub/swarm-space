import { useMemo, useState } from 'react';
import { useP2PContext } from '@/contexts/P2PContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Avatar } from './Avatar';
import { Users, Search, Plug, Unplug, ShieldBan } from 'lucide-react';
import { useToast } from './ui/use-toast';

export function PeerConnectionManager() {
  const { getDiscoveredPeers, getActivePeerConnections, connectToPeer, disconnectFromPeer, blockPeer } = useP2PContext();
  const { toast } = useToast();

  const [searchQuery, setSearchQuery] = useState('');
  const [open, setOpen] = useState(false);

  const discoveredPeers = getDiscoveredPeers();
  const activeConnections = getActivePeerConnections();
  const connectedIds = useMemo(() => new Set(activeConnections.map((connection) => connection.peerId)), [activeConnections]);

  const filteredPeers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return discoveredPeers
      .filter((peer) => {
        if (!query) return true;
        const values = [peer.peerId, peer.userId, peer.profile?.displayName, peer.profile?.username]
          .filter(Boolean)
          .map((value) => String(value).toLowerCase());
        return values.some((value) => value.includes(query));
      })
      .sort((a, b) => {
        const aConnected = connectedIds.has(a.peerId);
        const bConnected = connectedIds.has(b.peerId);
        if (aConnected !== bConnected) return aConnected ? -1 : 1;
        return b.lastSeen.getTime() - a.lastSeen.getTime();
      });
  }, [connectedIds, discoveredPeers, searchQuery]);

  const handleConnect = (peerId: string) => {
    const accepted = connectToPeer(peerId, { manual: true, source: 'top-nav-connections' });
    toast({
      title: accepted ? 'Connecting peer' : 'Connection queued',
      description: peerId,
    });
  };

  const handleDisconnect = (peerId: string) => {
    disconnectFromPeer(peerId);
    toast({ title: 'Disconnected peer', description: peerId });
  };

  const handleBlock = (peerId: string) => {
    blockPeer(peerId, 'all', 'Blocked from top navigation connections manager');
    toast({ title: 'Blocked peer', description: peerId });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2">
          <Users className="h-4 w-4" />
          Connections
          <Badge variant="secondary" className="ml-1 text-[10px]">
            {discoveredPeers.length}
          </Badge>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Peer Connections</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Discovered</div>
              <div className="mt-1 text-2xl font-semibold">{discoveredPeers.length}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Connected</div>
              <div className="mt-1 text-2xl font-semibold">{activeConnections.length}</div>
            </div>
            <div className="rounded-lg border p-3">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Search scope</div>
              <div className="mt-1 text-sm text-muted-foreground">Live discovered peers</div>
            </div>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search discovered peers"
              className="pl-9"
            />
          </div>

          <div className="max-h-[26rem] space-y-2 overflow-y-auto pr-1">
            {filteredPeers.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                No discovered peers match your search.
              </div>
            ) : (
              filteredPeers.map((peer) => {
                const isConnected = connectedIds.has(peer.peerId);
                const label = peer.profile?.displayName ?? peer.profile?.username ?? peer.userId ?? peer.peerId;

                return (
                  <div key={peer.peerId} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar
                        username={peer.profile?.username ?? peer.peerId}
                        displayName={peer.profile?.displayName}
                        avatarRef={peer.profile?.avatarRef}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <div className="truncate font-medium">{label}</div>
                        <div className="truncate font-mono text-xs text-muted-foreground">{peer.peerId}</div>
                        <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                          <span>{peer.availableContent?.size ?? 0} shared items</span>
                          <span>{isConnected ? 'Connected now' : `Seen ${new Date(peer.lastSeen).toLocaleString()}`}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={isConnected ? 'default' : 'outline'}>
                        {isConnected ? 'Connected' : 'Discovered'}
                      </Badge>
                      <Button size="sm" variant={isConnected ? 'outline' : 'default'} onClick={() => isConnected ? handleDisconnect(peer.peerId) : handleConnect(peer.peerId)}>
                        {isConnected ? <Unplug className="mr-1 h-4 w-4" /> : <Plug className="mr-1 h-4 w-4" />}
                        {isConnected ? 'Disconnect' : 'Connect'}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleBlock(peer.peerId)}>
                        <ShieldBan className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
