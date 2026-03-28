/**
 * Hardened Recovery Key System
 *
 * The recovery key is a LOOKUP ADDRESS only — it contains no encrypted data.
 * It encodes a random salt used to derive HMAC tags for mesh chunk lookups.
 * The actual identity payload is AES-256-GCM encrypted using PBKDF2(password + userId).
 *
 * Security model:
 *  - Recovery key = "locker number" (finds chunks on mesh)
 *  - Password = "combination" (decrypts chunks)
 *  - Intercepting chunks or key alone reveals nothing
 */

import { arrayBufferToBase64, base64ToArrayBuffer, arrayBufferToHex } from "../crypto";
import { getCurrentUser, type UserMeta, type WrappedKey } from "../auth";
import { get } from "../store";
import type { BackupChunk, BackupManifest } from "./passphraseBackup";

// ── Constants ──────────────────────────────────────────────────────────
const CHUNK_SIZE = 512;
const PBKDF2_ITERATIONS = 250_000;
const RECOVERY_VERSION = 2;

const encoder = new TextEncoder();

// ── Base32 encoding (RFC 4648, no padding) ─────────────────────────────
const BASE32_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function toBase32(buf: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_CHARS[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    out += BASE32_CHARS[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

function fromBase32(str: string): Uint8Array {
  const cleaned = str.replace(/[^A-Z2-7]/gi, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of cleaned) {
    const idx = BASE32_CHARS.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

// ── Key Derivation ─────────────────────────────────────────────────────

/** Derive the AES-256-GCM encryption key from password + userId + passphrase */
async function deriveEncryptionKey(password: string, userId: string, passphrase: string): Promise<CryptoKey> {
  // Passphrase acts as an additional salt factor — all three are required
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password + userId + passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode("swrm-recovery-enc-v2"),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/** Derive the HMAC tag key from userId + salt for mesh chunk lookup */
async function deriveTagKey(userId: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(userId + arrayBufferToBase64(salt.buffer as ArrayBuffer)),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode("swrm-recovery-tag-v2"),
      iterations: 100_000,
      hash: "SHA-256",
    },
    baseKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function computeChunkTag(tagKey: CryptoKey, index: number): Promise<string> {
  const data = encoder.encode(`recovery-chunk:${index}`);
  const sig = await crypto.subtle.sign("HMAC", tagKey, data);
  return arrayBufferToHex(sig);
}

async function computeManifestTag(tagKey: CryptoKey): Promise<string> {
  const data = encoder.encode("recovery-manifest");
  const sig = await crypto.subtle.sign("HMAC", tagKey, data);
  return arrayBufferToHex(sig);
}

// ── Recovery Key Format ────────────────────────────────────────────────
// SWRM-{base32(salt)}-{base32(truncated userId hash)}
// ~40-50 chars, human-readable, no encrypted data

function formatRecoveryKey(salt: Uint8Array, userIdHashPrefix: Uint8Array): string {
  const saltB32 = toBase32(salt);
  const hashB32 = toBase32(userIdHashPrefix);
  // Group into 4-char blocks for readability
  const grouped = (s: string) =>
    s.match(/.{1,4}/g)?.join("") ?? s;
  return `SWRM-${grouped(saltB32)}-${grouped(hashB32)}`;
}

export function parseRecoveryKey(key: string): { salt: Uint8Array; userIdHashPrefix: Uint8Array } {
  const cleaned = key.trim().toUpperCase();
  const match = cleaned.match(/^SWRM-([A-Z2-7]+)-([A-Z2-7]+)$/);
  if (!match) throw new Error("Invalid recovery key format");
  return {
    salt: fromBase32(match[1]),
    userIdHashPrefix: fromBase32(match[2]),
  };
}

// ── Backup Creation ────────────────────────────────────────────────────

export interface RecoveryKeyResult {
  recoveryKey: string;
  chunks: BackupChunk[];
  manifest: BackupManifest;
  manifestTag: string;
}

export async function generateRecoveryKey(
  password: string,
  userId: string,
  passphrase: string,
  identityPayload?: string
): Promise<RecoveryKeyResult> {
  // 1. Build payload if not provided
  let payload = identityPayload;
  if (!payload) {
    const user = getCurrentUser();
    if (!user) throw new Error("No active user to back up");
    const wrappedData = await get<{ k: string; v: WrappedKey }>("meta", user.wrappedKeyRef);
    if (!wrappedData) throw new Error("Wrapped key not found in storage");
    payload = JSON.stringify({
      version: RECOVERY_VERSION,
      user,
      wrappedKey: wrappedData.v,
      createdAt: new Date().toISOString(),
    });
  }

  // 2. Generate random salt (16 bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // 3. Compute userId hash prefix for key verification
  const userIdHash = await crypto.subtle.digest("SHA-256", encoder.encode(userId));
  const userIdHashPrefix = new Uint8Array(userIdHash).slice(0, 8);

  // 4. Derive encryption key (password + userId + passphrase)
  const encKey = await deriveEncryptionKey(password, userId, passphrase);

  // 5. Derive tag key (userId + salt) for mesh lookup
  const tagKey = await deriveTagKey(userId, salt);

  // 6. Encrypt payload
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    encKey,
    encoder.encode(payload)
  );

  // Prepend IV + userId length + userId for self-contained recovery
  const userIdBytes = encoder.encode(userId);
  const header = new Uint8Array(1 + userIdBytes.length);
  header[0] = userIdBytes.length;
  header.set(userIdBytes, 1);

  const fullBlob = new Uint8Array(header.length + iv.length + encrypted.byteLength);
  fullBlob.set(header, 0);
  fullBlob.set(iv, header.length);
  fullBlob.set(new Uint8Array(encrypted), header.length + iv.length);

  // 7. Chunk and tag
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
      version: RECOVERY_VERSION,
    });
  }

  // 8. Build manifest
  const manifestTag = await computeManifestTag(tagKey);
  const manifest: BackupManifest = {
    version: RECOVERY_VERSION,
    totalChunks,
    tags,
    createdAt: new Date().toISOString(),
  };

  // 9. Format recovery key (lookup address only)
  const recoveryKey = formatRecoveryKey(salt, userIdHashPrefix);

  return { recoveryKey, chunks, manifest, manifestTag };
}

// ── Recovery ───────────────────────────────────────────────────────────

export interface RecoveryKeyRecoveryResult {
  user: UserMeta;
  wrappedKey: WrappedKey;
}

/**
 * Derive mesh lookup tags from a recovery key + password.
 * Returns tags the caller uses to query mesh peers for chunks.
 */
export async function deriveRecoveryKeyTags(
  recoveryKey: string,
  password: string,
  userId: string
): Promise<{
  manifestTag: string;
  getChunkTag: (index: number) => Promise<string>;
}> {
  const { salt } = parseRecoveryKey(recoveryKey);
  const tagKey = await deriveTagKey(userId, salt);
  return {
    manifestTag: await computeManifestTag(tagKey),
    getChunkTag: (index: number) => computeChunkTag(tagKey, index),
  };
}

/**
 * Decrypt retrieved backup chunks using password.
 * The userId is embedded in the chunk header.
 */
export async function decryptRecoveryKeyChunks(
  password: string,
  passphrase: string,
  chunks: BackupChunk[]
): Promise<RecoveryKeyRecoveryResult> {
  if (chunks.length === 0) throw new Error("No backup chunks provided");

  const sorted = [...chunks].sort((a, b) => a.index - b.index);
  const expectedTotal = sorted[0].total;
  if (sorted.length < expectedTotal) {
    throw new Error(`Missing chunks: have ${sorted.length}, need ${expectedTotal}`);
  }

  // Reassemble blob
  const parts = sorted.map(c => new Uint8Array(base64ToArrayBuffer(c.data)));
  const totalLen = parts.reduce((sum, p) => sum + p.length, 0);
  const fullBlob = new Uint8Array(totalLen);
  let offset = 0;
  for (const part of parts) {
    fullBlob.set(part, offset);
    offset += part.length;
  }

  // Extract header: userId length (1 byte) + userId
  const userIdLen = fullBlob[0];
  const userIdBytes = fullBlob.slice(1, 1 + userIdLen);
  const userId = new TextDecoder().decode(userIdBytes);
  const headerLen = 1 + userIdLen;

  // Extract IV (12 bytes) and ciphertext
  const iv = fullBlob.slice(headerLen, headerLen + 12);
  const ciphertext = fullBlob.slice(headerLen + 12);

  // Derive encryption key
  const encKey = await deriveEncryptionKey(password, userId, passphrase);

  // Decrypt
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    encKey,
    ciphertext
  );

  const payload = JSON.parse(new TextDecoder().decode(decrypted));

  return {
    user: payload.user as UserMeta,
    wrappedKey: payload.wrappedKey as WrappedKey,
  };
}

/** Check if a backup method is recovery-key based */
export function isRecoveryKeyBackup(userId: string): boolean {
  return localStorage.getItem(`recovery-key-backup:${userId}`) === "1";
}

/** Mark that this account uses recovery key backup */
export function markRecoveryKeyBackup(userId: string): void {
  localStorage.setItem(`recovery-key-backup:${userId}`, "1");
}
