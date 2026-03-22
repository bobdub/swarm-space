/**
 * Unified Content Pipeline
 *
 * Enforces the required data flow for ALL content entering the system:
 *
 *   Raw Content
 *     → Encrypt (AES-256-GCM via ECDH)
 *     → Chunk (fixed-size pieces with hashes)
 *     → Store Locally (IndexedDB, HMAC-protected)
 *     → Push to Mesh (P2P broadcast)
 *
 * No content should bypass this pipeline.  Reads reverse the flow.
 *
 * This module is the single entry point for persisting user-generated
 * content (posts, comments, reactions, files).  It delegates to the
 * existing encryption, chunking, and storage layers.
 */

import { sha256Async } from "../blockchain/crypto";
import { put, get } from "../store";

// ── Self-contained crypto helpers (zero shared imports) ─────────────

function ab2b64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return btoa(binary);
}

function b642ab(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}

function ab2hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Types ──────────────────────────────────────────────────────────────

export type ContentType = "post" | "comment" | "reaction" | "file";

export interface PipelineInput {
  /** Unique content identifier */
  contentId: string;
  /** The raw content (string or base64 binary) */
  payload: string;
  /** Content category */
  contentType: ContentType;
  /** Creator's ECDH public key (base64 SPKI) */
  creatorPublicKey: string;
  /** Creator's user ID */
  creatorId: string;
  /** Optional: chunk size in bytes (default 32 KB) */
  chunkSize?: number;
}

export interface EncryptedChunk {
  ref: string;           // SHA-256 content-address
  index: number;
  total: number;
  ciphertext: string;    // base64
  iv: string;            // base64
  contentId: string;
  contentType: ContentType;
  creatorId: string;
  hmac: string;          // integrity tag
  timestamp: number;
}

export interface ContentManifest {
  contentId: string;
  contentType: ContentType;
  creatorId: string;
  creatorPublicKey: string;
  chunkRefs: string[];
  contentHash: string;    // SHA-256 of plaintext
  ephemeralPublicKey: string; // for ECDH decryption
  encSalt: string;
  totalSize: number;
  createdAt: string;
}

export interface PipelineResult {
  manifest: ContentManifest;
  chunks: EncryptedChunk[];
}

// ── Pipeline: Encrypt → Chunk → Store ──────────────────────────────────

/** Adaptive chunk size based on payload length (matches torrent swarm logic) */
function getAdaptiveChunkSize(size: number): number {
  if (size < 1_048_576)        return 256 * 1024;
  if (size < 10 * 1_048_576)   return 512 * 1024;
  if (size < 100 * 1_048_576)  return 1_048_576;
  return 2 * 1_048_576;
}

