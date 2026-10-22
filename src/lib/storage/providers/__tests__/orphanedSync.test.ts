import { describe, it, expect } from 'vitest';
import { isOrphanedSyncError } from '../personalServerSync';

describe('isOrphanedSyncError', () => {
  it('recognises errors tagged as orphaned source data', () => {
    expect(isOrphanedSyncError(new Error('ORPHANED: Chunk chunk-abc is gone locally and on the linked servers.'))).toBe(true);
    expect(isOrphanedSyncError(new Error('ORPHANED: Manifest file-1 is gone locally and on the linked servers.'))).toBe(true);
  });
  it('leaves transient failures retryable', () => {
    expect(isOrphanedSyncError(new Error('PUT chunk failed: 503 Slow Down.'))).toBe(false);
    expect(isOrphanedSyncError(new Error('Remote verification did not confirm every object.'))).toBe(false);
    expect(isOrphanedSyncError('ORPHANED: string, not an Error')).toBe(false);
  });
});
