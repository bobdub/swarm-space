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