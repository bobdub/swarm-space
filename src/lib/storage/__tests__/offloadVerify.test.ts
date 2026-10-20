import { describe, it, expect } from 'vitest';
import { sha256Hex, verifyDownloadedFile } from '../offload';

describe('download verification gates clearing', () => {
  it('accepts an identical file and rejects a corrupted one', async () => {
    const good = new Blob(['hello swarm']);
    const receipt = { filename: 'x', size: good.size, sha256: await sha256Hex(good) };
    expect(await verifyDownloadedFile(new Blob(['hello swarm']), receipt)).toBe(true);
    expect(await verifyDownloadedFile(new Blob(['hello swarX']), receipt)).toBe(false);
  });
});
