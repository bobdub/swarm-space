import { describe, expect, it } from 'vitest';
import { namespaceIdentity, connectionCurvature } from './namespaceIdentity';

describe('namespace coordinates', () => {
  it('keeps identity stable independent of handle, peerId and wallet casing', async () => {
    const a = await namespaceIdentity('user-a', '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
    expect(await namespaceIdentity('user-a', '0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD')).toEqual(a);
    expect(a.namespaceId).toHaveLength(64);
    expect(a.discriminator).toHaveLength(8);
    expect(await namespaceIdentity('user-b', '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd')).not.toEqual(a);
    expect(await namespaceIdentity('user-a', '0x1111111111111111111111111111111111111111')).not.toEqual(a);
  });
  it('never substitutes an absent or zero wallet anchor', async () => {
    await expect(namespaceIdentity('user-a', '')).rejects.toThrow();
    await expect(namespaceIdentity('user-a', '0x0000000000000000000000000000000000000000')).rejects.toThrow();
  });
  it('ranks hours together above a recent short connection', () => {
    expect(connectionCurvature({ connectedDurationMs: 14_400_000, sessions: 1 })).toBeGreaterThan(connectionCurvature({ connectedDurationMs: 60_000, sessions: 1, lastInteractionAt: 100 }, 100));
    expect(Number.isFinite(connectionCurvature({ connectedDurationMs: NaN, sessions: Infinity }))).toBe(true);
  });
});
describe('verifying relayed namespace coordinates', () => {
  it('accepts only coordinates that re-derive from the same userId and wallet', async () => {
    const { verifyNamespaceIdentity } = await import('./namespaceIdentity');
    const w = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
    const id = await namespaceIdentity('user-a', w);
    expect(await verifyNamespaceIdentity('user-a', w.toUpperCase().replace('0X', '0x'), id.namespaceId, id.discriminator)).toBe(true);
    expect(await verifyNamespaceIdentity('user-b', w, id.namespaceId, id.discriminator)).toBe(false);
    expect(await verifyNamespaceIdentity('user-a', w, id.namespaceId, 'ffffffff')).toBe(false);
    expect(await verifyNamespaceIdentity('user-a', 'not-a-wallet', id.namespaceId, id.discriminator)).toBe(false);
    expect(await verifyNamespaceIdentity('user-a', w, undefined, undefined)).toBe(false);
  });
});
