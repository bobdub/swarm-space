import { put, get, getAll, openDB } from "./store";
import { signManifest } from "./p2p/replication";
import { shouldUseAdaptiveChunking, adaptiveChunkAndEncrypt } from "./torrent/adaptiveChunker";
import { getCurrentUser } from "./auth";
import { enqueueManifestForPersonalServers, fetchChunkFromPersonalServers } from './storage/providers/personalServerSync';
// Utility functions for ArrayBuffer/Base64 conversion
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}

function arrayBufferToHex(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}

// Generate a random file encryption key
export async function genFileKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

// Export key to base64
export async function exportKeyRaw(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return arrayBufferToBase64(raw);
}

// Import key from base64
export async function importKeyRaw(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    base64ToArrayBuffer(b64),
    "AES-GCM",
    true,
    ["encrypt", "decrypt"]
  );
}

// SEC-002: File key wrapping/unwrapping for the owner's at-rest copy.
//
// v2 (current): the file key is wrapped with a NON-EXTRACTABLE AES-GCM key
// generated on this device and kept in IndexedDB (`meta` store). Script can
// use it but never export its bytes, and it is never derived from anything a
// peer can see.
//
// v1 (legacy, read-only): the wrapping key was PBKDF2(userId, salt). Both the
// userId and the salt travel inside the public manifest, so any peer could
// re-derive it. We still unwrap v1 so nobody loses access to old files, and
// `backfillManifestRawKeys` re-wraps the owner's own v1 manifests as v2.

export const FILE_KEY_WRAP_VERSION = 2;

interface WrappedFileKey {
  wrapped: string; // base64 AES-GCM ciphertext of the raw file key
  iv: string;      // base64 IV
  salt?: string;   // base64 PBKDF2 salt (v1 only)
  version?: number;
}

const DEVICE_FILE_WRAP_PREFIX = 'file-key-wrap:';
const deviceWrapKeyCache = new Map<string, Promise<CryptoKey>>();

function deviceWrapOwner(): string {
  return getCurrentUser()?.id ?? 'local-default';
}

async function loadOrCreateDeviceWrapKey(owner: string, create: boolean): Promise<CryptoKey | null> {
  const metaKey = DEVICE_FILE_WRAP_PREFIX + owner;
  const existing = await get<{ k: string; v: unknown }>('meta', metaKey);
  // A JSON backup round-trip turns the CryptoKey into `{}`; treat that as missing.
  if (isUsableWrapKey(existing?.v)) return existing.v;
  if (!create) return null;
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable: the raw bytes never leave the browser's key store
    ['encrypt', 'decrypt']
  );
  await put('meta', { k: metaKey, v: key });
  return key;
}

function isUsableWrapKey(v: unknown): v is CryptoKey {
  return typeof CryptoKey !== 'undefined' && v instanceof CryptoKey
    && v.algorithm?.name === 'AES-GCM' && v.usages.includes('encrypt') && v.usages.includes('decrypt');
}

/** The device-held key that wraps file keys for the current user (created on first use). */
async function getDeviceWrapKey(create = true): Promise<CryptoKey | null> {
  const owner = deviceWrapOwner();
  const cached = deviceWrapKeyCache.get(owner);
  if (cached) return cached;
  const key = await loadOrCreateDeviceWrapKey(owner, create);
  if (key) deviceWrapKeyCache.set(owner, Promise.resolve(key));
  return key;
}

/** @internal test hook */
export function __resetFileKeyWrapCacheForTests(): void {
  deviceWrapKeyCache.clear();
}

/** v1 wrapping key — derived from the PUBLIC userId. Kept only to read old manifests. */
async function deriveLegacyFileKeyWrappingKey(salt: Uint8Array): Promise<CryptoKey> {
  const user = getCurrentUser();
  const secret = user?.id ?? 'local-default';
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw', enc.encode(secret), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 100_000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );
}

export async function wrapFileKeyForOwner(rawKeyB64: string): Promise<WrappedFileKey> {
  const wrappingKey = await getDeviceWrapKey(true);
  if (!wrappingKey) throw new Error('No device wrapping key available');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, wrappingKey, base64ToArrayBuffer(rawKeyB64)
  );
  return {
    wrapped: arrayBufferToBase64(ciphertext),
    iv: arrayBufferToBase64(iv.buffer),
    version: FILE_KEY_WRAP_VERSION,
  };
}

