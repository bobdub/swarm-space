import { put, get, getAll, openDB } from "./store";
import { signManifest } from "./p2p/replication";
import { shouldUseAdaptiveChunking, adaptiveChunkAndEncrypt } from "./torrent/adaptiveChunker";
import { getCurrentUser } from "./auth";
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

// SEC-002: File key wrapping/unwrapping using the owner's passphrase-derived key
// The key is wrapped with a deterministic key derived from the user's identity
// so only the local owner can decrypt files. Peers receive manifests but cannot
// access the raw AES key without the owner's session.

interface WrappedFileKey {
  wrapped: string; // base64 AES-GCM ciphertext of the raw file key
  iv: string;      // base64 IV
  salt: string;    // base64 salt for PBKDF2
}

async function deriveFileKeyWrappingKey(salt: Uint8Array): Promise<CryptoKey> {
  // Use the owner's userId as the wrapping secret — available in session
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
    ['encrypt', 'decrypt']
  );
}

async function wrapFileKeyForOwner(rawKeyB64: string): Promise<WrappedFileKey> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrappingKey = await deriveFileKeyWrappingKey(salt);
  const plaintext = base64ToArrayBuffer(rawKeyB64);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, wrappingKey, plaintext
  );
  return {
    wrapped: arrayBufferToBase64(ciphertext),
    iv: arrayBufferToBase64(iv.buffer),
    salt: arrayBufferToBase64(salt.buffer),
  };
}

async function unwrapFileKeyFromOwner(wrapped: WrappedFileKey): Promise<string> {
  const salt = new Uint8Array(base64ToArrayBuffer(wrapped.salt));
  const iv = new Uint8Array(base64ToArrayBuffer(wrapped.iv));
  const wrappingKey = await deriveFileKeyWrappingKey(salt);
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
}): Promise<CryptoKey> {
  // 1. Peer-readable raw key (non-walled shared content)
  if (manifest.fileKeyRaw) {
    try {
      return await importKeyRaw(manifest.fileKeyRaw);
    } catch {
      // Fall through to other methods
    }
  }

  // 2. Owner-wrapped key (SEC-002)
  if (manifest.fileKeyWrapped && manifest.fileKeySalt && manifest.fileKeyIv && manifest.fileKey) {
    try {
      const rawB64 = await unwrapFileKeyFromOwner({
        wrapped: manifest.fileKey,
        iv: manifest.fileKeyIv,
        salt: manifest.fileKeySalt,
      });
      return await importKeyRaw(rawB64);
    } catch {
      // Fall through to legacy
    }
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
  /**
   * Base64-encoded raw AES-GCM key used to encrypt the file. In a real
   * application this should be encrypted with the user's public key before
   * storing, but for now we persist it directly so the UI can decrypt the
   * attachment locally.
   */
  fileKey?: string;
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
  
  // SEC-002 FIX: Wrap the file encryption key with the owner's identity
  // before storing in the manifest. This prevents peers who receive the
  // manifest from decrypting the file without the owner's private key.
  const exportedKey = await exportKeyRaw(fileKey);
  const wrappedFileKey = await wrapFileKeyForOwner(exportedKey);

  // Create manifest
  const manifest = {
    fileId: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    chunks: chunkRefs,
    mime: file.type || 'application/octet-stream',
    size: file.size,
    originalName: file.name,
    fileKey: wrappedFileKey.wrapped,
    fileKeyIv: wrappedFileKey.iv,
    fileKeySalt: wrappedFileKey.salt,
    fileKeyWrapped: true, // Flag indicating key is wrapped (not raw)
    createdAt: new Date().toISOString()
  };
  
  const signedManifest = await signManifest(manifest as import("@/lib/store").Manifest);
  await put("manifests", signedManifest);
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
    const chunk = await get("chunks", ref) as Chunk;
    
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
export async function deleteManifest(fileId: string): Promise<void> {
  const manifest = await get("manifests", fileId) as Manifest;
  if (!manifest) return;
  
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

