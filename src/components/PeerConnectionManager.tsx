import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useP2P } from '@/hooks/useP2P';
import { getUserConnections, createConnection, disconnectUsers, type Connection } from '@/lib/connections';
import { getAll } from '@/lib/store';
import { User } from '@/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Avatar } from './Avatar';
import { Users, UserPlus, UserMinus, Search, Loader2 } from 'lucide-react';
import { useToast } from './ui/use-toast';
import { useNavigate } from 'react-router-dom';

export function PeerConnectionManager() {
  const { user } = useAuth();
  const { getDiscoveredPeers, connectToPeer } = useP2P();
  const { toast } = useToast();
  const navigate = useNavigate();
  
  const [connections, setConnections] = useState<Connection[]>([]);
  const [availableUsers, setAvailableUsers] = useState<User[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  // Load connections and available users
  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user, open]);

  const loadData = async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      // Load existing connections
      const userConnections = await getUserConnections(user.id);
      setConnections(userConnections);

      // Load all users from IndexedDB
      const allUsers = await getAll<User>('users');
      
      // Filter out self and already connected users
      const connectedIds = new Set(userConnections.map(c => 
        c.userId === user.id ? c.connectedUserId : c.userId
      ));
      
      const available = allUsers.filter(u => 
        u.id !== user.id && !connectedIds.has(u.id)
      );
      
      setAvailableUsers(available);
    } catch (error) {
      console.error('[PeerConnectionManager] Error loading data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async (targetUser: User) => {
    if (!user) return;

    try {
      // Create connection in IndexedDB
      const connection = await createConnection(
        user.id,
        targetUser.id,
        targetUser.username
      );

      toast({
        title: "Connected!",
        description: `You're now connected with ${targetUser.username}`,
      });

      // Get discovered peers from P2P network
      const discoveredPeers = getDiscoveredPeers();
      const peerInfo = discoveredPeers.find(p => p.userId === targetUser.id);
      
      if (peerInfo) {
        // Establish P2P connection
        console.log('[PeerConnectionManager] Establishing P2P connection to', peerInfo.peerId);
        connectToPeer(peerInfo.peerId);
      } else {
        console.log('[PeerConnectionManager] Peer not currently online, will connect when available');
      }

      loadData();
    } catch (error) {
      console.error('[PeerConnectionManager] Error connecting:', error);
      toast({
        title: "Connection failed",
        description: "Could not connect to user",
        variant: "destructive"
      });
    }
  };

  const handleDisconnect = async (connection: Connection) => {
    if (!user) return;

    try {
      await disconnectUsers(user.id, connection.connectedUserId);
      
      toast({
        title: "Disconnected",
        description: "Connection removed",
      });

      loadData();
    } catch (error) {
      console.error('[PeerConnectionManager] Error disconnecting:', error);
    }
  };

  const filteredUsers = availableUsers.filter(u =>
    u.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.displayName?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredConnections = connections.filter(c =>
    c.connectedUserName?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!user) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Users className="h-4 w-4" />
          Connections
          {connections.length > 0 && (
            <Badge variant="secondary" className="ml-1">
              {connections.length}
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[600px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage Connections</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}

          {!loading && (
            <>
              {/* Current Connections */}
              {filteredConnections.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Your Connections</h3>
                  <div className="space-y-2">
                    {filteredConnections.map((connection) => {
                      const otherUserId = connection.userId === user.id 
                        ? connection.connectedUserId 
                        : connection.userId;
                      
                      return (
                        <div
                          key={connection.id}
                          className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                        >
                          <div 
                            className="flex items-center gap-3 flex-1 cursor-pointer"
                            onClick={() => {
                              navigate(`/profile/${otherUserId}`);
                              setOpen(false);
                            }}
                          >
                            <Avatar 
                              username={connection.connectedUserName || otherUserId.slice(0, 8)}
                              size="sm" 
                            />
                            <div className="flex-1">
                              <p className="font-medium">
                                {connection.connectedUserName || otherUserId.slice(0, 8)}
                              </p>
                              {connection.peerId && (
                                <p className="text-xs text-muted-foreground">
                                  Online via P2P
                                </p>
                              )}
                            </div>
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDisconnect(connection)}
                          >
                            <UserMinus className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Available Users */}
              {filteredUsers.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">
                    {searchQuery ? 'Search Results' : 'Available Users'}
                  </h3>
                  <div className="space-y-2">
                    {filteredUsers.map((targetUser) => (
                      <div
                        key={targetUser.id}
                        className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                      >
                        <div 
                          className="flex items-center gap-3 flex-1 cursor-pointer"
                          onClick={() => {
                            navigate(`/profile/${targetUser.id}`);
                            setOpen(false);
                          }}
                        >
                          <Avatar 
                            username={targetUser.username}
                            displayName={targetUser.displayName}
                            avatarRef={targetUser.profile?.avatarRef}
                            size="sm" 
                          />
                          <div>
                            <p className="font-medium">
                              {targetUser.displayName || targetUser.username}
                            </p>
                            {targetUser.profile?.bio && (
                              <p className="text-xs text-muted-foreground line-clamp-1">
                                {targetUser.profile.bio}
                              </p>
                            )}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => handleConnect(targetUser)}
                        >
                          <UserPlus className="h-4 w-4 mr-2" />
                          Connect
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Empty states */}
              {!loading && filteredUsers.length === 0 && filteredConnections.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  {searchQuery ? (
                    <p>No users found matching "{searchQuery}"</p>
                  ) : (
                    <div className="space-y-2">
                      <Users className="h-12 w-12 mx-auto opacity-50" />
                      <p>No available users to connect with</p>
                      <p className="text-sm">
                        Users will appear here once they've created posts or are discovered via P2P
                      </p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