export async function unwrapFileKeyFromOwner(wrapped: WrappedFileKey): Promise<string> {
  const iv = new Uint8Array(base64ToArrayBuffer(wrapped.iv));
  let wrappingKey: CryptoKey | null;
  if ((wrapped.version ?? 1) >= 2) {
    wrappingKey = await getDeviceWrapKey(false);
    if (!wrappingKey) throw new Error('File key was wrapped on another device');
  } else {
    if (!wrapped.salt) throw new Error('Legacy wrapped key is missing its salt');
    wrappingKey = await deriveLegacyFileKeyWrappingKey(new Uint8Array(base64ToArrayBuffer(wrapped.salt)));
  }
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv }, wrappingKey, base64ToArrayBuffer(wrapped.wrapped)
  );
  return arrayBufferToBase64(plaintext);
}

/**
 * Import a file key from a manifest — handles three formats:
 * 1. fileKeyRaw (shared with peers for non-walled content)
 * 2. fileKeyWrapped + salt + iv (owner-only unwrap via SEC-002)
 * 3. Legacy raw fileKey (pre-SEC-002 manifests)
 */
export async function importFileKey(manifest: {
  fileKey?: string;
  fileKeyRaw?: string;
  fileKeyWrapped?: boolean;
  fileKeySalt?: string;
  fileKeyIv?: string;
  fileKeyWrapVersion?: number;
}): Promise<CryptoKey> {
  // 1. Peer-readable raw key (non-walled shared content)
  if (manifest.fileKeyRaw) {
    try {
      return await importKeyRaw(manifest.fileKeyRaw);
    } catch {
      // Fall through to other methods
    }
  }

  // 2. Owner-wrapped key (SEC-002; v2 device key, or legacy v1)
  if (manifest.fileKeyWrapped && manifest.fileKeyIv && manifest.fileKey) {
    try {
      const rawB64 = await unwrapFileKeyFromOwner({
        wrapped: manifest.fileKey,
        iv: manifest.fileKeyIv,
        salt: manifest.fileKeySalt,
        version: manifest.fileKeyWrapVersion,
      });
      return await importKeyRaw(rawB64);
    } catch {
      // Fall through to legacy
    }
    // A wrapped key is never a raw key; don't try to import it as one.
    throw new Error('Unable to unwrap file key');
  }

  // 3. Legacy: raw base64 key stored directly in fileKey
  if (manifest.fileKey) {
    return importKeyRaw(manifest.fileKey);
  }

  throw new Error('No valid file key found in manifest');
}

export interface ChunkMetadata {
  mime?: string;
  originalName?: string;
}

export interface Chunk {
  ref: string;
  seq: number;
  total: number;
  size: number;
  iv: string;
  cipher: string;
  meta: ChunkMetadata;
}

export interface Manifest {
  fileId: string;
  owner?: string;
  chunks: string[];
  mime: string;
  size: number;
  originalName: string;
  /** Wrapped (encrypted) file key — only the owner can unwrap via SEC-002 */
  fileKey?: string;
  /** Raw base64 file key — shared with peers for non-walled content decryption */
  fileKeyRaw?: string;
  /** Whether fileKey is wrapped (SEC-002) */
  fileKeyWrapped?: boolean;
  /** IV for key wrapping */
  fileKeyIv?: string;
  /** Salt for key wrapping (legacy v1 only) */
  fileKeySalt?: string;
  /** Wrapping scheme: 2 = device-held key; absent/1 = legacy userId-derived */
  fileKeyWrapVersion?: number;
  createdAt: string;
  /** Natural width of image/video media in pixels */
  mediaWidth?: number;
  /** Natural height of image/video media in pixels */
  mediaHeight?: number;
}

