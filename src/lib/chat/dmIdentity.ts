/**
 * Who is on the other end of a direct message.
 *
 * Every handshake (hello) carries a proof made with two signatures over the
 * same transcript: the sender's ephemeral ECDH key, its user id and both
 * mesh link ids, and a timestamp.
 *
 *  1. ECDSA P-256 by the account identity key. The user id is the hash of
 *     that public key, so only the account holder can produce it.
 *  2. EIP-191 by the account's cold wallet, the anchor of its namespace
 *     (`namespaceId = SHA256(userId, wallet)`, shown as `#discriminator`).
 *     The wallet is derived from the identity private key, so this proves
 *     the namespace belongs to the same holder.
 *
 * Binding both link ids stops a captured hello being replayed from another
 * link. A verified namespace is pinned per user id on this device; after
 * that, a hello for the same user that cannot prove the same namespace is
 * refused.
 *
 * History at rest is sealed with a per-account history key. That key is
 * wrapped (AES-KW) under a key-encryption key derived with HKDF from the
 * identity private key and the account's UQRC namespace coordinates, so it
 * opens only on an unlocked session of the same account and namespace.
 */
import { Wallet, verifyMessage } from 'ethers';
import { arrayBufferToBase64, base64ToArrayBuffer, computeUserId } from '../crypto';
import { canonicalJson } from '../utils/canonicalJson';
import { isPublicWalletAddress, namespaceIdentity, verifyNamespaceIdentity } from '../uqrc/namespaceIdentity';

/** How far a hello's timestamp may be from ours. */
export const HELLO_MAX_SKEW_MS = 10 * 60_000;

export interface DmHelloProof {
  identityKey: string;
  walletAddress: string;
  namespaceId: string;
  discriminator: string;
  fromPeerId: string;
  toPeerId: string;
  ts: number;
  sig: string;
  walletSig: string;
}

export interface DmNamespace {
  userId: string;
  identityKey: string;
  walletAddress: string;
  namespaceId: string;
  discriminator: string;
}

/** Signs handshakes for the local account while its keys are unlocked. */
export interface DmSigner extends DmNamespace {
  signIdentity(data: Uint8Array): Promise<string>;
  signWallet(message: string): Promise<string>;
  /** Raw identity private key material (PKCS#8, base64) for deriving the history KEK. */
  keyMaterial: string;
}

export function helloTranscript(t: {
  userId: string;
  pub: string;
  walletAddress: string;
  namespaceId: string;
  fromPeerId: string;
  toPeerId: string;
  ts: number;
}): string {
  return canonicalJson({
    v: 'swarm-dm-hello-v2',
    userId: t.userId,
    pub: t.pub,
    walletAddress: t.walletAddress.toLowerCase(),
    namespaceId: t.namespaceId,
    fromPeerId: t.fromPeerId,
    toPeerId: t.toPeerId,
    ts: t.ts,
  });
}

/** Build a signer from an account's identity key pair (base64 SPKI / PKCS#8). */
export async function createDmSigner(opts: {
  userId: string;
  identityPublicKey: string;
  identityPrivateKey: string;
  wallet: Pick<Wallet, 'address' | 'signMessage'>;
}): Promise<DmSigner> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    base64ToArrayBuffer(opts.identityPrivateKey),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const ns = await namespaceIdentity(opts.userId, opts.wallet.address);
  return {
    userId: opts.userId,
    identityKey: opts.identityPublicKey,
    walletAddress: opts.wallet.address,
    namespaceId: ns.namespaceId,
    discriminator: ns.discriminator,
    keyMaterial: opts.identityPrivateKey,
    async signIdentity(data) {
      const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, data);
      return arrayBufferToBase64(sig);
    },
    signWallet: (message) => opts.wallet.signMessage(message),
  };
}

export async function createHelloProof(
  signer: DmSigner,
  t: { pub: string; fromPeerId: string; toPeerId: string; ts?: number },
): Promise<DmHelloProof> {
  const ts = t.ts ?? Date.now();
  const transcript = helloTranscript({
    userId: signer.userId,
    pub: t.pub,
    walletAddress: signer.walletAddress,
    namespaceId: signer.namespaceId,
    fromPeerId: t.fromPeerId,
    toPeerId: t.toPeerId,
    ts,
  });
  const [sig, walletSig] = await Promise.all([
    signer.signIdentity(new TextEncoder().encode(transcript)),
    signer.signWallet(transcript),
  ]);
  return {
    identityKey: signer.identityKey,
    walletAddress: signer.walletAddress,
    namespaceId: signer.namespaceId,
    discriminator: signer.discriminator,
    fromPeerId: t.fromPeerId,
    toPeerId: t.toPeerId,
    ts,
    sig,
    walletSig,
  };
}

/** Shape-check a proof from the wire. */
export function parseHelloProof(raw: unknown): DmHelloProof | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const str = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;
  if (!str(p.identityKey, 1024) || !str(p.namespaceId, 128) || !str(p.discriminator, 32)) return null;
  if (!isPublicWalletAddress(p.walletAddress)) return null;
  if (!str(p.fromPeerId, 200) || !str(p.toPeerId, 200) || !str(p.sig, 512) || !str(p.walletSig, 200)) return null;
  if (typeof p.ts !== 'number' || !Number.isFinite(p.ts)) return null;
  return p as unknown as DmHelloProof;
}

