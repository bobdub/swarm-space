import { describe, it, expect } from 'vitest';
import { friendlySyncError } from './personalServerSyncError';

describe('friendlySyncError', () => {
  it('flags a real 401/403 status as a credential rejection', () => {
    expect(friendlySyncError('PUT chunk failed: 403 AccessDenied.')).toContain('relink the server');
    expect(friendlySyncError('PUT chunk failed: 401 Unauthorized.')).toContain('relink the server');
  });

  it('does not flag hex chunk refs that merely contain 401/403', () => {
    const msg = 'ORPHANED: Chunk chunk-401f2ab4039c is gone locally and on the linked servers.';
    expect(friendlySyncError(msg)).toBe(msg);
  });

  it('flags a real 400 status as a refused upload', () => {
    expect(friendlySyncError('PUT chunk failed: 400 XMinioInvalidObjectName.')).toContain('refused an upload');
  });

  it('does not flag a hex ref ending in 400 as a refused upload', () => {
    const msg = 'ORPHANED: Chunk pc-9de400 is gone locally and on the linked servers.';
    expect(friendlySyncError(msg)).toBe(msg);
  });

  it('classifies network failures as reachability problems', () => {
    expect(friendlySyncError('Browser could not reach minio.local. Failed to fetch')).toContain("Couldn't reach the server");
  });
});