// Chunk and encrypt a file
export async function chunkAndEncryptFile(
  file: File,
  fileKey: CryptoKey,
  chunkSize: number = 1_048_576, // 1 MB per chunk
  onProgress?: (progress: number) => void
): Promise<Manifest> {
  // Route large files (>100MB) through adaptive stress-aware chunker
  if (shouldUseAdaptiveChunking(file.size)) {
    console.log(`[fileEncryption] Routing ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB) to adaptive chunker`);
    return adaptiveChunkAndEncrypt(file, fileKey, {
      onProgress: (p) => onProgress?.(p.percent),
    });
  }

  const chunkRefs: string[] = [];
  let seq = 0;
  let processedBytes = 0;
  const totalSize = file.size;

  // Read file in chunks
  let offset = 0;
  const fileBuffer = await file.arrayBuffer();
  while (offset < fileBuffer.byteLength) {
    const end = Math.min(offset + chunkSize, fileBuffer.byteLength);
    const slice = fileBuffer.slice(offset, end);
    
    // Encrypt chunk
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      fileKey,
      slice
    );
    
    const cipherB64 = arrayBufferToBase64(cipher);
    
    // Compute chunk ref (SHA-256 hash)
    const refHash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(cipherB64 + seq)
    );
    const ref = `chunk-${arrayBufferToHex(refHash)}`;
    
    // Create and store chunk object
    const chunkObj: Chunk = {
      ref,
      seq,
      total: 0, // will update after loop
      size: slice.byteLength,
      iv: arrayBufferToBase64(iv.buffer),
      cipher: cipherB64,
      meta: {
        mime: file.type,
        originalName: file.name
      }
    };
    
    await put("chunks", chunkObj);
    chunkRefs.push(ref);
    
    processedBytes += slice.byteLength;
    seq++;
    offset = end;
    
    // Report progress
    if (onProgress) {
      onProgress(Math.round((processedBytes / totalSize) * 100));
    }
  }
  
  // Update total count in all chunks
  for (const ref of chunkRefs) {
    const chunk = await get("chunks", ref) as Chunk;
    if (chunk) {
      chunk.total = chunkRefs.length;
      await put("chunks", chunk);
    }
  }
  
  // SEC-002: Wrap the file encryption key with this device's private wrapping
  // key for at-rest protection. Also store the raw key so peers on the mesh can decrypt shared content.
  const exportedKey = await exportKeyRaw(fileKey);
  const wrappedFileKey = await wrapFileKeyForOwner(exportedKey);

  // Create manifest — includes both wrapped (owner) and raw (peer) keys
  const manifest = {
    fileId: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    chunks: chunkRefs,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    originalName: file.name,
    fileKey: wrappedFileKey.wrapped,
    fileKeyRaw: exportedKey, // Raw key for peer decryption
    fileKeyIv: wrappedFileKey.iv,
    fileKeyWrapVersion: wrappedFileKey.version,
    fileKeyWrapped: true,
    createdAt: new Date().toISOString()
  };
  
  const signedManifest = await signManifest(manifest as import("@/lib/store").Manifest);
  await put("manifests", signedManifest);
  void enqueueManifestForPersonalServers(signedManifest);
  return signedManifest as Manifest;
}

// Decrypt and reassemble file from chunks
export async function decryptAndReassembleFile(
  manifest: Manifest,
  fileKey: CryptoKey,
  onProgress?: (progress: number) => void
): Promise<Blob> {
  const decryptedChunks: ArrayBuffer[] = [];
  
  for (let i = 0; i < manifest.chunks.length; i++) {
    const ref = manifest.chunks[i];
    const chunk = (await get("chunks", ref) as Chunk | undefined)
      ?? await fetchChunkFromPersonalServers(ref) as Chunk | null;
    
    if (!chunk) {
      throw new Error(`Chunk ${ref} not found`);
    }
    
    // Decrypt chunk
    const iv = new Uint8Array(base64ToArrayBuffer(chunk.iv));
    const cipherData = base64ToArrayBuffer(chunk.cipher);
    
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      fileKey,
      cipherData
    );
    
    decryptedChunks.push(decrypted);
    
    // Report progress
    if (onProgress) {
      onProgress(Math.round(((i + 1) / manifest.chunks.length) * 100));
    }
  }
  
  // Combine chunks into a single Blob
  return new Blob(decryptedChunks, { type: manifest.mime });
}

// Get all manifests
export async function getAllManifests(): Promise<Manifest[]> {
  return getAll("manifests") as Promise<Manifest[]>;
}

