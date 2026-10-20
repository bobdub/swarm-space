import { describe, it, expect } from 'vitest';
import { s3ChunkKey, s3PublicChunkKey } from '../s3Compatible';

describe('S3 object keys', () => {
  it('removes colons so MinIO accepts manifest keys', () => {
    const key = s3ChunkKey('u1', 'manifest:file-1787519999492-efj9y4');
    expect(key).not.toContain(':');
    expect(key).toBe('imagination/u1/chunks/manifest_3a_file-1787519999492-efj9y4');
  });
  it('leaves plain hashes unchanged', () => {
    expect(s3PublicChunkKey('abc123')).toBe('imagination/public/chunks/abc123');
  });
});
