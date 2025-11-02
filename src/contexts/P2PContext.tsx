/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, ReactNode } from 'react';
import type {
  P2PStats,
  EnsureManifestOptions,
  P2PControlState,
  PendingPeer,
  PeerJSEndpoint,
  PeerConnectionDetail,
} from '@/lib/p2p/manager';
import type { RendezvousMeshConfig } from '@/lib/p2p/rendezvousConfig';
import type { Post, Comment } from '@/types';
import type { DiscoveredPeer } from '@/lib/p2p/discovery';
import type { Manifest } from '@/lib/store';
import { useP2P } from '@/hooks/useP2P';
import type { P2PDiagnosticEvent } from '@/lib/p2p/diagnostics';
import type { ConnectionHealthSummary } from '@/lib/p2p/connectionHealth';

interface P2PContextValue {
  isEnabled: boolean;
  isConnecting: boolean;
  stats: P2PStats;
  activeSignalingEndpoint: PeerJSEndpoint | null;
  isRendezvousMeshEnabled: boolean;
  rendezvousDisabledReason: 'capability' | 'failure' | null;
  rendezvousConfig: RendezvousMeshConfig;
  controls: P2PControlState;
  blockedPeers: string[];
  pendingPeers: PendingPeer[];
  enable: () => Promise<void>;
  disable: () => void;
  enableRendezvousMesh: () => void;
  disableRendezvousMesh: () => void;
  setRendezvousMeshEnabled: (value: boolean) => void;
  setControlFlag: (key: keyof P2PControlState, value: boolean) => void;
  blockPeer: (peerId: string) => void;
  unblockPeer: (peerId: string) => void;
  isPeerBlocked: (peerId: string) => boolean;
  announceContent: (manifestHash: string) => void;
  ensureManifest: (
    manifestId: string,
    options?: EnsureManifestOptions
  ) => Promise<Manifest | null>;
  requestChunk: (chunkHash: string) => Promise<Uint8Array | null>;
  isContentAvailable: (manifestHash: string) => boolean;
  broadcastPost: (post: Post) => void;
  broadcastComment: (comment: Comment) => void;
  getPeerId: () => string | null;
  getDiscoveredPeers: () => DiscoveredPeer[];
  connectToPeer: (peerId: string, options?: { manual?: boolean; source?: string }) => boolean;
  disconnectFromPeer: (peerId: string) => void;
  joinRoom: (roomName: string) => void;
  leaveRoom: () => void;
  getCurrentRoom: () => string | null;
  subscribeToStats: (listener: (stats: P2PStats) => void) => () => void;
  approvePendingPeer: (peerId: string) => boolean;
  rejectPendingPeer: (peerId: string) => void;
  getConnectionHealthSummary: () => ConnectionHealthSummary;
  getActivePeerConnections: () => PeerConnectionDetail[];
  refreshPeerRegistry: () => void;
  openNodeDashboard: () => void;
  diagnostics: P2PDiagnosticEvent[];
  clearDiagnostics: () => void;
}

const defaultControls: P2PControlState = {
  autoConnect: true,
  manualAccept: false,
  isolate: false,
  paused: false,
};

const offlineHealthSummary: ConnectionHealthSummary = {
  total: 0,
  healthy: 0,
  degraded: 0,
  stale: 0,
  avgRttMs: 0,
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

function createOfflineState(): P2PContextValue {
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
      pingCount: 0,
      connectionAttempts: 0,
      successfulConnections: 0,
      failedConnectionAttempts: 0,
      rendezvousAttempts: 0,
      rendezvousSuccesses: 0,
      rendezvousFailures: 0,
      rendezvousFailureStreak: 0,
      timeToFirstPeerMs: null,
      lastBeaconLatencyMs: null,
      metrics: {
        uptimeMs: 0,
        bytesUploaded: 0,
        bytesDownloaded: 0,
        relayCount: 0,
        pingCount: 0,
        connectionAttempts: 0,
        successfulConnections: 0,
        failedConnectionAttempts: 0,
        rendezvousAttempts: 0,
        rendezvousSuccesses: 0,
        rendezvousFailures: 0,
      },
      signalingEndpointUrl: null,
      signalingEndpointLabel: null,
      signalingEndpointId: null,
    },
    activeSignalingEndpoint: null,
    isRendezvousMeshEnabled: false,
    rendezvousDisabledReason: null,
    rendezvousConfig: {
      beacons: [],
      capsules: [],
      community: 'mainnet',
      trustedTicketPublicKeys: [],
      trustedCapsulePublicKeys: [],
      announceIntervalMs: 45_000,
      refreshIntervalMs: 120_000,
      ticketTtlMs: 180_000,
      beaconRequestTimeoutMs: 8000,
      beaconRetryLimit: 2,
      beaconRetryBackoffMs: 1000,
      capsuleRequestTimeoutMs: 8000,
      capsuleRetryLimit: 1,
      capsuleRetryBackoffMs: 1000,
      rendezvousFailureThreshold: 3,
    },
    controls: defaultControls,
    blockedPeers: [],
    pendingPeers: [],
    enable: async () => {},
    disable: () => {},
    enableRendezvousMesh: () => {},
    disableRendezvousMesh: () => {},
    setRendezvousMeshEnabled: () => {},
    setControlFlag: () => {},
    blockPeer: () => {},
    unblockPeer: () => {},
    isPeerBlocked: () => false,
    announceContent: () => {},
    ensureManifest: async () => null,
    requestChunk: async () => null,
    isContentAvailable: () => false,
    broadcastPost: () => {},
    broadcastComment: () => {},
    getPeerId: () => null,
    getDiscoveredPeers: () => [],
    connectToPeer: () => false,
    disconnectFromPeer: () => {},
    joinRoom: () => {},
    leaveRoom: () => {},
    getCurrentRoom: () => null,
    subscribeToStats: () => () => {},
    approvePendingPeer: () => false,
    rejectPendingPeer: () => {},
    getConnectionHealthSummary: () => offlineHealthSummary,
    getActivePeerConnections: () => [],
    refreshPeerRegistry: () => {},
    openNodeDashboard: () => {},
    diagnostics: [],
    clearDiagnostics: () => {},
  };
}

export function useP2PContext() {
  const context = useContext(P2PContext);
  if (!context) {
    // Return a dummy offline state instead of throwing during HMR
    console.warn('useP2PContext: Context not available, returning offline state');
    return createOfflineState();
  }
  return context;
}
