import { createContext, useContext, ReactNode } from 'react';
import { useP2P } from '@/hooks/useP2P';
import type { P2PStats } from '@/lib/p2p/manager';
import type { Post } from '@/types';
import type { DiscoveredPeer } from '@/lib/p2p/discovery';

interface P2PContextValue {
  isEnabled: boolean;
  isConnecting: boolean;
  stats: P2PStats;
  enable: () => Promise<void>;
  disable: () => void;
  broadcastPost: (post: Post) => void;
  getPeerId: () => string | null;
  getDiscoveredPeers: () => DiscoveredPeer[];
  connectToPeer: (peerId: string) => void;
  joinRoom: (roomName: string) => void;
  leaveRoom: () => void;
  getCurrentRoom: () => string | null;
}

const P2PContext = createContext<P2PContextValue | null>(null);

export function P2PProvider({ children }: { children: ReactNode }) {
  const p2p = useP2P();

  return (
    <P2PContext.Provider value={p2p}>
      {children}
    </P2PContext.Provider>
  );
}

export function useP2PContext() {
  const context = useContext(P2PContext);
  if (!context) {
    throw new Error('useP2PContext must be used within P2PProvider');
  }
  return context;
}
