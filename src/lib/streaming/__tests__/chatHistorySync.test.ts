import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  startSignalingBridge,
  stopSignalingBridge,
  sendRoomChatMessage,
  getRoomChatMessages,
  requestRoomChatHistory,
  onRoomChatHistory,
  onRoomChatMessage,
  buildChatHistoryPackets,
  type RoomChatMessage,
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
    onMessage: (_c: string, h: (from: string, p: unknown) => void) => { handler = h; return () => { handler = null; }; },
    getConnectedPeerIds: () => connected,
    getPeerId: () => id,
  };
  return { mesh, sent, deliver: (from: string, p: unknown) => handler?.(from, p) };
}

function msg(id: string, ts: number, text = `hello ${id}`, sender = 'A'): RoomChatMessage {
  return { id, roomId: 'r', senderPeerId: sender, senderUsername: sender, text, ts };
}

beforeEach(() => { try { window.localStorage.clear(); } catch { /* ignore */ } });
afterEach(() => stopSignalingBridge());

describe('chat history sync', () => {
  it('an existing peer answers a newcomer with its log, and the newcomer merges it once', async () => {
    // Peer A holds two messages.
    const a = makeMesh('A', ['B']);
    startSignalingBridge(a.mesh as never);
    sendRoomChatMessage('r', 'first', 'uA', 'Alice');
    sendRoomChatMessage('r', 'second', 'uA', 'Alice');
    a.sent.length = 0;
    a.deliver('B', { msgType: 'chat-history-request', from: 'B', to: 'A', roomId: 'r', data: { id: 'q1', have: [] }, ts: 1 });
    await Promise.resolve();
    const replies = a.sent.filter((s) => s.payload.msgType === 'chat-history');
    expect(replies).toHaveLength(1);
    expect(replies[0]?.to).toBe('B');
    // A second request inside the cooldown is ignored.
    a.deliver('B', { msgType: 'chat-history-request', from: 'B', to: 'A', roomId: 'r', data: { id: 'q2', have: [] }, ts: 2 });
    await Promise.resolve();
    expect(a.sent.filter((s) => s.payload.msgType === 'chat-history')).toHaveLength(1);
    stopSignalingBridge();

    // Peer B (newcomer) asks and receives.
    const b = makeMesh('B', ['A']);
    startSignalingBridge(b.mesh as never);
    const release = requestRoomChatHistory('r');
    expect(b.sent.some((s) => s.to === 'A' && s.payload.msgType === 'chat-history-request')).toBe(true);
    const historyEvents: string[] = [];
    const live: RoomChatMessage[] = [];
    const offH = onRoomChatHistory((rid) => historyEvents.push(rid));
    const offL = onRoomChatMessage((m) => live.push(m));
    b.deliver('A', replies[0]!.payload);
    b.deliver('A', { ...replies[0]!.payload, ts: (replies[0]!.payload.ts as number) + 99 });
    const log = getRoomChatMessages('r');
    expect(log.map((m) => m.text)).toEqual(['first', 'second']);
    expect(historyEvents).toEqual(['r']);
    // History never replays through the live handlers (no TTS / learning).
    expect(live).toHaveLength(0);
    offH(); offL(); release();
  });

  it('skips ids the requester already has and messages from blocked senders', () => {
    const packets = buildChatHistoryPackets(
      [msg('1', 1), msg('2', 2), msg('3', 3, 'spam', 'X')],
      new Set(['1']),
      new Set(['X']),
    );
    expect(packets.flat().map((m) => m.id)).toEqual(['2']);
  });

  it('splits long messages across packets and keeps the newest when over budget', () => {
    const big = 'x'.repeat(30_000);
    const many = Array.from({ length: 50 }, (_, i) => msg(String(i), i, big));
    const packets = buildChatHistoryPackets(many);
    const flat = packets.flat();
    // 1M char budget → the newest 33 messages of 30k chars.
    expect(flat).toHaveLength(33);
    expect(flat[flat.length - 1]?.id).toBe('49');
    expect(flat[0]?.id).toBe('17');
    for (const p of packets) {
      expect(p.reduce((n, m) => n + m.text.length, 0)).toBeLessThanOrEqual(60_000);
    }
  });

  it('drops history from a sender the receiver blocked and stays in the packet room', () => {
    window.localStorage.setItem('p2p:blocklist:v1', JSON.stringify([{ peerId: 'X', direction: 'all', addedAt: 1 }]));
    const b = makeMesh('B', ['A']);
    startSignalingBridge(b.mesh as never);
    b.deliver('A', {
      msgType: 'chat-history', from: 'A', to: 'B', roomId: 'r', ts: 5,
      data: { id: 'h1', messages: [msg('1', 1), msg('2', 2, 'bad', 'X'), { ...msg('3', 3), roomId: 'other' }, { id: 'junk' }] },
    });
    expect(getRoomChatMessages('r').map((m) => m.id)).toEqual(['1']);
  });

  it('asks each newly connected peer while a chat view is open', () => {
    vi.useFakeTimers();
    try {
      const connected: string[] = [];
      const m = makeMesh('B', connected);
      startSignalingBridge(m.mesh as never);
      const release = requestRoomChatHistory('r');
      expect(m.sent).toHaveLength(0);
      connected.push('C');
      vi.advanceTimersByTime(2100);
      expect(m.sent.some((s) => s.to === 'C' && s.payload.msgType === 'chat-history-request')).toBe(true);
      release();
      m.sent.length = 0;
      connected.push('D');
      vi.advanceTimersByTime(2100);
      expect(m.sent.filter((s) => s.payload.msgType === 'chat-history-request')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
