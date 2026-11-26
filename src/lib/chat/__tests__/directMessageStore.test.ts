import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createIndexedDbDirectMessageStore, type DirectMessageRecord } from '../directMessages';
import { get, put } from '../../store';

async function key(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function row(id: string, text: string): DirectMessageRecord {
  return {
    id, conversationId: 'dm:a:b', peerId: 'peer-b', peerUserId: 'b', senderId: 'b', text,
    timestamp: 1, read: false, status: 'delivered', seq: 1, vector: { b: 1 },
  };
}

describe('direct message store at rest', () => {
  it('seals text under the history key and opens it again', async () => {
    const k = await key();
    const store = createIndexedDbDirectMessageStore(async () => k);
    await store.put(row('s1', 'meet at the dock'));
    const raw = await get<Record<string, unknown>>('direct_messages', 's1');
    expect(raw?.text).toBe('');
    expect(JSON.stringify(raw)).not.toContain('dock');
    expect((await store.get('s1'))?.text).toBe('meet at the dock');
    expect((await store.byConversation('dm:a:b')).map((r) => r.text)).toContain('meet at the dock');
  });

  it('shows sealed rows as locked without the key, and keeps them sealed on update', async () => {
    const k = await key();
    await createIndexedDbDirectMessageStore(async () => k).put(row('s2', 'secret'));
    const locked = createIndexedDbDirectMessageStore(async () => null);
    const r = await locked.get('s2');
    expect(r?.locked).toBe(true);
    expect(r?.text).toBe('');
    await locked.put({ ...r!, read: true });
    const reopened = await createIndexedDbDirectMessageStore(async () => k).get('s2');
    expect(reopened?.text).toBe('secret');
    expect(reopened?.read).toBe(true);
  });

  it('seals rows written before the key was open', async () => {
    await put('direct_messages', row('s3', 'old plain line'));
    const k = await key();
    const store = createIndexedDbDirectMessageStore(async () => k);
    expect((await store.get('s3'))?.text).toBe('old plain line');
    const raw = await get<Record<string, unknown>>('direct_messages', 's3');
    expect(raw?.text).toBe('');
    expect(raw?.sealed).toBeTruthy();
  });

  it('pins namespaces per user', async () => {
    const store = createIndexedDbDirectMessageStore();
    await store.putPin({ userId: 'u1', identityKey: 'k', walletAddress: '0x1', namespaceId: 'n', discriminator: 'd' });
    expect((await store.getPin('u1'))?.namespaceId).toBe('n');
    expect(await store.getPin('u2')).toBeUndefined();
  });
});