/**
 * Check a hello proof against what the transport tells us: the link it
 * arrived on and our own link id. Returns the proven namespace, or null.
 */
export async function verifyHelloProof(
  proof: DmHelloProof,
  claim: { userId: string; pub: string; transportPeerId: string; selfPeerId: string | undefined },
  now: number = Date.now(),
): Promise<DmNamespace | null> {
  try {
    if (proof.fromPeerId !== claim.transportPeerId) return null;
    if (claim.selfPeerId && proof.toPeerId !== claim.selfPeerId) return null;
    if (Math.abs(now - proof.ts) > HELLO_MAX_SKEW_MS) return null;
    if ((await computeUserId(proof.identityKey)) !== claim.userId) return null;
    if (!(await verifyNamespaceIdentity(claim.userId, proof.walletAddress, proof.namespaceId, proof.discriminator))) return null;
    const transcript = helloTranscript({
      userId: claim.userId,
      pub: claim.pub,
      walletAddress: proof.walletAddress,
      namespaceId: proof.namespaceId,
      fromPeerId: proof.fromPeerId,
      toPeerId: proof.toPeerId,
      ts: proof.ts,
    });
    const key = await crypto.subtle.importKey(
      'spki',
      base64ToArrayBuffer(proof.identityKey),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      base64ToArrayBuffer(proof.sig),
      new TextEncoder().encode(transcript),
    );
    if (!ok) return null;
    if (verifyMessage(transcript, proof.walletSig).toLowerCase() !== proof.walletAddress.toLowerCase()) return null;
    return {
      userId: claim.userId,
      identityKey: proof.identityKey,
      walletAddress: proof.walletAddress,
      namespaceId: proof.namespaceId.toLowerCase(),
      discriminator: proof.discriminator.toLowerCase(),
    };
  } catch {
    return null;
  }
}

// ── History key wrapping ─────────────────────────────────────────────

/** The KEK for an account's DM history: HKDF(identity key, namespace coordinates). */
async function deriveHistoryKek(signer: DmSigner): Promise<CryptoKey> {
  const ikm = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`swarm-dm-kek-v1|${signer.keyMaterial}`),
  );
  const hkdf = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(`swarm-uqrc-namespace|${signer.namespaceId}`),
      info: new TextEncoder().encode(`swarm-dm-history|${signer.userId}|${signer.walletAddress.toLowerCase()}`),
    },
    hkdf,
    { name: 'AES-KW', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  );
}

/**
 * Open (or create) the account's history key. `wrapped` is the stored,
 * AES-KW wrapped key; a new one is returned to store when none exists yet.
 */
export async function openHistoryKey(
  signer: DmSigner,
  wrapped: string | undefined,
): Promise<{ key: CryptoKey; wrapped: string; created: boolean }> {
  const kek = await deriveHistoryKek(signer);
  if (wrapped) {
    const key = await crypto.subtle.unwrapKey(
      'raw',
      base64ToArrayBuffer(wrapped),
      kek,
      'AES-KW',
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    return { key, wrapped, created: false };
  }
  const fresh = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const out = arrayBufferToBase64(await crypto.subtle.wrapKey('raw', fresh, kek, 'AES-KW'));
  // Re-import non-extractable so the raw history key never sits in the heap.
  const key = await crypto.subtle.unwrapKey(
    'raw',
    base64ToArrayBuffer(out),
    kek,
    'AES-KW',
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  return { key, wrapped: out, created: true };
}

export interface SealedText {
  iv: string;
  ct: string;
}

function sealAad(id: string, conversationId: string): Uint8Array {
  return new TextEncoder().encode(`swarm-dm-at-rest-v1|${id}|${conversationId}`);
}

export async function sealText(key: CryptoKey, id: string, conversationId: string, text: string): Promise<SealedText> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: sealAad(id, conversationId) },
    key,
    new TextEncoder().encode(text),
  );
  return { iv: arrayBufferToBase64(iv.buffer), ct: arrayBufferToBase64(ct) };
}

export async function openText(key: CryptoKey, id: string, conversationId: string, sealed: SealedText): Promise<string> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(base64ToArrayBuffer(sealed.iv)), additionalData: sealAad(id, conversationId) },
    key,
    base64ToArrayBuffer(sealed.ct),
  );
  return new TextDecoder().decode(plain);
}

/** The app's signer for the signed-in account, or null while its keys are locked. */
export async function loadAppDmSigner(userId: string, identityPublicKey: string | undefined): Promise<DmSigner | null> {
  if (!identityPublicKey) return null;
  try {
    const [{ getCachedPrivateKey }, { deriveColdKey }] = await Promise.all([
      import('../auth'),
      import('../blockchain/wallets/coldKey'),
    ]);
    const privateKey = await getCachedPrivateKey();
    if (!privateKey) return null;
    const { wallet } = await deriveColdKey(userId);
    return await createDmSigner({ userId, identityPublicKey, identityPrivateKey: privateKey, wallet });
  } catch {
    return null;
  }
}
