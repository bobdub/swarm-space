/**
 * Signaling Envelope Encryption
 * 
 * Encrypts WebRTC signaling payloads (offer, answer, ICE) with a shared
 * secret derived from ephemeral ECDH key exchange. The PeerJS relay sees
 * only opaque ciphertext — it cannot inspect SDP contents, IP addresses,
 * or DTLS fingerprints.
 * 
 * Protocol:
 *   1. Each peer generates an ephemeral ECDH P-256 keypair on boot
 *   2. The public key is included in `announce` messages (non-sensitive)
 *   3. On receiving a peer's public key, derive a shared AES-256-GCM key
 *      via ECDH + HKDF
 *   4. All subsequent offer/answer/ice payloads are encrypted with this key
 *   5. Falls back to plaintext for peers that don't include a public key
 *      (backward compat)
 */

import { arrayBufferToBase64, base64ToArrayBuffer } from '../crypto';

// ── Types ──

export interface SignalingEnvelopeKeys {
  publicKeyB64: string;
  privateKey: CryptoKey;
}

export interface EncryptedEnvelope {
  __encrypted: true;
  ciphertext: string; // base64
  iv: string;         // base64
}

// ── Ephemeral keypair ──

let ephemeralKeys: SignalingEnvelopeKeys | null = null;
const peerSharedKeys = new Map<string, CryptoKey>();

/**
 * Generate (or retrieve) the session-ephemeral ECDH keypair used for
 * signaling encryption. Called once per session.
 */
export async function getOrCreateEphemeralKeys(): Promise<SignalingEnvelopeKeys> {
  if (ephemeralKeys) return ephemeralKeys;

  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false, // private key non-exportable
    ['deriveBits']
  );

  const pubRaw = await crypto.subtle.exportKey('raw', keyPair.publicKey);

  ephemeralKeys = {
    publicKeyB64: arrayBufferToBase64(pubRaw),
    privateKey: keyPair.privateKey,
  };

  return ephemeralKeys;
}

/**
 * Derive a shared AES-256-GCM key from our private key + peer's public key.
 * Result is cached per peer.
 */
export async function deriveSharedKey(peerId: string, peerPublicKeyB64: string): Promise<CryptoKey> {
  const existing = peerSharedKeys.get(peerId);
  if (existing) return existing;

  const keys = await getOrCreateEphemeralKeys();

  // Import peer's raw public key
  const peerPubBuf = base64ToArrayBuffer(peerPublicKeyB64);
  const peerPubKey = await crypto.subtle.importKey(
    'raw',
    peerPubBuf,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    []
  );

  // Derive shared bits
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerPubKey },
    keys.privateKey,
    256
  );

  // HKDF to produce AES key
  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    sharedBits,
    'HKDF',
    false,
    ['deriveKey']
  );

  const aesKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode('swarm-signaling-v1'),
      info: new TextEncoder().encode('signaling-envelope'),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  peerSharedKeys.set(peerId, aesKey);
  return aesKey;
}

/**
 * Encrypt a signaling payload for a specific peer.
 */
export async function encryptSignalingPayload(
  peerId: string,
  payload: unknown
): Promise<EncryptedEnvelope | null> {
  const key = peerSharedKeys.get(peerId);
  if (!key) return null; // no shared key yet — send plaintext

  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(payload));

    const cipherBuf = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      plaintext
    );

    return {
      __encrypted: true,
      ciphertext: arrayBufferToBase64(cipherBuf),
      iv: arrayBufferToBase64(iv.buffer as ArrayBuffer),
    };
  } catch (err) {
    console.warn('[SignalingEnvelope] Encryption failed, falling back to plaintext', err);
    return null;
  }
}

/**
 * Decrypt an encrypted signaling payload from a peer.
 */
export async function decryptSignalingPayload(
  peerId: string,
  envelope: EncryptedEnvelope
): Promise<unknown | null> {
  const key = peerSharedKeys.get(peerId);
  if (!key) {
    console.warn('[SignalingEnvelope] No shared key for peer', peerId);
    return null;
  }

  try {
    const iv = new Uint8Array(base64ToArrayBuffer(envelope.iv));
    const cipherBuf = base64ToArrayBuffer(envelope.ciphertext);

    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      cipherBuf
    );

    return JSON.parse(new TextDecoder().decode(plainBuf));
  } catch (err) {
    console.warn('[SignalingEnvelope] Decryption failed', err);
    return null;
  }
}

/**
 * Check if a payload is an encrypted envelope.
 */
export function isEncryptedEnvelope(payload: unknown): payload is EncryptedEnvelope {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as EncryptedEnvelope).__encrypted === true &&
    typeof (payload as EncryptedEnvelope).ciphertext === 'string'
  );
}

/**
 * Remove cached shared key for a peer (on disconnect).
 */
export function clearPeerKey(peerId: string): void {
  peerSharedKeys.delete(peerId);
}
