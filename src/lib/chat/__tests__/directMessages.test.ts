import { describe, expect, it } from 'vitest';
import {
  DM_CHANNEL,
  DirectMessenger,
  conversationIdFor,
  parseWire,
  type DirectMessageMesh,
  type DirectMessageRecord,
  type DirectMessageStore,
} from '../directMessages';

function memoryStore(): DirectMessageStore & { rows: Map<string, DirectMessageRecord> } {
  const rows = new Map<string, DirectMessageRecord>();
  return {
    rows,
    async put(r) { rows.set(r.id, { ...r }); },
    async get(id) { const r = rows.get(id); return r ? { ...r } : undefined; },
    async byConversation(c) { return [...rows.values()].filter((r) => r.conversationId === c).map((r) => ({ ...r })); },
    async all() { return [...rows.values()].map((r) => ({ ...r })); },
  };
}

/** Two meshes joined by one link; `tap` sees (and may rewrite) every payload. */
function linkedMeshes(tap?: (from: string, payload: unknown) => unknown) {
  const handlers = new Map<string, (peerId: string, payload: unknown) => void>();
  const make = (self: string, other: string): DirectMessageMesh => ({
    getConnectedPeerIds: () => [other],
    async send(channel, peerId, payload) {
      if (channel !== DM_CHANNEL || peerId !== other) return false;
      const wire = JSON.parse(JSON.stringify(tap ? tap(self, payload) : payload));
      queueMicrotask(() => handlers.get(other)?.(self, wire));
      return true;
    },
    onMessage(channel, handler) {
      if (channel === DM_CHANNEL) handlers.set(self, handler);
      return () => handlers.delete(self);
    },
  });
  return { a: make('peer-a', 'peer-b'), b: make('peer-b', 'peer-a') };
}

async function settle(ms = 30): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

describe('direct messages', () => {
  it('conversation ids match on both sides', () => {
    expect(conversationIdFor('alice', 'bob')).toBe(conversationIdFor('bob', 'alice'));
  });

  it('rejects malformed wire payloads', () => {
    expect(parseWire(null)).toBeNull();
    expect(parseWire({ v: 1, kind: 'msg', id: 'x' })).toBeNull();
    expect(parseWire({ v: 2, kind: 'typing', typing: true })).toBeNull();
    expect(parseWire({ v: 1, kind: 'ack', ids: ['a'] })).toEqual({ v: 1, kind: 'ack', ids: ['a'] });
  });

  it('entangles, encrypts end to end and reports delivery and read', async () => {
    const seen: unknown[] = [];
    const { a, b } = linkedMeshes((_from, p) => { seen.push(p); return p; });
    const storeA = memoryStore();
    const storeB = memoryStore();
    const alice = new DirectMessenger(a, storeA, { userId: 'alice', displayName: 'Alice' });
    const bob = new DirectMessenger(b, storeB, { userId: 'bob', displayName: 'Bob' });
    alice.start();
    bob.start();

    const session = await alice.connect('peer-b');
    expect(session?.userId).toBe('bob');
    expect(session?.displayName).toBe('Bob');
    await settle();
    expect(bob.getSession('peer-a')?.fingerprint).toBe(session?.fingerprint);

    const sent = await alice.send('peer-b', 'hello **bob**');
    expect(sent?.status).not.toBe('failed');
    await settle();

    // The wire never carries the plaintext.
    expect(JSON.stringify(seen)).not.toContain('hello **bob**');

    const cid = conversationIdFor('alice', 'bob');
    const bobHistory = await bob.history(cid);
    expect(bobHistory.map((r) => r.text)).toEqual(['hello **bob**']);
    expect(bobHistory[0].read).toBe(false);
    expect((await bob.unreadCounts()).get(cid)).toBe(1);
    expect((await storeA.get(sent!.id))?.status).toBe('delivered');

    await bob.markRead(cid);
    await settle();
    expect((await bob.unreadCounts()).get(cid)).toBeUndefined();
    expect((await storeA.get(sent!.id))?.status).toBe('read');

    // Causal vector carries both sides forward.
    const reply = await bob.send('peer-a', 'hi alice');
    expect(reply?.vector).toEqual({ alice: 1, bob: 1 });
    await settle();
    expect((await alice.history(cid)).map((r) => r.text)).toEqual(['hello **bob**', 'hi alice']);
  });

  it('drops a tampered line instead of storing it', async () => {
    let tamper = false;
    const { a, b } = linkedMeshes((_from, p) => {
      const w = p as Record<string, unknown>;
      if (tamper && w.kind === 'msg') return { ...w, ts: (w.ts as number) + 1 };
      return p;
    });
    const storeB = memoryStore();
    const alice = new DirectMessenger(a, memoryStore(), { userId: 'alice', displayName: 'Alice' });
    const bob = new DirectMessenger(b, storeB, { userId: 'bob', displayName: 'Bob' });
    alice.start();
    bob.start();
    await alice.connect('peer-b');
    await settle();
    tamper = true;
    await alice.send('peer-b', 'secret');
    await settle();
    expect(storeB.rows.size).toBe(0);
  });

  it('re-keys and re-sends after the receiver restarts', async () => {
    const { a, b } = linkedMeshes();
    const storeB = memoryStore();
    const alice = new DirectMessenger(a, memoryStore(), { userId: 'alice', displayName: 'Alice' });
    let bob = new DirectMessenger(b, storeB, { userId: 'bob', displayName: 'Bob' });
    alice.start();
    bob.start();
    await alice.connect('peer-b');
    await settle();

    // Bob reloads: new session key, same stored history.
    bob.stop();
    bob = new DirectMessenger(b, storeB, { userId: 'bob', displayName: 'Bob' });
    bob.start();

    await alice.send('peer-b', 'after reload');
    await settle(60);
    expect((await bob.history(conversationIdFor('alice', 'bob'))).map((r) => r.text)).toEqual(['after reload']);
  });
});
