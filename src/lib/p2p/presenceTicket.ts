import { sha256 } from '../crypto';
import { canonicalJson, canonicalJsonBytes } from '../utils/canonicalJson';

const textEncoder = new TextEncoder();

export const DEFAULT_TICKET_TTL_MS = 3 * 60 * 1000; // 3 minutes
export const DEFAULT_CLOCK_SKEW_MS = 15 * 1000; // 15 seconds tolerance

export type PresenceTicketAlgorithm = 'ed25519';

export interface PresenceTicketPayload {
  peerId: string;
  userId: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

export interface PresenceTicketEnvelope {
  version: 1;
  algorithm: PresenceTicketAlgorithm;
  publicKey: string;
  signature: string; // base64 encoded signature
  payload: PresenceTicketPayload;
}

export type SignatureBytes = Uint8Array | ArrayBufferLike;

export interface PresenceTicketSigner {
  algorithm: PresenceTicketAlgorithm;
  publicKey: string;
  sign(payload: Uint8Array): Promise<SignatureBytes>;
}

export type SignatureVerifier = (
  payload: Uint8Array,
  signature: Uint8Array,
  publicKey: string
) => Promise<boolean>;

export interface CreatePresenceTicketOptions {
  peerId: string;
  userId: string;
  signer: PresenceTicketSigner;
  ttlMs?: number;
  now?: number;
  nonce?: string;
}

export type PresenceTicketValidationError =
  | 'EXPIRED'
  | 'NOT_YET_VALID'
  | 'PEER_ID_MISMATCH'
  | 'USER_ID_MISMATCH'
  | 'SIGNATURE_INVALID'
  | 'UNSUPPORTED_ALGORITHM'
  | 'UNTRUSTED_PUBLIC_KEY';

export interface VerifyPresenceTicketOptions {
  verifier?: SignatureVerifier;
  now?: number;
  allowClockSkewMs?: number;
  expectedPeerId?: string;
  expectedUserId?: string;
  trustedPublicKeys?: string[];
}

export interface PresenceTicketValidationResult {
  ok: boolean;
  reason?: PresenceTicketValidationError;
}

/**
 * Create and sign a presence ticket envelope using the provided signer.
 */
export async function createPresenceTicket(
  options: CreatePresenceTicketOptions
): Promise<PresenceTicketEnvelope> {
  const { peerId, userId, signer } = options;
  const issuedAt = Math.floor(options.now ?? Date.now());
  const ttl = options.ttlMs ?? DEFAULT_TICKET_TTL_MS;
  const expiresAt = issuedAt + ttl;
  const nonce = options.nonce ?? generateNonce();

  const payload: PresenceTicketPayload = {
    peerId,
    userId,
    issuedAt,
    expiresAt,
    nonce
  };

  const payloadBytes = encodePayload(payload);
  const signatureBytes = await signer.sign(payloadBytes);
  const signature = toBase64(signatureBytes);

  return {
    version: 1,
    algorithm: signer.algorithm,
    publicKey: signer.publicKey,
    signature,
    payload
  };
}

/**
 * Verify the authenticity and validity of a presence ticket envelope.
 */
export async function verifyPresenceTicket(
  envelope: PresenceTicketEnvelope,
  options: VerifyPresenceTicketOptions = {}
): Promise<PresenceTicketValidationResult> {
  const { payload } = envelope;
  const now = options.now ?? Date.now();
  const skew = options.allowClockSkewMs ?? DEFAULT_CLOCK_SKEW_MS;

  if (payload.expiresAt + skew < now) {
    return { ok: false, reason: 'EXPIRED' };
  }

  if (payload.issuedAt - skew > now) {
    return { ok: false, reason: 'NOT_YET_VALID' };
  }

  if (options.expectedPeerId && payload.peerId !== options.expectedPeerId) {
    return { ok: false, reason: 'PEER_ID_MISMATCH' };
  }

  if (options.expectedUserId && payload.userId !== options.expectedUserId) {
    return { ok: false, reason: 'USER_ID_MISMATCH' };
  }

  if (
    options.trustedPublicKeys &&
    !options.trustedPublicKeys.includes(envelope.publicKey)
  ) {
    return { ok: false, reason: 'UNTRUSTED_PUBLIC_KEY' };
  }

  const verifier = options.verifier ?? getDefaultVerifier(envelope.algorithm);
  if (!verifier) {
    return { ok: false, reason: 'UNSUPPORTED_ALGORITHM' };
  }

  const payloadBytes = encodePayload(payload);
  const signatureBytes = fromBase64(envelope.signature);

  try {
    const isValid = await verifier(payloadBytes, signatureBytes, envelope.publicKey);
    return isValid
      ? { ok: true }
      : { ok: false, reason: 'SIGNATURE_INVALID' };
  } catch (error) {
    console.warn('[PresenceTicket] Signature verification failed:', error);
    return { ok: false, reason: 'SIGNATURE_INVALID' };
  }
}

/**
 * Verify a detached signature over arbitrary data using the same algorithm as tickets.
 */
export async function verifyDetachedSignature(
  data: Uint8Array | string,
  signature: string,
  algorithm: PresenceTicketAlgorithm,
  publicKey: string,
  verifier?: SignatureVerifier
): Promise<boolean> {
  const bytes = typeof data === 'string' ? textEncoder.encode(data) : data;
  const sigBytes = fromBase64(signature);
  const verify = verifier ?? getDefaultVerifier(algorithm);
  if (!verify) {
    throw new Error(`Unsupported algorithm: ${algorithm}`);
  }
  return verify(bytes, sigBytes, publicKey);
}

/**
 * Create a ticket signer backed by Web Crypto Ed25519 keys.
 *
 * @throws Error if the runtime does not support Ed25519 signing.
 */
export async function createEd25519Signer(
  privateKey: CryptoKey,
  publicKey: string
): Promise<PresenceTicketSigner> {
  assertEd25519Support();
  return {
    algorithm: 'ed25519',
    publicKey,
    async sign(payload: Uint8Array) {
      // Create a new Uint8Array to ensure we have a proper ArrayBuffer
      const data = new Uint8Array(payload);
      const signature = await crypto.subtle.sign('Ed25519', privateKey, data);
      return signature;
    }
  };
}

/**
 * Construct a signature verifier for Ed25519 that uses Web Crypto.
 */
export function createEd25519Verifier(): SignatureVerifier {
  assertEd25519Support();
  return async (payload, signature, publicKey) => {
    const key = await importEd25519PublicKey(publicKey);
    // Create new Uint8Arrays to ensure proper ArrayBuffers
    const sig = new Uint8Array(signature);
    const pay = new Uint8Array(payload);
    return crypto.subtle.verify('Ed25519', key, sig, pay);
  };
}

function getDefaultVerifier(
  algorithm: PresenceTicketAlgorithm
): SignatureVerifier | null {
  if (algorithm === 'ed25519') {
    try {
      return createEd25519Verifier();
    } catch (error) {
      console.warn('[PresenceTicket] Ed25519 not supported in this runtime:', error);
      return null;
    }
  }
  return null;
}

function encodePayload(payload: PresenceTicketPayload): Uint8Array {
  return canonicalJsonBytes(payload);
}

function generateNonce(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return toBase64(bytes);
}

function toBase64(data: SignatureBytes): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (typeof btoa === 'function') {
    let binary = '';
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  throw new Error('Base64 conversion not supported in this environment');
}

function fromBase64(value: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(value, 'base64'));
  }
  throw new Error('Base64 conversion not supported in this environment');
}

async function importEd25519PublicKey(publicKey: string): Promise<CryptoKey> {
  const keyData = fromBase64(publicKey);
  // Create a new Uint8Array to ensure proper ArrayBuffer
  const data = new Uint8Array(keyData);
  return crypto.subtle.importKey(
    'raw',
    data,
    { name: 'Ed25519' },
    false,
    ['verify']
  );
}

function assertEd25519Support(): void {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Web Crypto not available');
  }
  if (typeof crypto.subtle.importKey !== 'function') {
    throw new Error('Web Crypto Ed25519 support missing');
  }
}

export async function hashPresenceTicket(
  envelope: PresenceTicketEnvelope
): Promise<string> {
  const canonical = canonicalJson(envelope);
  const bytes = textEncoder.encode(canonical);
  return sha256(bytes);
}
