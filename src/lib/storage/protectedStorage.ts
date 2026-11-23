/**
 * Protected Storage Layer
 * Makes local IndexedDB data effectively read-only by encrypting with HMAC integrity checks
 * Data can only be read/written by the user who owns the encryption keys
 */

import { put, get } from '../store';
import { base64ToArrayBuffer, arrayBufferToBase64 } from '../crypto';

export interface ProtectedRecord<T> {
  id: string;
  encryptedData: string;
  hmac: string; // HMAC for tamper detection
  version: number;
  timestamp: number;
}

/**
 * Record versions:
 *  - v1 (legacy, read-only): PBKDF2 with fixed salts "swarm-storage-v1" / "swarm-hmac-v1".
 *  - v2 (current): a fresh random 16-byte salt per record, stored next to the IV.
 */
const LEGACY_STORAGE_SALT = new TextEncoder().encode("swarm-storage-v1");
const LEGACY_HMAC_SALT = new TextEncoder().encode("swarm-hmac-v1");
const RECORD_VERSION = 2;
const SALT_BYTES = 16;

/** Keep the AES and HMAC derivations apart even though they share a per-record salt. */
function domainSalt(salt: Uint8Array, label: "enc" | "mac"): Uint8Array {
  const tag = new TextEncoder().encode(`swarm-protected-v2:${label}:`);
  const out = new Uint8Array(tag.length + salt.length);
  out.set(tag, 0);
  out.set(salt, tag.length);
  return out;
}

interface EncryptedPayload { cipher: string; iv: string; salt?: string }

function saltsFor(record: ProtectedRecord<unknown>, encData: EncryptedPayload): { enc: Uint8Array; mac: Uint8Array } {
  if ((record.version ?? 1) >= 2) {
    if (!encData.salt) throw new Error("Protected record v2 is missing its salt");
    const salt = new Uint8Array(base64ToArrayBuffer(encData.salt));
    return { enc: domainSalt(salt, "enc"), mac: domainSalt(salt, "mac") };
  }
  return { enc: LEGACY_STORAGE_SALT, mac: LEGACY_HMAC_SALT };
}

/**
 * Derive a storage encryption key from user's private key
 * This ensures only the key holder can decrypt stored data
 */
async function deriveStorageKey(userPrivateKey: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    base64ToArrayBuffer(userPrivateKey),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Derive an HMAC key for integrity verification
 */
async function deriveHMACKey(userPrivateKey: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    base64ToArrayBuffer(userPrivateKey),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: 100000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/**
 * Store data in protected (encrypted + HMAC) format
 * Data is encrypted so it cannot be read via browser DevTools
 * HMAC ensures tamper detection if someone modifies the encrypted data
 * 
 * @param storeName - IndexedDB store name
 * @param id - Record identifier
 * @param data - Data to protect
 * @param userPrivateKey - User's private key (base64 PKCS8 format)
 */
export async function putProtected<T>(
  storeName: string,
  id: string,
  data: T,
  userPrivateKey: string
): Promise<void> {
  // 1. Derive storage key from user's private key and a fresh per-record salt
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const storageKey = await deriveStorageKey(userPrivateKey, domainSalt(salt, "enc"));
  
  // 2. Encrypt data with AES-GCM
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    storageKey,
    plaintext
  );
  
  // 3. Calculate HMAC over encrypted data for integrity
  const hmacKey = await deriveHMACKey(userPrivateKey, domainSalt(salt, "mac"));
  const hmac = await crypto.subtle.sign(
    "HMAC",
    hmacKey,
    encrypted
  );
  
  // 4. Create protected record
  const record: ProtectedRecord<T> = {
    id,
    encryptedData: JSON.stringify({
      cipher: arrayBufferToBase64(encrypted),
      iv: arrayBufferToBase64(iv.buffer),
      salt: arrayBufferToBase64(salt.buffer)
    } satisfies EncryptedPayload),
    hmac: arrayBufferToBase64(hmac),
    version: RECORD_VERSION,
    timestamp: Date.now()
  };
  
  // 5. Store in IndexedDB
  await put(storeName, record);
}

/**
 * Read protected data with integrity verification
 * 
 * @param storeName - IndexedDB store name
 * @param id - Record identifier
 * @param userPrivateKey - User's private key (base64 PKCS8 format)
 * @returns Decrypted data or null if not found/tampered
 */
export async function getProtected<T>(
  storeName: string,
  id: string,
  userPrivateKey: string
): Promise<T | null> {
  // 1. Fetch protected record
  const record = await get<ProtectedRecord<T>>(storeName, id);
  if (!record) {
    return null;
  }
  
  // 2. Parse encrypted data
  const encData = JSON.parse(record.encryptedData) as EncryptedPayload;
  const encryptedBuffer = base64ToArrayBuffer(encData.cipher);
  const salts = saltsFor(record, encData);
  
  // 3. Verify HMAC to detect tampering
  const hmacKey = await deriveHMACKey(userPrivateKey, salts.mac);
  const valid = await crypto.subtle.verify(
    "HMAC",
    hmacKey,
    base64ToArrayBuffer(record.hmac),
    encryptedBuffer
  );
  
  if (!valid) {
    console.error(`[Protected Storage] HMAC verification failed for ${storeName}/${id}`);
    console.error('[Protected Storage] Data may have been tampered with - rejecting');
    return null;
  }
  
  // 4. Decrypt data
  const storageKey = await deriveStorageKey(userPrivateKey, salts.enc);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToArrayBuffer(encData.iv) },
    storageKey,
    encryptedBuffer
  );
  
  // 5. Parse; migrate legacy fixed-salt records to v2 on the way out
  const data = JSON.parse(new TextDecoder().decode(decrypted)) as T;
  if ((record.version ?? 1) < RECORD_VERSION) {
    try {
      await putProtected(storeName, id, data, userPrivateKey);
    } catch (error) {
      console.warn(`[Protected Storage] Could not migrate ${storeName}/${id} to v2`, error);
    }
  }
  return data;
}

