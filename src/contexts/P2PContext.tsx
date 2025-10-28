/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, ReactNode } from 'react';
import { useP2P } from '@/hooks/useP2P';
import type { P2PStats, EnsureManifestOptions, P2PControlState } from '@/lib/p2p/manager';
import type { RendezvousMeshConfig } from '@/lib/p2p/rendezvousConfig';
import type { Post } from '@/types';
import type { DiscoveredPeer } from '@/lib/p2p/discovery';
import type { Manifest } from '@/lib/store';

interface P2PContextValue {
  isEnabled: boolean;
  isConnecting: boolean;
  stats: P2PStats;
  isRendezvousMeshEnabled: boolean;
  rendezvousConfig: RendezvousMeshConfig;
  controls: P2PControlState;
  enable: () => Promise<void>;
  disable: () => void;
  enableRendezvousMesh: () => void;
  disableRendezvousMesh: () => void;
  setRendezvousMeshEnabled: (value: boolean) => void;
  setControlFlag: (key: keyof P2PControlState, value: boolean) => void;
  announceContent: (manifestHash: string) => void;
  ensureManifest: (
    manifestId: string,
    options?: EnsureManifestOptions
  ) => Promise<Manifest | null>;
  requestChunk: (chunkHash: string) => Promise<Uint8Array | null>;
  isContentAvailable: (manifestHash: string) => boolean;
  broadcastPost: (post: Post) => void;
  getPeerId: () => string | null;
  getDiscoveredPeers: () => DiscoveredPeer[];
  connectToPeer: (peerId: string, options?: { manual?: boolean; source?: string }) => boolean;
  joinRoom: (roomName: string) => void;
  leaveRoom: () => void;
  getCurrentRoom: () => string | null;
  subscribeToStats: (listener: (stats: P2PStats) => void) => () => void;
}

const defaultControls: P2PControlState = {
  autoConnect: true,
  manualAccept: false,
  isolate: false,
  paused: false,
};

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
    // Return a dummy offline state instead of throwing during HMR
    console.warn('useP2PContext: Context not available, returning offline state');
    return {
      isEnabled: false,
      isConnecting: false,
      stats: {
        status: 'offline' as const,
        connectedPeers: 0,
        discoveredPeers: 0,
        localContent: 0,
        networkContent: 0,
        activeRequests: 0,
        rendezvousPeers: 0,
        lastRendezvousSync: null,
        uptimeMs: 0,
        bytesUploaded: 0,
        bytesDownloaded: 0,
        relayCount: 0,
        pingCount: 0
      },
      isRendezvousMeshEnabled: false,
      rendezvousConfig: { beacons: [], capsules: [], community: 'mainnet' },
      controls: defaultControls,
      enable: async () => {},
      disable: () => {},
      enableRendezvousMesh: () => {},
      disableRendezvousMesh: () => {},
      setRendezvousMeshEnabled: () => {},
      setControlFlag: () => {},
      announceContent: () => {},
      ensureManifest: async () => null,
      requestChunk: async () => null,
      isContentAvailable: () => false,
      broadcastPost: () => {},
      getPeerId: () => null,
      getDiscoveredPeers: () => [],
      connectToPeer: () => false,
      joinRoom: () => {},
      leaveRoom: () => {},
      getCurrentRoom: () => null,
      subscribeToStats: () => () => {}
    };
  }
  return context;
}