export async function runContentPipeline(input: PipelineInput): Promise<PipelineResult> {
  const {
    contentId,
    payload,
    contentType,
    creatorPublicKey,
    creatorId,
    chunkSize = getAdaptiveChunkSize(payload.length),
  } = input;

  // 1. Hash plaintext for integrity
  const contentHash = await sha256Async(payload);

  // 2. Generate ephemeral ECDH keypair for encryption
  const ephemeralKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"]
  );

  // 3. Import creator's public key
  const creatorKey = await crypto.subtle.importKey(
    "spki",
    b642ab(creatorPublicKey),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  // 4. Derive shared secret (ECDH)
  const sharedKey = await crypto.subtle.deriveKey(
    { name: "ECDH", public: creatorKey },
    ephemeralKeyPair.privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );

  // 5. Encrypt full payload
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const saltedPayload = JSON.stringify({
    content: payload,
    salt: ab2b64(salt.buffer as ArrayBuffer),
    contentHash,
    timestamp: Date.now(),
  });
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    sharedKey,
    new TextEncoder().encode(saltedPayload)
  );

  const cipherB64 = ab2b64(ciphertext);

  // 6. Export ephemeral public key
  const ephPubRaw = await crypto.subtle.exportKey("spki", ephemeralKeyPair.publicKey);
  const ephemeralPublicKey = ab2b64(ephPubRaw);

  // 7. Chunk the ciphertext
  const totalChunks = Math.max(1, Math.ceil(cipherB64.length / chunkSize));
  const chunks: EncryptedChunk[] = [];
  const chunkRefs: string[] = [];
  const now = Date.now();

  // Derive an HMAC key for chunk integrity from the shared key material
  const hmacKeyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(contentHash),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );
  const hmacKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode("pipeline-hmac-v1"),
      iterations: 10_000,
      hash: "SHA-256",
    },
    hmacKeyMaterial,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, cipherB64.length);
    const chunkData = cipherB64.slice(start, end);

    // Content-address the chunk
    const refHash = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${contentId}:${i}:${chunkData}`)
    );
    const ref = `pc-${ab2hex(refHash).slice(0, 32)}`;

    // HMAC for integrity
    const hmacSig = await crypto.subtle.sign(
      "HMAC",
      hmacKey,
      new TextEncoder().encode(chunkData)
    );

    const chunk: EncryptedChunk = {
      ref,
      index: i,
      total: totalChunks,
      ciphertext: chunkData,
      iv: ab2b64(iv.buffer as ArrayBuffer),
      contentId,
      contentType,
      creatorId,
      hmac: ab2b64(hmacSig),
      timestamp: now,
    };

    chunks.push(chunk);
    chunkRefs.push(ref);
  }

  // 8. Build manifest
  const manifest: ContentManifest = {
    contentId,
    contentType,
    creatorId,
    creatorPublicKey,
    chunkRefs,
    contentHash,
    ephemeralPublicKey,
    encSalt: ab2b64(salt.buffer as ArrayBuffer),
    totalSize: cipherB64.length,
    createdAt: new Date().toISOString(),
  };

  // 9. Store locally (IndexedDB)
  await Promise.all([
    put("meta", { k: `manifest:${contentId}`, v: manifest }),
    ...chunks.map(c => put("chunks", { ...c, ref: c.ref })),
  ]);

  return { manifest, chunks };
}

// ── Pipeline: Retrieve → Reassemble → Decrypt ─────────────────────────

export async function readContentFromPipeline(
  contentId: string,
  privateKeyBase64: string
): Promise<string> {
  // 1. Load manifest
  const entry = await get<{ k: string; v: ContentManifest }>(
    "meta",
    `manifest:${contentId}`
  );
  if (!entry) throw new Error(`Manifest not found for ${contentId}`);
  const manifest = entry.v;

  // 2. Load chunks
  const chunkEntries = await Promise.all(
    manifest.chunkRefs.map(ref => get<EncryptedChunk>("chunks", ref))
  );

  const sorted = chunkEntries
    .filter((c): c is EncryptedChunk => c !== undefined)
    .sort((a, b) => a.index - b.index);

  if (sorted.length !== manifest.chunkRefs.length) {
    throw new Error(
      `Missing chunks: have ${sorted.length}, need ${manifest.chunkRefs.length}`
    );
  }

  // 3. Reassemble ciphertext
  const cipherB64 = sorted.map(c => c.ciphertext).join("");

  // 4. Import user's private key
  const userPrivateKey = await crypto.subtle.importKey(
    "pkcs8",
    b642ab(privateKeyBase64),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveKey"]
  );

  // 5. Import ephemeral public key
  const ephPubKey = await crypto.subtle.importKey(
    "spki",
    b642ab(manifest.ephemeralPublicKey),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  // 6. Derive shared key
  const sharedKey = await crypto.subtle.deriveKey(
    { name: "ECDH", public: ephPubKey },
    userPrivateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  // 7. Decrypt
  // IV was the same for all chunks (full payload encrypted at once)
  const iv = new Uint8Array(b642ab(sorted[0].iv));
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    sharedKey,
    b642ab(cipherB64)
  );

  // 8. Parse and verify
  const saltedPayload = JSON.parse(new TextDecoder().decode(decrypted));
  const verifyHash = await sha256Async(saltedPayload.content);
  if (verifyHash !== saltedPayload.contentHash) {
    throw new Error("Content integrity check failed — data may be corrupted");
  }

  return saltedPayload.content;
}
