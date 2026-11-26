import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { startSignalingBridge, stopSignalingBridge, announceJoinRoom, announceLeaveRoom } from '../webrtcSignalingBridge.standalone';

type Sent = { to: string; payload: Record<string, unknown> };

function makeMesh(id: string, connected: string[]) {
  const sent: Sent[] = [];
  let handler: ((from: string, p: unknown) => void) | null = null;
  const mesh = {
    broadcast: (_c: string, payload: unknown) => { for (const to of connected) sent.push({ to, payload: payload as Record<string, unknown> }); },
    send: async (_c: string, to: string, payload: unknown) => {
      if (!connected.includes(to)) return false;
      sent.push({ to, payload: payload as Record<string, unknown> });
      return true;
    },
    onMessage: (c: string, h: (from: string, p: unknown) => void) => { if (c !== 'webrtc-signal') return () => {}; handler = h; return () => { handler = null; }; },
    getConnectedPeerIds: () => connected,
    getPeerId: () => id,
  };
  return { mesh, sent, deliver: (from: string, p: unknown) => handler?.(from, p) };
}

afterEach(() => stopSignalingBridge());

describe('room signal relay (A - B - C)', () => {
  it.each(['join-room', 'room-hello', 'presence'])('registers a relayed %s contact through the shared durable handoff', (msgType) => {
    const b = makeMesh('B', ['A']);
    const registerPeerConnection = vi.fn(() => true);
    startSignalingBridge({ ...b.mesh, registerPeerConnection });
    announceJoinRoom('handoff', 'uB', 'B');
    b.deliver('A', { msgType, from: 'C', roomId: 'handoff', data: {}, ts: 100 });
    b.deliver('A', { msgType, from: 'C', roomId: 'handoff', data: {}, ts: 101 });
    expect(registerPeerConnection.mock.calls).toEqual([['C']]);
    announceLeaveRoom('handoff');
  });
  it('bus-dials missing room peers from a sync once, never the manual path', () => {
    const b = makeMesh('B', ['A']);
    const dialViaBus = vi.fn(() => true);
    startSignalingBridge({ ...b.mesh, dialViaBus });
    announceJoinRoom('r', 'uB', 'B');
    b.deliver('A', { msgType: 'room-sync', from: 'A', to: 'B', roomId: 'r', participants: ['A', 'B', 'C'], ts: 100 });
    b.deliver('A', { msgType: 'room-sync', from: 'A', to: 'B', roomId: 'r', participants: ['A', 'B', 'C'], ts: 101 });
    expect(dialViaBus.mock.calls).toEqual([['C']]);
  });
  it('B relays an offer addressed to C that came from A', async () => {
    const b = makeMesh('B', ['A', 'C']);
    startSignalingBridge(b.mesh as never);
    b.deliver('A', { msgType: 'offer', from: 'A', to: 'C', roomId: 'r', data: {}, ts: 1 });
    await Promise.resolve();
    expect(b.sent.some((s) => s.to === 'C' && s.payload.msgType === 'offer' && s.payload.hops === 1)).toBe(true);
  });

  it('B forwards a join-room from C to A once, and stops at the hop limit', async () => {
    const b = makeMesh('B', ['A', 'C']);
    startSignalingBridge(b.mesh as never);
    announceJoinRoom('r', 'uB', 'B');
    b.sent.length = 0;
    const join = { msgType: 'join-room', from: 'C', roomId: 'r', ts: 5 };
    b.deliver('C', join);
    b.deliver('C', join); // duplicate is ignored
    await Promise.resolve();
    const toA = b.sent.filter((s) => s.to === 'A' && s.payload.msgType === 'join-room');
    expect(toA).toHaveLength(1);
    b.sent.length = 0;
    b.deliver('C', { msgType: 'join-room', from: 'X', roomId: 'r', ts: 6, hops: 2 });
    await Promise.resolve();
    expect(b.sent.filter((s) => s.payload.msgType === 'join-room' && s.payload.from === 'X')).toHaveLength(0);
  });
});

