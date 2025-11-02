// @ts-expect-error - bun:test types not available in TypeScript
import { describe, expect, it } from 'bun:test';
import type { ConnectionHealthSummary } from '@/lib/p2p/connectionHealth';
import type {
  NodeDashboardSource,
  NodeDashboardSnapshot,
} from '@/hooks/useNodeDashboard';
import { buildNodeDashboardSnapshot } from '@/hooks/useNodeDashboard';
import type {
  P2PStats,
  P2PControlState,
  PendingPeer,
  PeerConnectionDetail,
} from '@/lib/p2p/manager';
import type { DiscoveredPeer } from '@/lib/p2p/discovery';

const createStats = (overrides: Partial<P2PStats> = {}): P2PStats => ({
  status: 'offline',
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
  transportFallbacks: 0,
  lastTransportFallbackAt: null,
  transports: [],
  ...overrides,
});

const defaultControls: P2PControlState = {
  autoConnect: true,
  manualAccept: false,
  isolate: false,
  paused: false,
  pauseInbound: false,
  pauseOutbound: false,
};

const emptySummary: ConnectionHealthSummary = {
  total: 0,
  healthy: 0,
  degraded: 0,
  stale: 0,
  avgRttMs: 0,
  avgPacketLoss: 0,
  handshakeConfidence: 0,
};

const buildSource = (overrides: Partial<NodeDashboardSource> = {}): NodeDashboardSource => ({
  stats: createStats(),
  isEnabled: false,
  isConnecting: false,
  isRendezvousMeshEnabled: false,
  rendezvousDisabledReason: null,
  controls: defaultControls,
  controlResumes: {},
  blockedPeers: [],
  blocklist: [],
  pendingPeers: [] as PendingPeer[],
  discoveredPeers: [] as DiscoveredPeer[],
  peerId: null,
  connectionSummary: emptySummary,
  connections: [] as PeerConnectionDetail[],
  diagnostics: [],
  ...overrides,
});

describe('buildNodeDashboardSnapshot', () => {
  it('returns safe defaults when mesh routing is paused', () => {
    const source = buildSource({
      isRendezvousMeshEnabled: false,
      rendezvousDisabledReason: 'failure',
    });

    const snapshot = buildNodeDashboardSnapshot(source);

    expect(snapshot.rendezvous.enabled).toBe(false);
    expect(snapshot.rendezvous.disabledReason).toBe('failure');
    expect(snapshot.connectionHealth.summary.total).toBe(0);
    expect(snapshot.connectionHealth.lastHandshakeAt).toBeNull();
    expect(snapshot.metrics.failureRate).toBe(0);
    expect(snapshot.metrics.avgPacketLoss).toBe(0);
    expect(snapshot.metrics.bandwidthKbps).toBe(0);
    expect(snapshot.metrics.timeToFirstPeerMs).toBeNull();
  });

  it('handles diagnostics being unavailable and calculates handshake recency', () => {
    const now = Date.now();
    const summary: ConnectionHealthSummary = {
      total: 2,
      healthy: 1,
      degraded: 1,
      stale: 0,
      avgRttMs: 42.5,
      avgPacketLoss: 0,
      handshakeConfidence: 0.5,
    };
    const connections: PeerConnectionDetail[] = [
      {
        peerId: 'peer-a',
        userId: 'user-a',
        profile: undefined,
        status: 'healthy',
        connectedAt: now - 1_000,
        lastActivity: now - 500,
        avgRttMs: 40,
        lastSeenAt: now - 400,
      },
      {
        peerId: 'peer-b',
        userId: 'user-b',
        profile: undefined,
        status: 'degraded',
        connectedAt: now - 5_000,
        lastActivity: null,
        avgRttMs: 45,
        lastSeenAt: now - 4_500,
      },
    ];

    const source = buildSource({
      stats: createStats({
        status: 'online',
        connectionAttempts: 10,
        failedConnectionAttempts: 2,
        rendezvousAttempts: 4,
        rendezvousSuccesses: 3,
        rendezvousPeers: 3,
        lastRendezvousSync: now - 2_000,
      }),
      connectionSummary: summary,
      connections,
      diagnostics: [],
    });

    const snapshot: NodeDashboardSnapshot = buildNodeDashboardSnapshot(source);

    expect(snapshot.diagnostics).toHaveLength(0);
    expect(snapshot.connectionHealth.summary.avgRttMs).toBeCloseTo(42.5);
    expect(snapshot.connectionHealth.lastHandshakeAt).toBe(connections[0].lastActivity);
    expect(snapshot.connectionHealth.strength).toBeCloseTo(0.5);
    expect(snapshot.metrics.failureRate).toBeCloseTo(0.2);
    expect(snapshot.metrics.rendezvousSuccessRate).toBeCloseTo(0.75);
    expect(snapshot.metrics.avgPacketLoss).toBe(0);
    expect(snapshot.metrics.handshakeConfidence).toBeCloseTo(0.5);
    expect(snapshot.connectionHealth.packetLoss).toBe(0);
    expect(snapshot.connectionHealth.handshakeConfidence).toBeCloseTo(0.5);
  });
});
