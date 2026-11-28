import { afterEach, describe, expect, it, vi } from 'vitest';
import { _resetSynapseSignerForTests, getSynapseSigner } from '../synapseSigner';
import { synapseSignerUserId, buildManifoldRecord, verifyManifoldRecord } from '../synapseExchanger';

const authState: { user: { id: string; publicKey: string; _guest?: boolean } | null; privateKey: string | null } = { user: null, privateKey: null };
const guestKeys: Record<string, string> = {};

vi.mock('../../auth', () => ({
  getCurrentUser: () => authState.user,
  getCachedPrivateKey: async () => authState.privateKey,
}));
vi.mock('../../preview/guestMode', () => ({
  isGuestUser: (u: { _guest?: boolean } | null) => !!u?._guest,
  getGuestPrivateKey: (id: string) => guestKeys[id] ?? null,
}));

const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));

/** An identity key pair as accounts make it (ECDH P-256, spki + pkcs8). */
async function identityKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  return {
    publicKey: b64(await crypto.subtle.exportKey('spki', pair.publicKey)),
    privateKey: b64(await crypto.subtle.exportKey('pkcs8', pair.privateKey)),
  };
}

async function signedBy(signer: NonNullable<Awaited<ReturnType<typeof getSynapseSigner>>>) {
  const raw = (await buildManifoldRecord({ peerId: 'peer-a', at: Date.now(), conns: 0, phi: null, edges: [] }, signer))!;
  return verifyManifoldRecord(raw, 'peer-a', Date.now(), await synapseSignerUserId(signer.publicKey));
}

describe('synapse signer', () => {
  afterEach(() => {
    _resetSynapseSignerForTests();
    authState.user = null;
    authState.privateKey = null;
    for (const k of Object.keys(guestKeys)) delete guestKeys[k];
  });

  it('signs with a member identity key, so the library can vouch for it', async () => {
    const keys = await identityKeys();
    authState.user = { id: 'member', publicKey: keys.publicKey };
    authState.privateKey = keys.privateKey;
    const signer = (await getSynapseSigner())!;
    expect(signer.publicKey).toBe(keys.publicKey);
    expect((await signedBy(signer))?.vouched).toBe(true);
  });

  it('signs with a guest identity key without any login', async () => {
    const keys = await identityKeys();
    authState.user = { id: 'guest', publicKey: keys.publicKey, _guest: true };
    guestKeys.guest = keys.privateKey;
    const signer = (await getSynapseSigner())!;
    expect(signer.publicKey).toBe(keys.publicKey);
    expect((await signedBy(signer))?.vouched).toBe(true);
  });

  it('falls back to a tab key when no identity key is at hand', async () => {
    const keys = await identityKeys();
    authState.user = { id: 'locked', publicKey: keys.publicKey };
    const signer = (await getSynapseSigner())!;
    expect(signer.publicKey).not.toBe(keys.publicKey);
    expect(await signedBy(signer)).not.toBeNull();
    expect((await getSynapseSigner())!.publicKey).toBe(signer.publicKey);
    authState.user = null;
    expect((await getSynapseSigner())!.publicKey).toBe(signer.publicKey);
  });
});
