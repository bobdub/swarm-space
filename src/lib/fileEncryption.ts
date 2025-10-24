import { put, get, getAll } from "./store";

// Utility functions for ArrayBuffer/Base64 conversion
function arrayBufferToBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
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
}

// Chunk and encrypt a file
export async function chunkAndEncryptFile(
  file: File,
  fileKey: CryptoKey,
  chunkSize: number = 64 * 1024,
  onProgress?: (progress: number) => void
): Promise<Manifest> {
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
  
  // Export the encryption key so we can decrypt later
  const exportedKey = await exportKeyRaw(fileKey);

  // Create manifest
  const manifest: Manifest = {
    fileId: `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    chunks: chunkRefs,
    mime: file.type,
    size: file.size,
    originalName: file.name,
    fileKey: exportedKey,
    createdAt: new Date().toISOString()
  };
  
  await put("manifests", manifest);
  return manifest;
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

// Helper to open DB (reused from store.ts logic)
async function openDB() {
  const DB_NAME = "imagination-db";
  const DB_VERSION = 1;
  return new Promise<IDBDatabase>((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
