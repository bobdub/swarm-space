import { describe, it, expect } from 'vitest';
import { clearKeyForRow, engravedFileKeys } from '../offload';

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
  it('keeps files engraved into a coin out of cleanup', () => {
    const keys = engravedFileKeys([
      { fileId: 'file-1', chunks: ['chunk-a', 'chunk-b'], _coinId: 'coin-1' },
      { fileId: 'file-2', chunks: ['chunk-c'] },
    ]);
    expect([...keys].sort()).toEqual(['chunk-a', 'chunk-b', 'file-1']);
  });
});
