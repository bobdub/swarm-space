import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  startSignalingBridge,
  stopSignalingBridge,
  announceJoinRoom,
  announceLeaveRoom,
  onSignal,
  handleMeshPeerDeparted,
  isRoomPeerPresent,
  registerCallLivenessProbe,
  sweepGoneRoomPeers,
  ROOM_PEER_GONE_MS,
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
  registerCallLivenessProbe(null);
  announceLeaveRoom('brain');
  stopSignalingBridge();
  vi.useRealTimers();
});

describe('Brain room membership', () => {
  it('never drops a quiet peer whose call is live, however long the silence', () => {
    vi.useFakeTimers();
    registerCallLivenessProbe((peerId) => peerId === 'B');
    const a = makeMesh('A', ['B']);
    startSignalingBridge(a.mesh as never);
    announceJoinRoom('brain', 'uA', 'A');
    const seen: SignalEnvelope[] = [];
    const off = onSignal((e) => seen.push(e));
    a.deliver('B', { msgType: 'join-room', from: 'B', roomId: 'brain', ts: Date.now() });
    // Ten minutes of room sweeps with no heartbeat from B.
    vi.advanceTimersByTime(10 * 60_000);
    sweepGoneRoomPeers();
    expect(isRoomPeerPresent('brain', 'B')).toBe(true);
    expect(seen.some((e) => e.msgType === 'leave-room' && e.from === 'B')).toBe(false);
    off();
  });

  it('drops a peer that is silent and has no live call, and their next packet brings them back', () => {
    vi.useFakeTimers();
    registerCallLivenessProbe(() => false);
    const a = makeMesh('A', ['B']);
    startSignalingBridge(a.mesh as never);
    announceJoinRoom('brain', 'uA', 'A');
    const seen: SignalEnvelope[] = [];
    const off = onSignal((e) => seen.push(e));
    a.deliver('B', { msgType: 'join-room', from: 'B', roomId: 'brain', ts: Date.now() });

    // Still heard recently enough: kept.
    vi.advanceTimersByTime(ROOM_PEER_GONE_MS - 10_000);
    sweepGoneRoomPeers();
    expect(isRoomPeerPresent('brain', 'B')).toBe(true);

    vi.advanceTimersByTime(20_000);
    sweepGoneRoomPeers();
    expect(isRoomPeerPresent('brain', 'B')).toBe(false);
    const leave = seen.find((e) => e.msgType === 'leave-room' && e.from === 'B');
    expect(leave?.data).toEqual({ reason: 'gone' });

    seen.length = 0;
    a.deliver('B', { msgType: 'room-heartbeat', from: 'B', roomId: 'brain', ts: Date.now() });
    expect(seen.some((e) => e.msgType === 'join-room' && e.from === 'B')).toBe(true);
    expect(isRoomPeerPresent('brain', 'B')).toBe(true);
    off();
  });

  it('keeps a peer whose call failed while their room heartbeats still arrive', () => {
    vi.useFakeTimers();
    registerCallLivenessProbe(() => false);
    const a = makeMesh('A', ['B']);
    startSignalingBridge(a.mesh as never);
    announceJoinRoom('brain', 'uA', 'A');
    a.deliver('B', { msgType: 'join-room', from: 'B', roomId: 'brain', ts: Date.now() });
    for (let i = 0; i < 10; i++) {
      // A throttled background tab: one heartbeat a minute.
      vi.advanceTimersByTime(60_000);
      sweepGoneRoomPeers();
      a.deliver('B', { msgType: 'room-heartbeat', from: 'B', roomId: 'brain', ts: Date.now() });
    }
    expect(isRoomPeerPresent('brain', 'B')).toBe(true);
  });

  it('a ghost named only in a room-sync is dropped and not relisted by the next room-sync', () => {
    vi.useFakeTimers();
    registerCallLivenessProbe(() => false);
    const a = makeMesh('A', ['B']);
    startSignalingBridge(a.mesh as never);
    announceJoinRoom('brain', 'uA', 'A');
    const seen: SignalEnvelope[] = [];
    const off = onSignal((e) => seen.push(e));
    // B still lists X, a peer that died without saying goodbye.
    a.deliver('B', { msgType: 'room-sync', from: 'B', to: 'A', roomId: 'brain', participants: ['A', 'B', 'X'], ts: Date.now() });
    expect(isRoomPeerPresent('brain', 'X')).toBe(true);

    // B keeps heartbeating; X never says anything.
    for (let t = 0; t < ROOM_PEER_GONE_MS + 30_000; t += 7_000) {
      vi.advanceTimersByTime(7_000);
      a.deliver('B', { msgType: 'room-heartbeat', from: 'B', roomId: 'brain', ts: Date.now() });
      sweepGoneRoomPeers();
    }
    expect(isRoomPeerPresent('brain', 'X')).toBe(false);
    expect(isRoomPeerPresent('brain', 'B')).toBe(true);
    expect(seen.find((e) => e.msgType === 'leave-room' && e.from === 'X')?.data).toEqual({ reason: 'gone' });

    // B's stale list does not bring X back.
    seen.length = 0;
    a.deliver('B', { msgType: 'room-sync', from: 'B', to: 'A', roomId: 'brain', participants: ['A', 'B', 'X'], ts: Date.now() });
    expect(isRoomPeerPresent('brain', 'X')).toBe(false);
    const sync = seen.find((e) => e.msgType === 'room-sync');
    expect(sync?.participants).not.toContain('X');
    off();
  });

  it('sweeping right after a fresh room-sync never drops the listed peers', () => {
    registerCallLivenessProbe(() => false);
    const a = makeMesh('A', ['B']);
    startSignalingBridge(a.mesh as never);
    announceJoinRoom('brain', 'uA', 'A');
    a.deliver('B', { msgType: 'room-sync', from: 'B', to: 'A', roomId: 'brain', participants: ['A', 'B', 'C'], ts: Date.now() });
    sweepGoneRoomPeers(Date.now() + 1_000);
    expect(isRoomPeerPresent('brain', 'C')).toBe(true);
  });

  it('a peer the mesh reported silent comes back on its next heartbeat', () => {
    const a = makeMesh('A', ['B']);
    startSignalingBridge(a.mesh as never);
    announceJoinRoom('brain', 'uA', 'A');
    const seen: SignalEnvelope[] = [];
    const off = onSignal((e) => seen.push(e));
    const t0 = Date.now();
    a.deliver('B', { msgType: 'join-room', from: 'B', roomId: 'brain', ts: t0 });
    expect(isRoomPeerPresent('brain', 'B')).toBe(true);

    handleMeshPeerDeparted('B', 'silent');
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
