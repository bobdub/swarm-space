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

export function memoryStore(): DirectMessageStore & { rows: Map<string, DirectMessageRecord> } {
  const rows = new Map<string, DirectMessageRecord>();
  const pins = new Map<string, Awaited<ReturnType<DirectMessageStore['getPin']>>>();
  return {
    rows,
    async getPin(u) { return pins.get(u); },
    async putPin(ns) { pins.set(ns.userId, ns); },
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
    getPeerId: () => self,
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


/** A small mesh where every node links to every other; `down` drops links. */
export function hub(ids: string[]) {
  const handlers = new Map<string, (peerId: string, payload: unknown) => void>();
  const down = new Set<string>();
  const meshes = new Map<string, DirectMessageMesh>();
  for (const self of ids) {
    meshes.set(self, {
      getPeerId: () => self,
      getConnectedPeerIds: () => ids.filter((x) => x !== self && !down.has(x) && !down.has(self)),
      async send(channel, peerId, payload) {
        if (channel !== DM_CHANNEL || down.has(peerId) || down.has(self) || !ids.includes(peerId)) return false;
        const wire = JSON.parse(JSON.stringify(payload));
        queueMicrotask(() => handlers.get(peerId)?.(self, wire));
        return true;
      },
      onMessage(channel, handler) {
        if (channel === DM_CHANNEL) handlers.set(self, handler);
        return () => handlers.delete(self);
      },
    });
  }
  return { mesh: (id: string) => meshes.get(id)!, down };
}

export async function settle(ms = 30): Promise<void> {
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
  it('never re-sends earlier lines to another link claiming the same user', async () => {
    const net = hub(['peer-a', 'peer-b', 'peer-x']);
    const storeA = memoryStore();
    const alice = new DirectMessenger(net.mesh('peer-a'), storeA, { userId: 'alice', displayName: 'Alice' });
    const bob = new DirectMessenger(net.mesh('peer-b'), memoryStore(), { userId: 'bob', displayName: 'Bob' });
    const mallory = new DirectMessenger(net.mesh('peer-x'), memoryStore(), { userId: 'bob', displayName: 'Bob' });
    const malloryStore = (mallory as unknown as { store: ReturnType<typeof memoryStore> }).store;
    alice.start();
    bob.start();
    mallory.start();
    await alice.connect('peer-b');
    await settle();
    net.down.add('peer-b');
    const line = await alice.send('peer-b', 'for bob only');
    await settle();
    expect((await storeA.get(line!.id))?.status).toBe('failed');

    // Another link says hello as "bob".
    await mallory.connect('peer-a');
    await settle(60);
    expect(malloryStore.rows.size).toBe(0);
  });

  it('re-sends a failed line once the same link comes back', async () => {
    const net = hub(['peer-a', 'peer-b']);
    const storeA = memoryStore();
    const alice = new DirectMessenger(net.mesh('peer-a'), storeA, { userId: 'alice', displayName: 'Alice' });
    const bob = new DirectMessenger(net.mesh('peer-b'), memoryStore(), { userId: 'bob', displayName: 'Bob' });
    alice.start();
    bob.start();
    await alice.connect('peer-b');
    await settle();
    net.down.add('peer-b');
    const line = await alice.send('peer-b', 'while offline');
    await settle();
    expect((await storeA.get(line!.id))?.status).toBe('failed');

    net.down.delete('peer-b');
    await alice.refresh('peer-b');
    await settle(60);
    expect((await storeA.get(line!.id))?.status).toBe('delivered');
    expect((await bob.history(conversationIdFor('alice', 'bob'))).map((r) => r.text)).toEqual(['while offline']);
  });

  it('retries a failed line on request', async () => {
    const net = hub(['peer-a', 'peer-b']);
    const storeA = memoryStore();
    const alice = new DirectMessenger(net.mesh('peer-a'), storeA, { userId: 'alice', displayName: 'Alice' });
    const bob = new DirectMessenger(net.mesh('peer-b'), memoryStore(), { userId: 'bob', displayName: 'Bob' });
    alice.start();
    bob.start();
    await alice.connect('peer-b');
    await settle();
    net.down.add('peer-b');
    const line = await alice.send('peer-b', 'retry me');
    await settle();
    net.down.delete('peer-b');
    await alice.retry(line!.id);
    await settle();
    expect((await storeA.get(line!.id))?.status).toBe('delivered');
  });
});

// ── Proven identity: signatures, namespace pins, wrapped history key ──

import { Wallet, keccak256, toUtf8Bytes } from 'ethers';
import { computeUserId, genIdentityKeyPair } from '../../crypto';
import {
  createDmSigner,
  createHelloProof,
  openHistoryKey,
  openText,
  sealText,
  verifyHelloProof,
  type DmSigner,
} from '../dmIdentity';

async function account(): Promise<DmSigner> {
  const keys = await genIdentityKeyPair();
  const userId = await computeUserId(keys.publicKey);
  const wallet = new Wallet(keccak256(toUtf8Bytes(`swarm-coldkey:${keys.privateKey.toLowerCase()}`)));
  return createDmSigner({ userId, identityPublicKey: keys.publicKey, identityPrivateKey: keys.privateKey, wallet });
}

function messengerFor(mesh: DirectMessageMesh, signer: DmSigner | null, userId?: string, store = memoryStore()) {
  return new DirectMessenger(mesh, store, {
    userId: userId ?? signer!.userId,
    displayName: 'someone',
    signer: async () => signer,
  });
}

describe('direct message identity', () => {
  it('proves both sides and shows the verified namespace', async () => {
    const [a, b] = await Promise.all([account(), account()]);
    const net = hub(['peer-a', 'peer-b']);
    const alice = messengerFor(net.mesh('peer-a'), a);
    const bob = messengerFor(net.mesh('peer-b'), b);
    alice.start();
    bob.start();
    const s = await alice.connect('peer-b');
    await settle();
    expect(s?.verified).toBe(true);
    expect(s?.discriminator).toBe(b.discriminator);
    expect(bob.getSession('peer-a')?.verified).toBe(true);
    expect(bob.getSession('peer-a')?.namespaceId).toBe(a.namespaceId);
  });

  it('refuses a link that claims a pinned user without proving their namespace', async () => {
    const [a, b, m] = await Promise.all([account(), account(), account()]);
    const net = hub(['peer-a', 'peer-b', 'peer-x', 'peer-y']);
    const storeA = memoryStore();
    const alice = messengerFor(net.mesh('peer-a'), a, undefined, storeA);
    const bob = messengerFor(net.mesh('peer-b'), b);
    alice.start();
    bob.start();
    await alice.connect('peer-b');
    await settle();
    expect((await storeA.getPin(b.userId))?.namespaceId).toBe(b.namespaceId);

    const events: string[] = [];
    alice.subscribe((e) => { if (e.type === 'rejected') events.push(`${e.peerId}:${e.reason}`); });

    // Unsigned hello claiming Bob.
    const unsigned = messengerFor(net.mesh('peer-x'), null, b.userId);
    unsigned.start();
    expect(await unsigned.connect('peer-a', 300)).toBeNull();
    // Signed with another account's keys while claiming Bob.
    const forged = messengerFor(net.mesh('peer-y'), { ...m, userId: b.userId }, b.userId);
    forged.start();
    expect(await forged.connect('peer-a', 300)).toBeNull();
    await settle();
    expect(alice.getSession('peer-x')).toBeUndefined();
    expect(alice.getSession('peer-y')).toBeUndefined();
    expect(events).toEqual(['peer-x:no namespace proof', 'peer-y:no namespace proof']);
  });

  it('marks an unsigned peer unverified when nothing is pinned', async () => {
    const a = await account();
    const net = hub(['peer-a', 'peer-b']);
    const alice = messengerFor(net.mesh('peer-a'), a);
    const guest = messengerFor(net.mesh('peer-b'), null, 'guest-user');
    alice.start();
    guest.start();
    const s = await alice.connect('peer-b');
    expect(s?.userId).toBe('guest-user');
    expect(s?.verified).toBe(false);
  });

  it('rejects a proof replayed from another link, re-keyed, or too old', async () => {
    const b = await account();
    const pub = 'BPub';
    const proof = await createHelloProof(b, { pub, fromPeerId: 'peer-b', toPeerId: 'peer-a' });
    const claim = { userId: b.userId, pub, transportPeerId: 'peer-b', selfPeerId: 'peer-a' };
    expect(await verifyHelloProof(proof, claim)).not.toBeNull();
    expect(await verifyHelloProof(proof, { ...claim, transportPeerId: 'peer-x' })).toBeNull();
    expect(await verifyHelloProof(proof, { ...claim, selfPeerId: 'peer-z' })).toBeNull();
    expect(await verifyHelloProof(proof, { ...claim, pub: 'OtherPub' })).toBeNull();
    expect(await verifyHelloProof(proof, claim, proof.ts + 11 * 60_000)).toBeNull();
    const other = await account();
    expect(await verifyHelloProof({ ...proof, walletSig: (await createHelloProof(other, { pub, fromPeerId: 'peer-b', toPeerId: 'peer-a', ts: proof.ts })).walletSig }, claim)).toBeNull();
  });

  it('wraps the history key under the account namespace', async () => {
    const a = await account();
    const first = await openHistoryKey(a, undefined);
    expect(first.created).toBe(true);
    const sealed = await sealText(first.key, 'm1', 'dm:x', 'private words');
    expect(sealed.ct).not.toContain('private');
    const again = await openHistoryKey(a, first.wrapped);
    expect(await openText(again.key, 'm1', 'dm:x', sealed)).toBe('private words');
    // Bound to the row it was sealed for.
    await expect(openText(again.key, 'm2', 'dm:x', sealed)).rejects.toBeTruthy();
    // Another account (or namespace) cannot unwrap it.
    const b = await account();
    await expect(openHistoryKey(b, first.wrapped)).rejects.toBeTruthy();
    await expect(openHistoryKey({ ...a, namespaceId: b.namespaceId }, first.wrapped)).rejects.toBeTruthy();
  });
});
