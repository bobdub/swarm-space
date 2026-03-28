/**
 * Passphrase-Based Account Backup via Mesh
 *
 * Flow — Backup:
 *  1. User enters a passphrase.
 *  2. Derive a tag key (PBKDF2 → HMAC) and an encryption key (PBKDF2 → AES-256-GCM).
 *  3. Encrypt the full identity payload (UserMeta + wrappedKey).
 *  4. Split encrypted blob into fixed-size chunks.
 *  5. Tag each chunk with an HMAC of (passphrase-tag-key, chunkIndex) so peers
 *     can store/lookup by tag without knowing the passphrase.
 *  6. Broadcast tagged chunks to mesh peers.
 *
 * Flow — Recovery:
 *  1. User enters passphrase on a new device.
 *  2. Derive the same tag key.
 *  3. Compute expected tags for chunk indices 0…N.
 *  4. Query mesh peers for chunks matching those tags.
 *  5. Reassemble, decrypt, restore identity.
 *
 * Security:
 *  - Passphrase never leaves the device.
 *  - Tags are HMAC-derived; peers cannot reverse them to the passphrase.
 *  - Encrypted payload uses AES-256-GCM; peers cannot read identity data.
 *  - Requires ≥1 peer online holding backup chunks.
 */

import { arrayBufferToBase64, base64ToArrayBuffer } from "../crypto";
import { getCurrentUser, type UserMeta, type WrappedKey } from "../auth";
import { get } from "../store";

// ── Constants ──────────────────────────────────────────────────────────
const CHUNK_SIZE = 512; // bytes per chunk
const PBKDF2_ITERATIONS = 250_000;
const BACKUP_VERSION = 1;

// ── Types ──────────────────────────────────────────────────────────────
export interface BackupChunk {
  tag: string;       // HMAC-derived lookup tag (hex)
  index: number;     // chunk sequence number
  total: number;     // total chunks in this backup
  data: string;      // base64 encrypted chunk data
  version: number;
}

export interface BackupManifest {
  version: number;
  totalChunks: number;
  tags: string[];    // ordered list of chunk tags for verification
  createdAt: string;
}

// ── Key Derivation (self-contained, no shared imports) ─────────────────

const encoder = new TextEncoder();

async function deriveBackupKeys(passphrase: string): Promise<{
  encryptionKey: CryptoKey;
  tagKey: CryptoKey;
}> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  const encSalt = encoder.encode("swarm-backup-enc-v1");
  const tagSalt = encoder.encode("swarm-backup-tag-v1");

  const [encryptionKey, tagKey] = await Promise.all([
    crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: encSalt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    ),
    crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: tagSalt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
      baseKey,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    ),
  ]);

  return { encryptionKey, tagKey };
}

async function computeChunkTag(tagKey: CryptoKey, index: number): Promise<string> {
  const data = encoder.encode(`backup-chunk:${index}`);
  const sig = await crypto.subtle.sign("HMAC", tagKey, data);
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// Also compute a "manifest tag" so we can look up metadata
async function computeManifestTag(tagKey: CryptoKey): Promise<string> {
  const data = encoder.encode("backup-manifest");
  const sig = await crypto.subtle.sign("HMAC", tagKey, data);
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Backup Creation ────────────────────────────────────────────────────

export async function createPassphraseBackup(passphrase: string, skipLengthCheck = false): Promise<{
  chunks: BackupChunk[];
  manifest: BackupManifest;
  manifestTag: string;
}> {
  const trimmed = passphrase.trim();
  if (!skipLengthCheck && (!trimmed || trimmed.length < 200)) {
    throw new Error("Backup passphrase must be at least 200 characters");
  }

  // 1. Gather identity payload
  const user = getCurrentUser();
  if (!user) throw new Error("No active user to back up");

  const wrappedData = await get<{ k: string; v: WrappedKey }>("meta", user.wrappedKeyRef);
  if (!wrappedData) throw new Error("Wrapped key not found in storage");

  const payload = JSON.stringify({
    version: BACKUP_VERSION,
    user,
    wrappedKey: wrappedData.v,
    createdAt: new Date().toISOString(),
  });

  // 2. Derive keys
  const { encryptionKey, tagKey } = await deriveBackupKeys(trimmed);

  // 3. Encrypt payload
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    encryptionKey,
    encoder.encode(payload)
  );

  // Prepend IV to ciphertext for self-contained decryption
  const fullBlob = new Uint8Array(iv.length + encrypted.byteLength);
  fullBlob.set(iv, 0);
  fullBlob.set(new Uint8Array(encrypted), iv.length);

  // 4. Split into chunks
  const totalChunks = Math.ceil(fullBlob.length / CHUNK_SIZE);
  const chunks: BackupChunk[] = [];
  const tags: string[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, fullBlob.length);
    const chunkData = fullBlob.slice(start, end);
    const tag = await computeChunkTag(tagKey, i);

    tags.push(tag);
    chunks.push({
      tag,
      index: i,
      total: totalChunks,
      data: arrayBufferToBase64(chunkData.buffer as ArrayBuffer),
      version: BACKUP_VERSION,
    });
  }

  // 5. Build manifest
  const manifestTag = await computeManifestTag(tagKey);
  const manifest: BackupManifest = {
    version: BACKUP_VERSION,
    totalChunks,
    tags,
    createdAt: new Date().toISOString(),
  };

  return { chunks, manifest, manifestTag };
}

// ── Recovery ───────────────────────────────────────────────────────────

export interface RecoveryResult {
  user: UserMeta;
  wrappedKey: WrappedKey;
}

/**
 * Compute the tags a peer should query for when recovering.
 * Returns { manifestTag, chunkTagFn } where chunkTagFn(index) gives
 * the tag for chunk N.  The caller drives the mesh query loop.
 */
export async function deriveRecoveryTags(passphrase: string): Promise<{
  manifestTag: string;
  getChunkTag: (index: number) => Promise<string>;
}> {
  const { tagKey } = await deriveBackupKeys(passphrase.trim());
  return {
    manifestTag: await computeManifestTag(tagKey),
    getChunkTag: (index: number) => computeChunkTag(tagKey, index),
  };
}

/**
 * Given retrieved chunks (in any order), reassemble and decrypt the backup.
 */
export async function decryptBackupChunks(
  passphrase: string,
  chunks: BackupChunk[]
): Promise<RecoveryResult> {
  const trimmed = passphrase.trim();
  if (chunks.length === 0) throw new Error("No backup chunks provided");

  // Sort by index
  const sorted = [...chunks].sort((a, b) => a.index - b.index);
  const expectedTotal = sorted[0].total;

  if (sorted.length < expectedTotal) {
    throw new Error(`Missing chunks: have ${sorted.length}, need ${expectedTotal}`);
  }

  // Reassemble blob
  const parts: Uint8Array[] = sorted.map(c =>
    new Uint8Array(base64ToArrayBuffer(c.data))
  );
  const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
  const fullBlob = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    fullBlob.set(part, offset);
    offset += part.length;
  }

  // Extract IV (first 12 bytes) and ciphertext
  const iv = fullBlob.slice(0, 12);
  const ciphertext = fullBlob.slice(12);

  // Derive encryption key
  const { encryptionKey } = await deriveBackupKeys(trimmed);

  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    encryptionKey,
    ciphertext
  );

  const payload = JSON.parse(new TextDecoder().decode(decrypted));

  if (payload.version !== BACKUP_VERSION) {
    throw new Error(`Unsupported backup version: ${payload.version}`);
  }

  return {
    user: payload.user as UserMeta,
    wrappedKey: payload.wrappedKey as WrappedKey,
  };
}
