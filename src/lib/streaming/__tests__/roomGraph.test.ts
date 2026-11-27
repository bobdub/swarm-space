import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  getRoomGraphPeers,
  joinRoomGraph,
  leaveRoomGraph,
  onRoomGraphPeer,
  onRoomInboxSignal,
  roomInboxGraphKey,
  roomPeersGraphKey,
  sendRoomInboxSignal,
  setRoomGraphTransportFactory,
  type RoomGraphTransportOptions,
} from '../roomGraph';
import { isPoliteMeshPair } from '@/lib/webrtc/manager';

type H = (from: string, payload: unknown) => void;

function fakeTransports() {
  const made: Array<{ opts: RoomGraphTransportOptions; handlers: Map<string, H>; sent: unknown[][]; broadcasts: unknown[][] }> = [];
  const factory = async (opts: RoomGraphTransportOptions) => {
    const t = { opts, handlers: new Map<string, H>(), sent: [] as unknown[][], broadcasts: [] as unknown[][] };
    made.push(t);
    return {
      start: async () => {},
      stop: () => {},
      send: (c: string, to: string, p: unknown) => { t.sent.push([c, to, p]); return true; },
      broadcastToAll: (c: string, p: unknown, o?: { slot?: string }) => { t.broadcasts.push([c, p, o?.slot]); return true; },
      onMessage: (c: string, h: H) => { t.handlers.set(c, h); return () => t.handlers.delete(c); },
    };
  };
  return { made, factory };
}

afterEach(() => { leaveRoomGraph(); setRoomGraphTransportFactory(null); });

describe('Gun room graph', () => {
  it('uses the room peers registry and per-peer inbox keys', async () => {
    const { made, factory } = fakeTransports();
    setRoomGraphTransportFactory(factory);
    joinRoomGraph('brain', 'A');
    await vi.waitFor(() => expect(made).toHaveLength(2));
    expect(made.map(t => t.opts.graphKey).sort()).toEqual([roomInboxGraphKey('brain'), roomPeersGraphKey('brain')].sort());
    expect(roomPeersGraphKey('brain')).toBe('swarm-space/rooms/brain/peers');
    const presence = made.find(t => t.opts.registryMode)!;
    await vi.waitFor(() => expect(presence.broadcasts).toHaveLength(1));
    expect(presence.broadcasts[0][2]).toBe('A'); // our own slot
  });

  it('accepts presence only from the slot owner and drops stale beats', async () => {
    const { made, factory } = fakeTransports();
    setRoomGraphTransportFactory(factory);
    const seen: string[] = [];
    const off = onRoomGraphPeer((_r, p) => seen.push(p));
    joinRoomGraph('brain', 'A');
    await vi.waitFor(() => expect(made.find(t => t.opts.registryMode)?.handlers.size).toBe(1));
    const h = [...made.find(t => t.opts.registryMode)!.handlers.values()][0];
    h('D', JSON.stringify({ peerId: 'D', roomId: 'brain', ts: Date.now() }));
    h('X', JSON.stringify({ peerId: 'D', roomId: 'brain', ts: Date.now() })); // spoofed
    h('E', JSON.stringify({ peerId: 'E', roomId: 'brain', ts: Date.now() - 120_000 })); // stale
    h('F', JSON.stringify({ peerId: 'F', roomId: 'other', ts: Date.now() })); // other room
    off();
    expect(seen).toEqual(['D']);
    expect(getRoomGraphPeers('brain')).toEqual(['D']);
  });

  it('inbox: delivers only envelopes signed by the sender, addressed to us, for this room', async () => {
    const { made, factory } = fakeTransports();
    setRoomGraphTransportFactory(factory);
    const got: unknown[] = [];
    const off = onRoomInboxSignal((_r, from, env) => got.push([from, env.msgType]));
    joinRoomGraph('brain', 'A');
    await vi.waitFor(() => expect(made.find(t => t.opts.inbox)?.handlers.size).toBe(1));
    const h = [...made.find(t => t.opts.inbox)!.handlers.values()][0];
    const base = { roomId: 'brain', to: 'A', ts: Date.now(), mid: 'm' };
    h('D', JSON.stringify({ ...base, msgType: 'offer', from: 'D' }));
    h('X', JSON.stringify({ ...base, msgType: 'offer', from: 'D' }));
    h('D', JSON.stringify({ ...base, msgType: 'offer', from: 'D', to: 'B' }));
    h('D', JSON.stringify({ ...base, msgType: 'offer', from: 'D', ts: Date.now() - 120_000 }));
    h('D', 'x'.repeat(40_000));
    off();
    expect(got).toEqual([['D', 'offer']]);
  });

  it('queues inbox sends until the transport is ready and refuses other rooms', async () => {
    const { made, factory } = fakeTransports();
    setRoomGraphTransportFactory(factory);
    joinRoomGraph('brain', 'A');
    expect(sendRoomInboxSignal('brain', 'D', { msgType: 'offer' })).toBe(true);
    expect(sendRoomInboxSignal('other', 'D', { msgType: 'offer' })).toBe(false);
    await vi.waitFor(() => expect(made.find(t => t.opts.inbox)?.sent).toHaveLength(1));
    expect(made.find(t => t.opts.inbox)!.sent[0][1]).toBe('D');
  });

  it('does nothing without a transport (tests and unsupported browsers)', () => {
    joinRoomGraph('brain', 'A');
    expect(sendRoomInboxSignal('brain', 'D', { msgType: 'offer' })).toBe(false);
  });
});

describe('glare tie-break', () => {
  it('is symmetric: exactly one side of every pair is polite', () => {
    const ids = ['peer-a1', 'peer-B2', 'peer-c3', 'peer-0d'];
    for (const a of ids) for (const b of ids) {
      if (a === b) continue;
      expect(isPoliteMeshPair(a, b)).toBe(!isPoliteMeshPair(b, a));
    }
  });
});
