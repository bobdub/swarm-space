import { describe, it, expect, afterEach } from 'vitest';
import { startSignalingBridge, stopSignalingBridge, announceJoinRoom } from '../webrtcSignalingBridge.standalone';

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
    onMessage: (_c: string, h: (from: string, p: unknown) => void) => { handler = h; return () => { handler = null; }; },
    getConnectedPeerIds: () => connected,
    getPeerId: () => id,
  };
  return { mesh, sent, deliver: (from: string, p: unknown) => handler?.(from, p) };
}

afterEach(() => stopSignalingBridge());

describe('room signal relay (A - B - C)', () => {
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
