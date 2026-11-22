import { describe, it, expect, afterEach } from 'vitest';
import {
  startSignalingBridge,
  stopSignalingBridge,
  announceJoinRoom,
  announceLeaveRoom,
  onSignal,
  sweepSilentRoomPeers,
  isRoomPeerPresent,
  ROOM_PEER_SILENCE_MS,
  type SignalEnvelope,
} from '../webrtcSignalingBridge.standalone';

type Sent = { to: string; payload: Record<string, unknown> };

function makeMesh(id: string, connected: string[]) {
  const sent: Sent[] = [];
  let handler: ((from: string, p: unknown) => void) | null = null;
  const mesh = {
    broadcast: (_c: string, payload: unknown) => { for (const to of connected) sent.push({ to, payload: payload as Record<string, unknown> }); },
    send: async (_c: string, to: string, payload: unknown) => {
      sent.push({ to, payload: payload as Record<string, unknown> });
      return true;
    },
    onMessage: (c: string, h: (from: string, p: unknown) => void) => { if (c !== 'webrtc-signal') return () => {}; handler = h; return () => { handler = null; }; },
    getConnectedPeerIds: () => connected,
    getPeerId: () => id,
  };
  return { mesh, sent, deliver: (from: string, p: unknown) => handler?.(from, p) };
}

afterEach(() => {
  announceLeaveRoom('brain');
  stopSignalingBridge();
});

describe('Brain room membership', () => {
  it('allows a full minute of missed room heartbeats before soft eviction', () => {
    const a = makeMesh('A', ['B']);
    startSignalingBridge(a.mesh as never);
    announceJoinRoom('brain', 'uA', 'A');
    const t0 = Date.now();
    a.deliver('B', { msgType: 'join-room', from: 'B', roomId: 'brain', ts: t0 });
    expect(ROOM_PEER_SILENCE_MS).toBe(60_000);
    sweepSilentRoomPeers(t0 + 59_999);
    expect(isRoomPeerPresent('brain', 'B', t0 + 59_999)).toBe(true);
    sweepSilentRoomPeers(t0 + 60_001);
    expect(isRoomPeerPresent('brain', 'B', t0 + 60_001)).toBe(false);
  });
  it('a peer evicted for silence comes back on its next heartbeat', () => {
    const a = makeMesh('A', ['B']);
    startSignalingBridge(a.mesh as never);
    announceJoinRoom('brain', 'uA', 'A');
    const seen: SignalEnvelope[] = [];
    const off = onSignal((e) => seen.push(e));
    const t0 = Date.now();
    a.deliver('B', { msgType: 'join-room', from: 'B', roomId: 'brain', ts: t0 });
    expect(isRoomPeerPresent('brain', 'B')).toBe(true);

    sweepSilentRoomPeers(Date.now() + ROOM_PEER_SILENCE_MS + 1);
    const leave = seen.find((e) => e.msgType === 'leave-room');
    expect(leave?.data).toEqual({ reason: 'silent' });
    expect(isRoomPeerPresent('brain', 'B')).toBe(false);

    seen.length = 0;
    a.deliver('B', { msgType: 'room-heartbeat', from: 'B', roomId: 'brain', ts: t0 + 30_000 });
    expect(seen.some((e) => e.msgType === 'join-room' && e.from === 'B')).toBe(true);
    expect(isRoomPeerPresent('brain', 'B')).toBe(true);
    off();
  });

  it('a peer that really left is not revived by a stale echo', () => {
    const a = makeMesh('A', ['B']);
    startSignalingBridge(a.mesh as never);
    announceJoinRoom('brain', 'uA', 'A');
    const t0 = Date.now();
    a.deliver('B', { msgType: 'join-room', from: 'B', roomId: 'brain', ts: t0 });
    a.deliver('B', { msgType: 'leave-room', from: 'B', roomId: 'brain', ts: t0 + 1 });
    const seen: SignalEnvelope[] = [];
    const off = onSignal((e) => seen.push(e));
    a.deliver('B', { msgType: 'room-heartbeat', from: 'B', roomId: 'brain', ts: t0 + 2 });
    expect(seen).toHaveLength(0);
    expect(isRoomPeerPresent('brain', 'B')).toBe(false);
    off();
  });

  it('announces a room joined before the mesh bridge was up', () => {
    announceJoinRoom('brain', 'uA', 'A'); // no bridge yet: used to be lost
    const a = makeMesh('A', ['B', 'C']);
    startSignalingBridge(a.mesh as never);
    const joins = a.sent.filter((s) => s.payload.msgType === 'join-room');
    expect(joins.map((s) => s.to).sort()).toEqual(['B', 'C']);
    expect(a.sent.some((s) => s.payload.msgType === 'room-hello')).toBe(true);
  });

  it('re-announces the room after the bridge restarts', () => {
    const a = makeMesh('A', ['B']);
    startSignalingBridge(a.mesh as never);
    announceJoinRoom('brain', 'uA', 'A');
    stopSignalingBridge();
    const b = makeMesh('A', ['B']);
    startSignalingBridge(b.mesh as never);
    expect(b.sent.some((s) => s.payload.msgType === 'join-room' && s.payload.roomId === 'brain')).toBe(true);
  });
});
