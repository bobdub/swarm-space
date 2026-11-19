import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { BRAIN_ROOM_ID } from '@/lib/chat/networkChatRoom';

// A fresh bridge per test: room membership and departures are module state.
let bridge: typeof import('../webrtcSignalingBridge.standalone');
const startSignalingBridge = (m: never) => bridge.startSignalingBridge(m);
const stopSignalingBridge = () => bridge?.stopSignalingBridge();
const announceJoinRoom = (r: string, u: string, n: string) => bridge.announceJoinRoom(r, u, n);
const getRoomChatMessages = (r: string) => bridge.getRoomChatMessages(r);

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

function chat(from: string, roomId: string, text: string, ts: number, hops = 0) {
  return { msgType: 'chat-message', from, roomId, userId: `u${from}`, username: from, data: { id: `${from}-${ts}`, text, ts }, ts, hops };
}

beforeEach(async () => {
  try { window.localStorage.clear(); } catch { /* ignore */ }
  vi.resetModules();
  bridge = await import('../webrtcSignalingBridge.standalone');
});
afterEach(() => stopSignalingBridge());

describe('network chat outside the Brain', () => {
  it('a peer in the Brain hears someone who never entered it', () => {
    const b = makeMesh('B', ['A']);
    startSignalingBridge(b.mesh as never);
    announceJoinRoom(BRAIN_ROOM_ID, 'uB', 'B');
    b.deliver('A', chat('A', BRAIN_ROOM_ID, 'hi from Explore', 10));
    expect(getRoomChatMessages(BRAIN_ROOM_ID).map((m) => m.text)).toEqual(['hi from Explore']);
  });

  it('keeps hearing someone who walked out of the Brain to Explore', () => {
    const b = makeMesh('B', ['A']);
    startSignalingBridge(b.mesh as never);
    announceJoinRoom(BRAIN_ROOM_ID, 'uB', 'B');
    b.deliver('A', { msgType: 'join-room', from: 'A', roomId: BRAIN_ROOM_ID, ts: 1 });
    b.deliver('A', { msgType: 'leave-room', from: 'A', roomId: BRAIN_ROOM_ID, ts: 2 });
    b.deliver('A', chat('A', BRAIN_ROOM_ID, 'still here', Date.now() + 5_000));
    expect(getRoomChatMessages(BRAIN_ROOM_ID).map((m) => m.text)).toEqual(['still here']);
  });

  it('two peers both outside the Brain chat with each other', () => {
    const b = makeMesh('B', ['A']);
    startSignalingBridge(b.mesh as never);
    b.deliver('A', chat('A', BRAIN_ROOM_ID, 'explore to explore', 33));
    expect(getRoomChatMessages(BRAIN_ROOM_ID).map((m) => m.text)).toEqual(['explore to explore']);
  });

  it('a node outside the Brain relays network chat across the full hop budget', async () => {
    // A - B - C: B is in Explore, the line already took one hop to reach B.
    const b = makeMesh('B', ['A', 'C']);
    startSignalingBridge(b.mesh as never);
    b.deliver('A', chat('X', BRAIN_ROOM_ID, 'two hops away', 10, 1));
    await Promise.resolve();
    expect(b.sent.some((s) => s.to === 'C' && s.payload.msgType === 'chat-message' && s.payload.hops === 2)).toBe(true);
  });

  it('a live room stays private: a peer who left it is not heard, and outsiders do not relay it far', async () => {
    const b = makeMesh('B', ['A', 'C']);
    startSignalingBridge(b.mesh as never);
    announceJoinRoom('live-1', 'uB', 'B');
    b.deliver('A', { msgType: 'join-room', from: 'A', roomId: 'live-1', ts: 1 });
    b.deliver('A', { msgType: 'leave-room', from: 'A', roomId: 'live-1', ts: 2 });
    b.deliver('A', chat('A', 'live-1', 'after leaving', Date.now() + 5_000));
    expect(getRoomChatMessages('live-1')).toHaveLength(0);
    stopSignalingBridge();

    const c = makeMesh('C', ['A', 'D']);
    startSignalingBridge(c.mesh as never);
    c.deliver('A', chat('X', 'live-2', 'members only', 10, 1));
    await Promise.resolve();
    expect(c.sent.some((s) => s.payload.msgType === 'chat-message')).toBe(false);
    // Nothing from the live room leaks into the network chat.
    expect(getRoomChatMessages(BRAIN_ROOM_ID)).toHaveLength(0);
  });

  it('lists who has the network chat open from the menu, and forgets them when they close it', () => {
    const b = makeMesh('B', ['A']);
    startSignalingBridge(b.mesh as never);
    announceJoinRoom(BRAIN_ROOM_ID, 'uB', 'B');
    b.deliver('A', { msgType: 'chat-here', from: 'A', roomId: BRAIN_ROOM_ID, userId: 'uA', username: 'Eve', data: { open: true }, ts: 1 });
    expect(bridge.getNetworkChatPeers().map((p) => p.username)).toEqual(['Eve']);
    // Only the shared chat has a member list; live rooms keep theirs private.
    b.deliver('C', { msgType: 'chat-here', from: 'C', roomId: 'live-1', username: 'Lurker', data: { open: true }, ts: 2 });
    expect(bridge.getNetworkChatPeers().map((p) => p.username)).toEqual(['Eve']);
    b.deliver('A', { msgType: 'chat-here', from: 'A', roomId: BRAIN_ROOM_ID, data: { open: false }, ts: 3 });
    expect(bridge.getNetworkChatPeers()).toHaveLength(0);
  });

  it('drops a menu chatter who stops announcing', () => {
    const b = makeMesh('B', ['A']);
    startSignalingBridge(b.mesh as never);
    b.deliver('A', { msgType: 'chat-here', from: 'A', roomId: BRAIN_ROOM_ID, username: 'Eve', data: { open: true }, ts: 1 });
    expect(bridge.getNetworkChatPeers(Date.now() + bridge.CHAT_HERE_TTL_MS + 1)).toHaveLength(0);
  });

  it('announces the open chat to connected peers', () => {
    const e = makeMesh('E', ['B']);
    startSignalingBridge(e.mesh as never);
    bridge.announceNetworkChatHere(BRAIN_ROOM_ID, 'uE', 'Eve');
    expect(e.sent.some((s) => s.to === 'B' && s.payload.msgType === 'chat-here' && s.payload.username === 'Eve')).toBe(true);
  });

  it('stops listing a Brain peer who went quiet, even when this device never joined the Brain', () => {
    const e = makeMesh('E', ['B']);
    startSignalingBridge(e.mesh as never);
    e.deliver('B', { msgType: 'presence', from: 'B', roomId: BRAIN_ROOM_ID, username: 'Bee', data: {}, ts: 1 });
    expect(bridge.getLiveNetworkRoomPresences(BRAIN_ROOM_ID).map((p) => p.username)).toEqual(['Bee']);
    expect(bridge.getLiveNetworkRoomPresences(BRAIN_ROOM_ID, Date.now() + bridge.CHAT_HERE_TTL_MS + 1)).toHaveLength(0);
    // A heartbeat keeps them listed.
    e.deliver('B', { msgType: 'room-heartbeat', from: 'B', roomId: BRAIN_ROOM_ID, ts: 2 });
    expect(bridge.getLiveNetworkRoomPresences(BRAIN_ROOM_ID)).toHaveLength(1);
  });
});

