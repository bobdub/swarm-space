import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const stores: Record<string, Map<string, unknown>> = {};

function storeOf(name: string): Map<string, unknown> {
  stores[name] ??= new Map();
  return stores[name];
}

vi.mock('@/lib/store', () => ({
  get: vi.fn(async (store: string, key: string) => storeOf(store).get(key)),
  getAll: vi.fn(async (store: string) => Array.from(storeOf(store).values())),
  put: vi.fn(async (store: string, value: Record<string, unknown>) => {
    const key = (value.id ?? value.k ?? value.ref ?? value.fileId) as string;
    storeOf(store).set(key, value);
  }),
  remove: vi.fn(async (store: string, key: string) => { storeOf(store).delete(key); }),
}));

import {
  buildReplicaBatches,
  buildReplicaIndex,
  clearRecordState,
  markBatchUploaded,
  selectChangedBatches,
} from './personalServerRecords';

describe('device record replica', () => {
  beforeEach(() => {
    for (const key of Object.keys(stores)) delete stores[key];
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
    storeOf('posts').set('post-1', { id: 'post-1', body: 'hello world' });
    storeOf('projects').set('proj-1', { id: 'proj-1', name: 'Swarm' });
  });

  it('produces one encrypted, deterministic-keyed batch per populated store', async () => {
    const batches = await buildReplicaBatches('user-1');
    const labels = batches.map((b) => b.label);
    expect(labels).toContain('posts#0');
    expect(labels).toContain('projects#0');

    const again = await buildReplicaBatches('user-1');
    expect(again.map((b) => b.objectKey)).toEqual(batches.map((b) => b.objectKey));
    expect(again.map((b) => b.digest)).toEqual(batches.map((b) => b.digest));
  });

  it('never emits plaintext to the server payload', async () => {
    const [batch] = await buildReplicaBatches('user-1');
    const text = new TextDecoder().decode(batch.body);
    expect(text).not.toContain('hello world');
    expect(JSON.parse(text)).toMatchObject({ v: 1, userId: 'user-1' });
  });

  it('skips batches whose plaintext has not changed', async () => {
    const batches = await buildReplicaBatches('user-1');
    expect((await selectChangedBatches('srv-1', batches)).changed).toHaveLength(batches.length);

    for (const batch of batches) await markBatchUploaded('srv-1', batch);
    const second = await selectChangedBatches('srv-1', await buildReplicaBatches('user-1'));
    expect(second.changed).toHaveLength(0);
    expect(second.skipped).toBe(batches.length);

    storeOf('posts').set('post-2', { id: 'post-2', body: 'new' });
    const third = await selectChangedBatches('srv-1', await buildReplicaBatches('user-1'));
    expect(third.changed.map((b) => b.label)).toEqual(['posts#0']);
  });

  it('forgets upload state when a server is unlinked', async () => {
    const batches = await buildReplicaBatches('user-1');
    for (const batch of batches) await markBatchUploaded('srv-1', batch);
    await clearRecordState('srv-1');
    expect((await selectChangedBatches('srv-1', batches)).changed).toHaveLength(batches.length);
  });

  it('writes an index listing every batch', async () => {
    const batches = await buildReplicaBatches('user-1');
    const index = await buildReplicaIndex('user-1', batches);
    const parsed = JSON.parse(new TextDecoder().decode(index.body));
    expect(index.objectKey.startsWith('rec-index-')).toBe(true);
    expect(parsed.batches).toHaveLength(batches.length);
  });
});
