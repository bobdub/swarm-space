import { describe, it, expect } from 'vitest';
import { evictableChunkRefs, type PersonalServerSyncRecord } from '../personalServerSync';

function rec(over: Partial<PersonalServerSyncRecord>): PersonalServerSyncRecord {
  return {
    id: 's1:m1', serverId: 's1', userId: 'u1', manifestId: 'm1',
    manifestStore: 'manifests', chunkRefs: ['c1', 'c2'], status: 'complete',
    attempts: 1, nextAttemptAt: 0, createdAt: 1, updatedAt: 2, ...over,
  };
}

describe('local chunk eviction after verified upload', () => {
  it('evicts chunks once the only record completes', () => {
    const done = rec({});
    expect(evictableChunkRefs(done, [done])).toEqual(['c1', 'c2']);
  });
  it('a failed record for the same manifest no longer pins local chunks', () => {
    const done = rec({});
    const failed = rec({ id: 's2:m1', serverId: 's2', status: 'failed' });
    expect(evictableChunkRefs(done, [done, failed])).toEqual(['c1', 'c2']);
  });
  it('a pending record for the same manifest keeps local chunks', () => {
    const done = rec({});
    const pending = rec({ id: 's2:m1', serverId: 's2', status: 'pending' });
    expect(evictableChunkRefs(done, [done, pending])).toEqual([]);
  });
  it('chunks shared with another active upload stay local', () => {
    const done = rec({});
    const other = rec({ id: 's1:m2', manifestId: 'm2', chunkRefs: ['c2'], status: 'pending' });
    expect(evictableChunkRefs(done, [done, other])).toEqual(['c1']);
  });
});
