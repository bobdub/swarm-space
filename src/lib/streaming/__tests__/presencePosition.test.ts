import { describe, it, expect, afterEach } from 'vitest';
import {
  startSignalingBridge,
  stopSignalingBridge,
  announceJoinRoom,
  announceLeaveRoom,
  getRoomPresences,
} from '../webrtcSignalingBridge.standalone';

function makeMesh(id: string, connected: string[]) {
  let handler: ((from: string, p: unknown) => void) | null = null;
  const mesh = {
    broadcast: () => {},
    send: async () => true,
    onMessage: (c: string, h: (from: string, p: unknown) => void) => { if (c !== 'webrtc-signal') return () => {}; handler = h; return () => { handler = null; }; },
    getConnectedPeerIds: () => connected,
    getPeerId: () => id,
  };
  return { mesh, deliver: (from: string, p: unknown) => handler?.(from, p) };
}

afterEach(() => {
  announceLeaveRoom('brain');
  stopSignalingBridge();
});

describe('Brain presence positions', () => {
  it('carries the Earth-local position', () => {
    const a = makeMesh('A', ['B']);
    startSignalingBridge(a.mesh as never);
    announceJoinRoom('brain', 'uA', 'A');
    const t0 = Date.now();
    a.deliver('B', { msgType: 'presence', from: 'B', roomId: 'brain', ts: t0, data: { position: [1, 2, 3], local: [4, 5, 6] } });
    const b = getRoomPresences('brain').find((p) => p.peerId === 'B');
    expect(b?.position).toEqual([1, 2, 3]);
    expect(b?.local).toEqual([4, 5, 6]);
  });

  it('a late relayed copy never moves an avatar back', () => {
    const a = makeMesh('A', ['B', 'C']);
    startSignalingBridge(a.mesh as never);
    announceJoinRoom('brain', 'uA', 'A');
    const t0 = Date.now();
    a.deliver('B', { msgType: 'presence', from: 'B', roomId: 'brain', ts: t0 + 10, data: { local: [9, 9, 9] } });
    a.deliver('C', { msgType: 'presence', from: 'B', roomId: 'brain', ts: t0, data: { local: [1, 1, 1] }, hops: 1 });
    expect(getRoomPresences('brain').find((p) => p.peerId === 'B')?.local).toEqual([9, 9, 9]);
  });
});
