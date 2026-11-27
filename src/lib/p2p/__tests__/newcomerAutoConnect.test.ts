import { describe, expect, it, vi } from 'vitest';

const meshStats = { phase: 'online', connectedPeers: 2 };
vi.mock('../swarmMesh.standalone', () => ({
  getSwarmMeshStandalone: () => ({
    getStats: () => meshStats,
    getPeerId: () => 'peer-helper',
    getMiningStats: () => null,
    isAutoConnectEnabled: () => false,
    getConnectedPeers: () => [],
  }),
}));

import {
  getGlobalCell,
  shouldKnockBack,
  shouldLocalDial,
  KNOCK_BACK_MIN_INTERVAL_MS,
  NEWCOMER_RESCUE_GRACE_MS,
  GLOBAL_CELL_STALE_THRESHOLD,
} from '../globalCell';

describe('dial arbitration for isolated newcomers', () => {
  it('a connected peer that is not on helper duty stays passive', () => {
    expect(shouldLocalDial(3, 0, 'peer-a', 'peer-z')).toBe(false);
    expect(shouldLocalDial(3, 0, 'peer-a', 'peer-z', { helperOnDuty: false, remoteWaitMs: 60_000 })).toBe(false);
  });

  it('a helper on duty gives the newcomer a grace window to dial first', () => {
    expect(shouldLocalDial(1, 0, 'peer-z', 'peer-a', { helperOnDuty: true, remoteWaitMs: NEWCOMER_RESCUE_GRACE_MS - 1 })).toBe(false);
  });

  it('a helper on duty dials a newcomer that has waited past the grace window', () => {
    expect(shouldLocalDial(1, 0, 'peer-z', 'peer-a', { helperOnDuty: true, remoteWaitMs: NEWCOMER_RESCUE_GRACE_MS })).toBe(true);
  });

  it('the newcomer still dials connected peers, and ties fall back to peerId order', () => {
    expect(shouldLocalDial(0, 2, 'peer-z', 'peer-a')).toBe(true);
    expect(shouldLocalDial(0, 0, 'peer-a', 'peer-z')).toBe(true);
    expect(shouldLocalDial(0, 0, 'peer-z', 'peer-a')).toBe(false);
  });
});

describe('knock-back beacon', () => {
  const now = 1_000_000;
  it('answers a fresh unknown peer when this node is connected', () => {
    expect(shouldKnockBack(true, now - 1_000, 1, now - KNOCK_BACK_MIN_INTERVAL_MS, now)).toBe(true);
  });

  it('stays quiet for known peers, isolated nodes, replayed history and inside the throttle', () => {
    expect(shouldKnockBack(false, now, 1, 0, now)).toBe(false);
    expect(shouldKnockBack(true, now, 0, 0, now)).toBe(false);
    expect(shouldKnockBack(true, now - GLOBAL_CELL_STALE_THRESHOLD - 1, 1, 0, now)).toBe(false);
    expect(shouldKnockBack(true, now, 1, now - KNOCK_BACK_MIN_INTERVAL_MS + 1, now)).toBe(false);
  });

  it('publishes our presence once when a newcomer appears, not on its later beacons', () => {
    const cell = getGlobalCell() as unknown as {
      running: boolean;
      lastBeaconAt: number;
      gunAdapter: { broadcastToAll: ReturnType<typeof vi.fn> } | null;
      recordPresence: (b: { peerId: string; trustScore: number; ts: number; conns: number }) => void;
    };
    const broadcastToAll = vi.fn(() => true);
    cell.running = true;
    cell.lastBeaconAt = 0;
    cell.gunAdapter = { broadcastToAll };
    cell.recordPresence({ peerId: 'peer-newcomer', trustScore: 0.3, ts: Date.now(), conns: 0 });
    cell.lastBeaconAt = 0;
    cell.recordPresence({ peerId: 'peer-newcomer', trustScore: 0.3, ts: Date.now() + 1, conns: 0 });
    const presence = broadcastToAll.mock.calls.filter(c => c[0] === 'presence');
    expect(presence).toHaveLength(1);
    expect((presence[0][1] as { peerId: string }).peerId).toBe('peer-helper');
    cell.running = false;
  });
});
