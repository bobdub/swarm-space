import { webcrypto } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const records = new Map<string, unknown>();

vi.mock('@/lib/store', () => ({
  get: vi.fn(async (_store: string, key: string) => records.get(key)),
  put: vi.fn(async (_store: string, value: { id: string }) => { records.set(value.id, value); }),
  remove: vi.fn(async (_store: string, key: string) => { records.delete(key); }),
}));

describe('personal server device credentials', () => {
  beforeEach(() => {
    records.clear();
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
  });

  it('persists encrypted credentials for the same user and server', async () => {
    const { persistPersonalServerCredentials, readPersonalServerCredentials } = await import('./personalServerSecrets');
    await persistPersonalServerCredentials('user-a', 'server-a', { token: 'private-token' });

    await expect(readPersonalServerCredentials('user-a', 'server-a'))
      .resolves.toEqual({ token: 'private-token' });

    const stored = records.get('credential:user-a:server-a');
    expect(JSON.stringify(stored)).not.toContain('private-token');
  });

  it('binds ciphertext to both the user and server identities', async () => {
    const { persistPersonalServerCredentials, readPersonalServerCredentials } = await import('./personalServerSecrets');
    await persistPersonalServerCredentials('user-a', 'server-a', { token: 'private-token' });

    await expect(readPersonalServerCredentials('user-b', 'server-a')).resolves.toBeNull();
    await expect(readPersonalServerCredentials('user-a', 'server-b')).resolves.toBeNull();
  });
});