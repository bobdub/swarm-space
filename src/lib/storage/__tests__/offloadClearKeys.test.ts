import { describe, it, expect } from 'vitest';
import { clearKeyForRow } from '../offload';

describe('clearBulkLocal key resolution', () => {
  it('resolves replica rows keyed by manifestId', () => {
    expect(clearKeyForRow({ manifestId: 'file-123', seederCount: 2 })).toBe('file-123');
  });
  it('prefers chunk refs and file ids over manifestId', () => {
    expect(clearKeyForRow({ ref: 'chunk-abc', manifestId: 'file-123' })).toBe('chunk-abc');
    expect(clearKeyForRow({ fileId: 'file-9' })).toBe('file-9');
  });
  it('skips rows with no known key', () => {
    expect(clearKeyForRow({ seederCount: 2 })).toBeUndefined();
  });
});