// Delete manifest and its chunks
export class EngravedFileError extends Error {
  constructor(public readonly coinId: string) {
    super("This file is engraved in a coin and can't be deleted");
    this.name = "EngravedFileError";
  }
}

export async function deleteManifest(fileId: string): Promise<void> {
  const manifest = await get("manifests", fileId) as Manifest & { _coinId?: string };
  if (!manifest) return;
  // Engraved files belong to their coin; deleting them would break the coin's content.
  if (manifest._coinId) throw new EngravedFileError(manifest._coinId);
  
  // Delete all chunks
  const db = await openDB();
  const tx = db.transaction("chunks", "readwrite");
  const store = tx.objectStore("chunks");
  
  for (const ref of manifest.chunks) {
    store.delete(ref);
  }
  
  await new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
  });
  
  // Delete manifest
  const manifestTx = db.transaction("manifests", "readwrite");
  manifestTx.objectStore("manifests").delete(fileId);
  
  await new Promise((resolve, reject) => {
    manifestTx.oncomplete = () => resolve(undefined);
    manifestTx.onerror = () => reject(tx.error);
  });
}

/**
 * Backfill existing manifests with fileKeyRaw, and re-wrap the owner's legacy
 * (v1, userId-derived) wrapped keys with this device's key (v2).
 * Manifests created before this fix only have the wrapped key, which
 * peers cannot decrypt. This unwraps the key using the current user's
 * identity and stores the raw key so it gets shared on next sync.
 */
export async function backfillManifestRawKeys(): Promise<number> {
  let upgraded = 0;
  try {
    const allManifests = await getAll('manifests') as Array<Record<string, unknown>>;
    for (const m of allManifests) {
      const isLegacyWrapped = Boolean(
        m.fileKeyWrapped && m.fileKeySalt && m.fileKeyIv && m.fileKey &&
        ((m.fileKeyWrapVersion as number | undefined) ?? 1) < 2
      );
      if (m.fileKeyRaw && !isLegacyWrapped) continue; // nothing to do
      if (!m.fileKeyWrapped) {
        // Legacy manifest — fileKey is already raw, just copy it
        if (m.fileKey && !m.fileKeyRaw) {
          await put('manifests', { ...m, fileKeyRaw: m.fileKey });
          upgraded++;
        }
        continue;
      }
      if (!isLegacyWrapped) continue;
      // Try to unwrap using current user's identity (only succeeds for our own manifests)
      let rawB64: string;
      try {
        rawB64 = await unwrapFileKeyFromOwner({
          wrapped: m.fileKey as string,
          iv: m.fileKeyIv as string,
          salt: m.fileKeySalt as string,
          version: 1,
        });
      } catch {
        continue; // Not our manifest — can't unwrap, skip
      }
      const next = await rewrapLegacyManifest(m, rawB64);
      await put('manifests', next);
      upgraded++;
    }
    if (upgraded > 0) {
      console.log(`[FileEncryption] ✅ Backfilled ${upgraded} manifests`);
    }
  } catch (err) {
    console.warn('[FileEncryption] Backfill failed:', err);
  }
  return upgraded;
}

/**
 * Replace a legacy v1 wrapped key with a v2 device-wrapped one. `fileKey` is part
 * of the signed manifest payload, so the manifest must be re-signed; if signing
 * isn't possible right now we only add fileKeyRaw (the previous behaviour) and
 * retry on the next backfill.
 */
async function rewrapLegacyManifest(
  m: Record<string, unknown>,
  rawB64: string,
): Promise<Record<string, unknown>> {
  const withRaw = { ...m, fileKeyRaw: (m.fileKeyRaw as string | undefined) ?? rawB64 };
  try {
    const wrapped = await wrapFileKeyForOwner(rawB64);
    const rewrapped: Record<string, unknown> = {
      ...withRaw,
      fileKey: wrapped.wrapped,
      fileKeyIv: wrapped.iv,
      fileKeyWrapVersion: wrapped.version,
      fileKeyWrapped: true,
    };
    delete rewrapped.fileKeySalt;
    return await signManifest(rewrapped as unknown as import('@/lib/store').Manifest) as unknown as Record<string, unknown>;
  } catch (err) {
    console.warn('[FileEncryption] Could not re-wrap legacy file key; will retry later', err);
    return withRaw;
  }
}
