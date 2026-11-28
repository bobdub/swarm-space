/**
 * Signer for synapse map records (`synapseExchanger.ts`).
 *
 * Members and guests sign with their identity P-256 key, so peers who know
 * them from the Connection Library can vouch for the record. When no identity
 * key is at hand (signed out, wallet locked, or a guest whose tab session no
 * longer holds its keys) the node signs with a key made for this tab: its
 * records still verify and stay pinned to it, they just never count as vouched.
 * Nobody is blocked from the map and nobody has to log in.
 *
 * The identity private key is only used to sign here; it never leaves the
 * device and is never exported.
 */
import type { SynapseSigner } from './synapseExchanger';

const ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const;

function toBase64(bytes: ArrayBuffer): string {
  let bin = '';
  for (const x of new Uint8Array(bytes)) bin += String.fromCharCode(x);
  return btoa(bin);
}

function fromBase64(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function signerFor(key: CryptoKey, publicKey: string): SynapseSigner {
  return {
    publicKey,
    sign: async (data) => new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data)),
  };
}

let identity: { userId: string; publicKey: string; signer: SynapseSigner } | null = null;
let tabSigner: Promise<SynapseSigner | null> | null = null;

async function identitySigner(): Promise<SynapseSigner | null> {
  const auth = await import('../auth');
  const user = auth.getCurrentUser();
  if (!user?.id || !user.publicKey) { identity = null; return null; }
  if (identity && identity.userId === user.id && identity.publicKey === user.publicKey) return identity.signer;
  const { isGuestUser, getGuestPrivateKey } = await import('../preview/guestMode');
  const privateKey = isGuestUser(user) ? getGuestPrivateKey(user.id) : await auth.getCachedPrivateKey();
  if (!privateKey || auth.getCurrentUser()?.id !== user.id) return null;
  const key = await crypto.subtle.importKey('pkcs8', fromBase64(privateKey), ECDSA, false, ['sign']);
  identity = { userId: user.id, publicKey: user.publicKey, signer: signerFor(key, user.publicKey) };
  return identity.signer;
}

function makeTabSigner(): Promise<SynapseSigner | null> {
  return (async () => {
    const pair = await crypto.subtle.generateKey(ECDSA, false, ['sign', 'verify']);
    const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
    return signerFor(pair.privateKey, toBase64(spki));
  })().catch(() => null);
}

/** Identity signer when available, else this tab's own key. */
export async function getSynapseSigner(): Promise<SynapseSigner | null> {
  try {
    const signer = await identitySigner();
    if (signer) return signer;
  } catch { /* fall back to the tab key */ }
  tabSigner ??= makeTabSigner();
  return tabSigner;
}

/** Test hook. */
export function _resetSynapseSignerForTests(): void {
  identity = null;
  tabSigner = null;
}