describe('directed signals without a direct mesh edge', () => {
  it('B sends its offer for C through A when B and C share no edge', async () => {
    const { sendSignalViaMesh } = await import('../webrtcSignalingBridge.standalone');
    const b = makeMesh('B', ['A']); // B is linked to A only
    startSignalingBridge(b.mesh as never);
    sendSignalViaMesh('C', 'r', 'offer', { type: 'offer', sdp: 'x' });
    await Promise.resolve();
    await Promise.resolve();
    const viaA = b.sent.filter((s) => s.to === 'A' && s.payload.msgType === 'offer' && s.payload.to === 'C');
    expect(viaA).toHaveLength(1);
  });

  it('falls back to neighbours when the direct send reports failure', async () => {
    const { sendReconnectRequest } = await import('../webrtcSignalingBridge.standalone');
    const b = makeMesh('B', ['A', 'C']);
    b.mesh.send = async (_c: string, to: string, payload: unknown) => {
      if (to === 'C') return false; // edge just dropped
      b.sent.push({ to, payload: payload as Record<string, unknown> });
      return true;
    };
    startSignalingBridge(b.mesh as never);
    sendReconnectRequest('C', 'r', 'reconnect-request');
    await new Promise((r) => setTimeout(r, 0));
    expect(b.sent.some((s) => s.to === 'A' && s.payload.msgType === 'reconnect-request')).toBe(true);
  });

  it('A relays B\'s offer to C, and C acts on it once', async () => {
    const a = makeMesh('A', ['B', 'C']);
    startSignalingBridge(a.mesh as never);
    a.deliver('B', { msgType: 'offer', from: 'B', to: 'C', roomId: 'r', data: {}, ts: 9 });
    await Promise.resolve();
    expect(a.sent.filter((s) => s.to === 'C' && s.payload.msgType === 'offer')).toHaveLength(1);
  });
});

describe('newcomer reachable only through a node outside the room', () => {
  beforeEach(() => announceLeaveRoom('r')); // forget rooms joined by earlier tests
  it('a non-member forwards a first-hop join-room and room-hello', async () => {
    const x = makeMesh('X', ['A', 'C']); // X never joins the room
    startSignalingBridge(x.mesh as never);
    x.deliver('C', { msgType: 'join-room', from: 'C', roomId: 'r', ts: 20 });
    x.deliver('C', { msgType: 'room-hello', from: 'C', roomId: 'r', ts: 21 });
    await Promise.resolve();
    expect(x.sent.filter((s) => s.to === 'A' && s.payload.from === 'C').map((s) => s.payload.msgType).sort())
      .toEqual(['join-room', 'room-hello']);
  });

  it('a non-member does not forward announcements that already hopped', async () => {
    const x = makeMesh('X', ['A', 'C']);
    startSignalingBridge(x.mesh as never);
    x.deliver('C', { msgType: 'presence', from: 'Q', roomId: 'r', ts: 22, hops: 1, data: {} });
    await Promise.resolve();
    expect(x.sent.filter((s) => s.to === 'A')).toHaveLength(0);
  });
});

describe('relay edges (stalled same-Wi-Fi dial)', () => {
  function relayMesh(id: string, connected: string[], relayed: string[]) {
    const sent: Sent[] = [];
    let handler: ((from: string, p: unknown) => void) | null = null;
    const reach = [...connected, ...relayed];
    const mesh = {
      broadcast: () => {},
      send: async (_c: string, to: string, payload: unknown) => {
        if (!reach.includes(to)) return false;
        sent.push({ to, payload: payload as Record<string, unknown> });
        return true;
      },
      onMessage: (c: string, h: (from: string, p: unknown) => void) => { if (c !== 'webrtc-signal') return () => {}; handler = h; return () => { handler = null; }; },
      getConnectedPeerIds: () => connected,
      getRelayedPeerIds: () => relayed,
      getPeerId: () => id,
    };
    return { mesh, sent, deliver: (from: string, p: unknown) => handler?.(from, p) };
  }

  it('B forwards A’s room chat to C, whom it reaches only over the relay', async () => {
    const b = relayMesh('B', ['A'], ['C']);
    startSignalingBridge(b.mesh as never);
    announceJoinRoom('r', 'uB', 'B');
    b.sent.length = 0;
    b.deliver('A', { msgType: 'chat-message', from: 'A', roomId: 'r', data: { id: 'm1', text: 'hi' }, ts: 9 });
    await Promise.resolve();
    expect(b.sent.some((s) => s.to === 'C' && s.payload.msgType === 'chat-message' && s.payload.hops === 1)).toBe(true);
    announceLeaveRoom('r');
  });

  it('B passes a directed room-sync from A on to relayed C', async () => {
    const b = relayMesh('B', ['A'], ['C']);
    startSignalingBridge(b.mesh as never);
    b.deliver('A', { msgType: 'room-sync', from: 'A', to: 'C', roomId: 'r', participants: ['A', 'C'], ts: 10 });
    await Promise.resolve();
    expect(b.sent.some((s) => s.to === 'C' && s.payload.msgType === 'room-sync')).toBe(true);
  });
});
