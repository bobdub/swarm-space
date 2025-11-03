import { arrayBufferToBase64, base64ToArrayBuffer } from "@/lib/crypto";
import { get, put } from "@/lib/store";
import type { Manifest, Chunk } from "@/lib/store";
import type {
  VerificationProofEnvelope,
  VerificationProofPayload,
  VerificationSessionResult,
} from "@/types/verification";

const PROOF_CHUNK_PREFIX = "verification-proof";

function toBase64(buffer: ArrayBuffer): string {
  return arrayBufferToBase64(buffer);
}

function fromBase64(b64: string): ArrayBuffer {
  return base64ToArrayBuffer(b64);
}

function getSubtleCrypto(): SubtleCrypto {
  const cryptoObject = globalThis.crypto ?? (typeof window !== "undefined" ? window.crypto : undefined);
  if (!cryptoObject?.subtle) {
    throw new Error("WebCrypto not available");
  }
  return cryptoObject.subtle;
}

export async function computeEntropyScoreHash({
  entropyScore,
  issuedAt,
  userId,
}: {
  entropyScore: number;
  issuedAt: string;
  userId: string;
}): Promise<string> {
  const subtle = getSubtleCrypto();
  const canonicalInput = `${String(entropyScore)}|${issuedAt}|${userId}`;
  const encoder = new TextEncoder();
  const digest = await subtle.digest("SHA-256", encoder.encode(canonicalInput));
  return arrayBufferToBase64(digest);
}

export async function isEntropyScoreHashValid(payload: VerificationProofPayload): Promise<boolean> {
  if (!payload?.entropyScoreHash) {
    return false;
  }

  try {
    const expected = await computeEntropyScoreHash({
      entropyScore: payload.entropyScore,
      issuedAt: payload.issuedAt,
      userId: payload.userId,
    });
    return expected === payload.entropyScoreHash;
  } catch (error) {
    console.warn("[Verification] Failed to recompute entropy score hash", error);
    return false;
  }
}

async function ensureEd25519KeyPair(): Promise<{ publicKey: string; privateKey: string }> {
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    throw new Error("WebCrypto not available");
  }

  const stored = window.localStorage.getItem("flux_verification_ed25519_keypair");
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as { publicKey: string; privateKey: string };
      if (parsed?.publicKey && parsed?.privateKey) {
        return parsed;
      }
    } catch (error) {
      console.warn("[Verification] Failed to parse stored keypair", error);
    }
  }

  const keyPair = await window.crypto.subtle.generateKey(
    { name: "Ed25519", namedCurve: "Ed25519" },
    true,
    ["sign", "verify"],
  );

  const publicKey = toBase64(await window.crypto.subtle.exportKey("spki", keyPair.publicKey));
  const privateKey = toBase64(await window.crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
  const serialized = JSON.stringify({ publicKey, privateKey });

  window.localStorage.setItem("flux_verification_ed25519_keypair", serialized);
  return { publicKey, privateKey };
}

async function importPrivateKey(privateKey: string): Promise<CryptoKey> {
  return await window.crypto.subtle.importKey(
    "pkcs8",
    fromBase64(privateKey),
    { name: "Ed25519", namedCurve: "Ed25519" },
    false,
    ["sign"],
  );
}

async function importPublicKey(publicKey: string): Promise<CryptoKey> {
  return await window.crypto.subtle.importKey(
    "spki",
    fromBase64(publicKey),
    { name: "Ed25519", namedCurve: "Ed25519" },
    false,
    ["verify"],
  );
}

async function encryptPayload(payload: VerificationProofPayload): Promise<{
  manifest: Manifest;
  secretKey: string;
}> {
  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(payload));
  const key = await window.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const rawKey = await window.crypto.subtle.exportKey("raw", key);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const cipher = await window.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);

  const chunkRef = `${PROOF_CHUNK_PREFIX}:${payload.sessionId}`;
  const chunk: Chunk = {
    ref: chunkRef,
    seq: 0,
    total: 1,
    size: cipher.byteLength,
    iv: toBase64(iv.buffer),
    cipher: toBase64(cipher),
    meta: { mime: "application/json" },
  };

  await put("chunks", chunk);

  const manifest: Manifest = {
    fileId: payload.manifestId,
    chunks: [chunkRef],
    mime: "application/json",
    size: data.byteLength,
    createdAt: new Date().toISOString(),
    fileKey: toBase64(rawKey),
  };

  await put("manifests", manifest);

  return { manifest, secretKey: toBase64(rawKey) };
}

export async function createVerificationProof(
  result: VerificationSessionResult,
  userId: string,
): Promise<VerificationProofEnvelope> {
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    throw new Error("WebCrypto not available");
  }

  const sessionId = crypto.randomUUID();
  const manifestId = `${PROOF_CHUNK_PREFIX}-manifest-${sessionId}`;
  const entropyScoreHash = await computeEntropyScoreHash({
    entropyScore: result.metrics.entropyScore,
    issuedAt: result.issuedAt,
    userId,
  });
  const payload: VerificationProofPayload = {
    human_verified: true,
    userId,
    medal: result.medal,
    medalCardImage: result.cardImage ?? null,
    entropyScore: result.metrics.entropyScore,
    entropyScoreHash,
    totalTimeMs: result.metrics.totalTimeMs,
    moveCount: result.metrics.moveCount,
    accuracy: result.metrics.accuracy,
    creditsAwarded: result.creditsAwarded,
    issuedAt: result.issuedAt,
    sessionId,
    manifestId,
  };

  const { manifest } = await encryptPayload(payload);
  const { publicKey, privateKey } = await ensureEd25519KeyPair();
  const signer = await importPrivateKey(privateKey);
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const signatureBuffer = await window.crypto.subtle.sign("Ed25519", signer, data);
  const signature = toBase64(signatureBuffer);

  return {
    manifestId: manifest.fileId,
    signature,
    publicKey,
    payload,
    signedAt: new Date().toISOString(),
  };
}

export async function verifyProof(envelope: VerificationProofEnvelope): Promise<boolean> {
  if (typeof window === "undefined" || !window.crypto?.subtle) {
    return false;
  }

  const hashValid = await isEntropyScoreHashValid(envelope.payload);
  if (!hashValid) {
    return false;
  }

  const verifier = await importPublicKey(envelope.publicKey);
  const data = new TextEncoder().encode(JSON.stringify(envelope.payload));
  const signature = fromBase64(envelope.signature);

  return await window.crypto.subtle.verify("Ed25519", verifier, signature, data);
}

export async function loadProof(manifestId: string): Promise<Manifest | undefined> {
  return await get<Manifest>("manifests", manifestId);
}
