import { afterEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { DiscoveredPeer } from "@/lib/p2p/discovery";
import type { P2PStats } from "@/lib/p2p/manager";
import type { RendezvousMeshConfig } from "@/lib/p2p/rendezvousConfig";
import type { P2PControlState, PendingPeer } from "@/lib/p2p/manager";
import React from "react";

const baseRendezvousConfig: RendezvousMeshConfig = {
  beacons: [],
  capsules: [],
  community: "mainnet",
  trustedTicketPublicKeys: [],
  trustedCapsulePublicKeys: [],
  announceIntervalMs: 45_000,
  refreshIntervalMs: 120_000,
  ticketTtlMs: 180_000,
};

const baseControls: P2PControlState = {
  autoConnect: true,
  manualAccept: false,
  isolate: false,
  paused: false,
};

function createBaseStats(overrides: Partial<P2PStats> = {}): P2PStats {
  return {
    status: "offline",
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
    ...overrides,
  };
}

type ContextValue = {
  isEnabled: boolean;
  isConnecting: boolean;
  stats: P2PStats;
  isRendezvousMeshEnabled: boolean;
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
  ensureManifest: (manifestId: string) => Promise<null>;
  requestChunk: (chunkHash: string) => Promise<null>;
  isContentAvailable: (manifestHash: string) => boolean;
  broadcastPost: () => void;
  broadcastComment: () => void;
  getPeerId: () => string | null;
  getDiscoveredPeers: () => DiscoveredPeer[];
  connectToPeer: (peerId: string) => boolean;
  disconnectFromPeer: (peerId: string) => void;
  joinRoom: (roomName: string) => void;
  leaveRoom: () => void;
  getCurrentRoom: () => string | null;
  subscribeToStats: (listener: (stats: P2PStats) => void) => () => void;
  approvePendingPeer: (peerId: string) => boolean;
  rejectPendingPeer: (peerId: string) => void;
};

function createContextValue(
  peers: DiscoveredPeer[],
  statsOverrides: Partial<P2PStats> = {}
): ContextValue {
  const stats = createBaseStats({
    discoveredPeers: peers.length,
    ...statsOverrides,
  });

  return {
    isEnabled: true,
    isConnecting: false,
    stats,
    isRendezvousMeshEnabled: false,
    rendezvousConfig: baseRendezvousConfig,
    controls: baseControls,
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
    getPeerId: () => "local-peer",
    getDiscoveredPeers: () => peers,
    connectToPeer: () => false,
    disconnectFromPeer: () => {},
    joinRoom: () => {},
    leaveRoom: () => {},
    getCurrentRoom: () => null,
    subscribeToStats: () => () => {},
    approvePendingPeer: () => false,
    rejectPendingPeer: () => {},
  };
}

function setContext(peers: DiscoveredPeer[], statsOverrides: Partial<P2PStats> = {}) {
  contextValue = createContextValue(peers, statsOverrides);
}

let contextValue: ContextValue = createContextValue([], {});

mock.module("@/contexts/P2PContext", () => ({
  useP2PContext: () => contextValue,
}));

const { ConnectedPeersPanel } = await import("@/components/ConnectedPeersPanel");

const originalDateNow = Date.now;

afterEach(() => {
  Date.now = originalDateNow;
});

describe("ConnectedPeersPanel", () => {
  test("renders enriched metadata when peer profiles are available", () => {
    const now = Date.UTC(2024, 0, 1, 12, 0, 0);
    Date.now = () => now;

    const peers: DiscoveredPeer[] = [
      {
        peerId: "peer-a",
        userId: "user-a",
        availableContent: new Set(["file-1", "file-2"]),
        discoveredAt: new Date(now - 60_000),
        lastSeen: new Date(now - 5_000),
        profile: {
          displayName: "Alice Doe",
          username: "alice",
          avatarRef: "avatar-1",
        },
      },
    ];

    setContext(peers, {
      status: "online",
      connectedPeers: 1,
      networkContent: 8,
      localContent: 3,
    });

    const html = renderToStaticMarkup(<ConnectedPeersPanel />);

    expect(html).toContain("Alice Doe");
    expect(html).toContain("@alice");
    expect(html).toContain("Online now");
    expect(html).toContain("2 items");
  });

  test("gracefully falls back to peer identifiers when metadata is missing", () => {
    const now = Date.UTC(2024, 0, 1, 12, 0, 0);
    Date.now = () => now;

    const peers: DiscoveredPeer[] = [
      {
        peerId: "peer-b",
        userId: "user-b-1234",
        availableContent: new Set<string>(),
        discoveredAt: new Date(now - 120_000),
        lastSeen: new Date(now - 5 * 60 * 1000),
      },
    ];

    setContext(peers, {
      status: "waiting",
      connectedPeers: 0,
    });

    const html = renderToStaticMarkup(<ConnectedPeersPanel />);

    expect(html).toContain("user-b-1234");
    expect(html).toContain("Seen 5 minutes ago");
    expect(html).toContain("0 items");
  });
});