/**
 * Check if a protected record exists and has valid integrity
 * Does not decrypt the data, only verifies HMAC
 * 
 * @param storeName - IndexedDB store name
 * @param id - Record identifier
 * @param userPrivateKey - User's private key (base64 PKCS8 format)
 * @returns true if record exists and is valid
 */
export async function verifyProtected(
  storeName: string,
  id: string,
  userPrivateKey: string
): Promise<boolean> {
  const record = await get<ProtectedRecord<unknown>>(storeName, id);
  if (!record) {
    return false;
  }
  
  try {
    const encData = JSON.parse(record.encryptedData) as EncryptedPayload;
    const hmacKey = await deriveHMACKey(userPrivateKey, saltsFor(record, encData).mac);
    
    return await crypto.subtle.verify(
      "HMAC",
      hmacKey,
      base64ToArrayBuffer(record.hmac),
      base64ToArrayBuffer(encData.cipher)
    );
  } catch (error) {
    console.error('[Protected Storage] Verification failed:', error);
    return false;
  }
}

/**
 * Re-encrypt protected data with a new key
 * Useful for key rotation scenarios
 * 
 * @param storeName - IndexedDB store name
 * @param id - Record identifier
 * @param oldPrivateKey - Current private key
 * @param newPrivateKey - New private key
 */
export async function reencryptProtected<T>(
  storeName: string,
  id: string,
  oldPrivateKey: string,
  newPrivateKey: string
): Promise<void> {
  // 1. Decrypt with old key
  const data = await getProtected<T>(storeName, id, oldPrivateKey);
  if (!data) {
    throw new Error(`Cannot re-encrypt: record ${storeName}/${id} not found or invalid`);
  }
  
  // 2. Encrypt with new key
  await putProtected(storeName, id, data, newPrivateKey);
}

/**
 * Batch operations for efficiency
 */

export async function putProtectedBatch<T>(
  storeName: string,
  records: Array<{ id: string; data: T }>,
  userPrivateKey: string
): Promise<void> {
  await Promise.all(
    records.map(({ id, data }) => 
      putProtected(storeName, id, data, userPrivateKey)
    )
  );
}

export async function getProtectedBatch<T>(
  storeName: string,
  ids: string[],
  userPrivateKey: string
): Promise<Array<T | null>> {
  return Promise.all(
    ids.map(id => getProtected<T>(storeName, id, userPrivateKey))
  );
}
