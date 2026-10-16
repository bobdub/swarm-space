import { describe, it, expect } from 'vitest';
import { decideAccess, isMembershipCurrent, roleAllows } from '../policy';
import { generateHostKeys, signMembership, verifyMembership } from '../crypto';

const base = {
  policy: 'approval' as const, requesterPeerId: 'peer-b', hostPeerId: 'peer-a',
  memberCount: 0, maxMembers: 10, blocked: new Set<string>(), existingMembers: new Set<string>(),
};

describe('GroupWare access policy', () => {
  it('approval policy queues new requests for the host', () => expect(decideAccess(base)).toBe('pending'));
  it('open policy grants immediately', () => expect(decideAccess({ ...base, policy: 'open' })).toBe('grant'));
  it('closed policy denies new people', () => expect(decideAccess({ ...base, policy: 'closed' })).toBe('deny'));
  it('full node denies', () => expect(decideAccess({ ...base, policy: 'open', memberCount: 10 })).toBe('deny'));
  it('blocked peer denied even when open', () => expect(decideAccess({ ...base, policy: 'open', blocked: new Set(['peer-b']) })).toBe('deny'));
  it('readers cannot write', () => { expect(roleAllows('reader', 'put')).toBe(false); expect(roleAllows('writer', 'put')).toBe(true); });
  it('expired membership is not current', () =>
    expect(isMembershipCurrent({ nodeId: 'n', hostPeerId: 'a', memberPeerId: 'b', role: 'writer', issuedAt: 0, expiresAt: 1 })).toBe(false));
});

describe('GroupWare membership signatures', () => {
  it('verifies host-signed membership and rejects tampering', async () => {
    const keys = await generateHostKeys();
    const signed = await signMembership({ nodeId: 'n', hostPeerId: 'a', memberPeerId: 'b', role: 'reader', issuedAt: 1, expiresAt: null }, keys.privateKey);
    expect(await verifyMembership(signed, keys.publicJwk)).toBe(true);
    const forged = { ...signed, membership: { ...signed.membership, role: 'admin' as const } };
    expect(await verifyMembership(forged, keys.publicJwk)).toBe(false);
  });
});
