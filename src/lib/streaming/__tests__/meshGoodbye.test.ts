import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  startSignalingBridge, stopSignalingBridge, announceJoinRoom, onSignal, onRoomPresenceRemoved,
  isRoomPeerPresent, getNetworkChatPeers,
} from '../webrtcSignalingBridge.standalone';

type Sent = { to: string; payload: Record<string, unknown> };

function makeMesh(id: string, connected: string[]) {
  const sent: Sent[] = [];
  let handler: ((from: string, p: unknown) => void) | null = null;
  let beforeStop: (() => void) | null = null;
  let departed: ((peerId: string, reason: 'goodbye' | 'silent') => void) | null = null;
  const mesh = {
    broadcast: (_c: string, payload: unknown) => { for (const to of connected) sent.push({ to, payload: payload as Record<string, unknown> }); },
    send: async (_c: string, to: string, payload: unknown) => { sent.push({ to, payload: payload as Record<string, unknown> }); return true; },
    onMessage: (c: string, h: (from: string, p: unknown) => void) => { if (c !== 'webrtc-signal') return () => {}; handler = h; return () => { handler = null; }; },
    getConnectedPeerIds: () => connected,
    getPeerId: () => id,
    onBeforeStop: (h: () => void) => { beforeStop = h; return () => { beforeStop = null; }; },
    onPeerDeparted: (h: (peerId: string, reason: 'goodbye' | 'silent') => void) => { departed = h; return () => { departed = null; }; },
  };
  return {
    mesh, sent,
    deliver: (from: string, p: unknown) => handler?.(from, p),
    stopMesh: () => beforeStop?.(),
    depart: (peerId: string, reason: 'goodbye' | 'silent' = 'goodbye') => departed?.(peerId, reason),
  };
}

afterEach(() => stopSignalingBridge());

describe('mesh goodbye reaches rooms, calls and chat', () => {
  it('a peer that says goodbye leaves the room, the call and the chat at once', () => {
    const a = makeMesh('A', ['B']);
    startSignalingBridge(a.mesh);
    announceJoinRoom('brain', 'uA', 'A');
    a.deliver('B', { msgType: 'join-room', from: 'B', roomId: 'brain', ts: 1 });
    a.deliver('B', { msgType: 'chat-here', from: 'B', roomId: 'brain-universe-shared', data: { open: true }, ts: 2 });
    expect(isRoomPeerPresent('brain', 'B')).toBe(true);
    expect(getNetworkChatPeers().map(p => p.peerId)).toContain('B');

    const leaves: string[] = [];
    const removed: string[] = [];
    const offSig = onSignal((e) => { if (e.msgType === 'leave-room') leaves.push(`${e.roomId}:${e.from}`); });
    const offRemoved = onRoomPresenceRemoved((roomId, peerId) => removed.push(`${roomId}:${peerId}`));
    a.depart('B');
    expect(isRoomPeerPresent('brain', 'B')).toBe(false);
    expect(leaves).toContain('brain:B');
    expect(removed).toContain('brain:B');
    expect(getNetworkChatPeers().map(p => p.peerId)).not.toContain('B');
    offSig(); offRemoved();
  });

  it('a peer silent on our direct link but still heard through a relay stays in the room', () => {
    const a = makeMesh('A', ['C']);
    startSignalingBridge(a.mesh);
    announceJoinRoom('brain', 'uA', 'A');
    a.deliver('C', { msgType: 'join-room', from: 'B', roomId: 'brain', ts: 41, hops: 1 });
    const leaves: string[] = [];
    const offSig = onSignal((e) => { if (e.msgType === 'leave-room') leaves.push(e.from); });
    a.depart('B', 'silent');
    expect(leaves).toEqual([]);
    expect(isRoomPeerPresent('brain', 'B')).toBe(true);
    a.depart('B', 'goodbye'); // a real goodbye still removes them
    expect(leaves).toEqual(['B']);
    offSig();
  });

  it('a fresh join after a goodbye brings the peer back', () => {
    const a = makeMesh('A', ['B']);
    startSignalingBridge(a.mesh);
    announceJoinRoom('brain', 'uA', 'A');
    a.deliver('B', { msgType: 'join-room', from: 'B', roomId: 'brain', ts: 21 });
    a.depart('B');
    a.deliver('B', { msgType: 'join-room', from: 'B', roomId: 'brain', ts: Date.now() + 5 });
    expect(isRoomPeerPresent('brain', 'B')).toBe(true);
  });

  it('switching our mesh off tells the room and chat we left, and lets go of everyone locally', () => {
    const a = makeMesh('A', ['B']);
    startSignalingBridge(a.mesh);
    announceJoinRoom('brain', 'uA', 'A');
    a.deliver('B', { msgType: 'join-room', from: 'B', roomId: 'brain', ts: 31 });
    const leaves: string[] = [];
    const offSig = onSignal((e) => { if (e.msgType === 'leave-room') leaves.push(e.from); });
    a.sent.length = 0;
    a.stopMesh();
    const out = a.sent.map(s => s.payload);
    expect(out).toContainEqual(expect.objectContaining({ msgType: 'leave-room', from: 'A', roomId: 'brain' }));
    expect(out).toContainEqual(expect.objectContaining({ msgType: 'chat-here', from: 'A', data: { open: false } }));
    expect(leaves).toContain('B'); // our call layer closes B's call
    expect(isRoomPeerPresent('brain', 'B')).toBe(false);
    // When our mesh returns, B's presence is welcome again (no departure was recorded).
    a.deliver('B', { msgType: 'room-sync', from: 'B', to: 'A', roomId: 'brain', participants: ['A', 'B'], ts: Date.now() });
    expect(isRoomPeerPresent('brain', 'B')).toBe(true);
    offSig();
  });
});
