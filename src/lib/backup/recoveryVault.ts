/**
 * Sovereign Recovery Vault — the "outer shell".
 *
 * Two keyholes, never the same lock:
 *  - The LOCAL ACCOUNT PASSWORD wraps the identity key on this device only
 *    (`meta:wrappedKey:<id>`). It never leaves the browser.
 *  - The OUTER SHELL RECOVERY PASSPHRASE seals a vault envelope that peers
 *    may hold. Peers see only AES-256-GCM ciphertext (PBKDF2-SHA-256, 250k
 *    iterations, random salt) and cannot read the identity inside.
 *
 * Shell versions are monotonic and signed by the identity key (ECDSA P-256
 * over the same PKCS#8 bytes as the account key, like content tombstones).
 * A peer accepts an envelope only when the signer's key hashes to the
 * vault's userId and the version is higher than the one it already holds,
 * so a rotated shell (v2, v3, …) overwrites stale envelopes everywhere and
 * nobody but the owner can publish one.
 *
 * The GCM additional data binds userId + version, so a ciphertext cannot be
 * replayed under another version number.
 */

import { arrayBufferToBase64, base64ToArrayBuffer, computeUserId } from "../crypto";
import { canonicalJsonBytes } from "../utils/canonicalJson";

export const VAULT_FORMAT = "swarm-recovery-vault";
export const VAULT_PBKDF2_ITERATIONS = 250_000;
/** Envelopes are tiny (one key + profile); anything bigger is refused. */
export const MAX_ENVELOPE_BYTES = 16 * 1024;
const MAX_CLOCK_SKEW_MS = 10 * 60 * 1000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface VaultProfile {
  id: string;
  username: string;
  displayName?: string;
  publicKey: string;
  createdAt: string;
  profile?: { bio?: string; avatarRef?: string; bannerRef?: string };
}

/** What the shell protects. Only ever exists in memory on the owner's device. */
export interface VaultPayload {
  format: typeof VAULT_FORMAT;
  userId: string;
  version: number;
  /** Base64 PKCS#8 P-256 identity private key. */
  privateKey: string;
  user: VaultProfile;
  sealedAt: string;
}

/**
 * Which secret seals the shell: the account password (the genesis default,
 * which follows local password changes) or a separate Recovery Passphrase.
 * Signed, so every device of the identity agrees on it.
 */
export type VaultShellMode = "account" | "recovery";

export interface UnsignedVaultEnvelope {
  format: typeof VAULT_FORMAT;
  userId: string;
  version: number;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  cipher: { name: "AES-GCM"; iv: string };
  ciphertext: string;
  createdAt: string;
  signerPublicKey: string;
  /** Absent on envelopes sealed before the mode was recorded. */
  shell?: VaultShellMode;
}

export interface RecoveryVaultEnvelope extends UnsignedVaultEnvelope {
  signature: string;
}

function bytes(view: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}

function additionalData(userId: string, version: number): ArrayBuffer {
  return bytes(encoder.encode(`${VAULT_FORMAT}:${userId}:v${version}`));
}

async function deriveShellKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", bytes(encoder.encode(passphrase)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: bytes(salt), iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function signingBytes(envelope: UnsignedVaultEnvelope): ArrayBuffer {
  const { format, userId, version, kdf, cipher, ciphertext, createdAt, signerPublicKey, shell } = envelope;
  // `shell` is signed only when present so earlier envelopes still verify.
  return bytes(canonicalJsonBytes({
    format, userId, version, kdf, cipher, ciphertext, createdAt, signerPublicKey,
    ...(shell !== undefined ? { shell } : {}),
  }));
}

async function importVerifyKey(publicKey: string): Promise<CryptoKey> {
  const raw = base64ToArrayBuffer(publicKey);
  try {
    return await crypto.subtle.importKey("spki", raw, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  } catch {
    // Accounts recovered from a raw key store the uncompressed point form.
    return crypto.subtle.importKey("raw", raw, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  }
}

export function normalizePassphrase(passphrase: string): string {
  return passphrase.trim();
}

/** Seal the identity under a new outer shell and sign the envelope. */
export async function sealRecoveryVault(input: {
  privateKey: string;
  user: VaultProfile;
  version: number;
  passphrase: string;
  shell?: VaultShellMode;
  now?: Date;
}): Promise<RecoveryVaultEnvelope> {
  const passphrase = normalizePassphrase(input.passphrase);
  if (!passphrase) throw new Error("A recovery passphrase is required to seal the vault.");
  if (!Number.isInteger(input.version) || input.version < 1) throw new Error("Shell versions start at 1.");
  const userId = await computeUserId(input.user.publicKey);
  if (userId !== input.user.id) throw new Error("The vault profile does not match its public key.");

  const createdAt = (input.now ?? new Date()).toISOString();
  const payload: VaultPayload = {
    format: VAULT_FORMAT,
    userId,
    version: input.version,
    privateKey: input.privateKey,
    user: {
      id: input.user.id,
      username: input.user.username,
      displayName: input.user.displayName,
      publicKey: input.user.publicKey,
      createdAt: input.user.createdAt,
      ...(input.user.profile ? { profile: input.user.profile } : {}),
    },
    sealedAt: createdAt,
  };

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveShellKey(passphrase, salt, VAULT_PBKDF2_ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: bytes(iv), additionalData: additionalData(userId, input.version) },
    key,
    bytes(encoder.encode(JSON.stringify(payload))),
  );

  const unsigned: UnsignedVaultEnvelope = {
    format: VAULT_FORMAT,
    userId,
    version: input.version,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: VAULT_PBKDF2_ITERATIONS, salt: arrayBufferToBase64(bytes(salt)) },
    cipher: { name: "AES-GCM", iv: arrayBufferToBase64(bytes(iv)) },
    ciphertext: arrayBufferToBase64(ciphertext),
    createdAt,
    signerPublicKey: input.user.publicKey,
    ...(input.shell ? { shell: input.shell } : {}),
  };

  const signingKey = await crypto.subtle.importKey(
    "pkcs8",
    base64ToArrayBuffer(input.privateKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, signingBytes(unsigned));
  return { ...unsigned, signature: arrayBufferToBase64(signature) };
}

const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

/** Structural check only — does not verify the signature. */
export function isVaultEnvelopeShape(value: unknown): value is RecoveryVaultEnvelope {
  if (!value || typeof value !== "object") return false;
  const e = value as Record<string, unknown>;
  const kdf = e.kdf as Record<string, unknown> | undefined;
  const cipher = e.cipher as Record<string, unknown> | undefined;
  return (
    e.format === VAULT_FORMAT &&
    isStr(e.userId, 128) &&
    typeof e.version === "number" && Number.isInteger(e.version) && e.version >= 1 && e.version < 1_000_000 &&
    !!kdf && kdf.name === "PBKDF2" && kdf.hash === "SHA-256" && kdf.iterations === VAULT_PBKDF2_ITERATIONS && isStr(kdf.salt, 64) &&
    !!cipher && cipher.name === "AES-GCM" && isStr(cipher.iv, 64) &&
    isStr(e.ciphertext, MAX_ENVELOPE_BYTES) &&
    isStr(e.createdAt, 64) &&
    isStr(e.signerPublicKey, 1024) &&
    (e.shell === undefined || e.shell === "account" || e.shell === "recovery") &&
    isStr(e.signature, 1024)
  );
}

/**
 * True when the envelope is well-formed, signed by the key whose hash is its
 * userId, and not dated in the future. Peers run this before holding anything.
 */
export async function verifyRecoveryVault(value: unknown, now = Date.now()): Promise<boolean> {
  if (!isVaultEnvelopeShape(value)) return false;
  try {
    if (JSON.stringify(value).length > MAX_ENVELOPE_BYTES) return false;
  } catch {
    return false;
  }
  const created = Date.parse(value.createdAt);
  if (!Number.isFinite(created) || created > now + MAX_CLOCK_SKEW_MS) return false;
  try {
    if ((await computeUserId(value.signerPublicKey)) !== value.userId) return false;
    const key = await importVerifyKey(value.signerPublicKey);
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      base64ToArrayBuffer(value.signature),
      signingBytes(value),
    );
  } catch {
    return false;
  }
}

/**
 * True when `candidate` should replace `held`: a strictly higher signed
 * version wins. Two devices that rotated offline can produce the same version;
 * every peer then picks the same winner (later `createdAt`, then the larger
 * signature), so all copies converge on one shell.
 */
export function supersedes(candidate: RecoveryVaultEnvelope, held: RecoveryVaultEnvelope | null | undefined): boolean {
  if (!held) return true;
  if (candidate.userId !== held.userId) return false;
  if (candidate.version !== held.version) return candidate.version > held.version;
  if (candidate.signature === held.signature) return false;
  if (candidate.createdAt !== held.createdAt) return candidate.createdAt > held.createdAt;
  return candidate.signature > held.signature;
}

/** Same envelope (same version and signature). */
export function sameEnvelope(a: RecoveryVaultEnvelope | null | undefined, b: RecoveryVaultEnvelope | null | undefined): boolean {
  return !!a && !!b && a.userId === b.userId && a.version === b.version && a.signature === b.signature;
}

export class WrongRecoveryPassphraseError extends Error {
  constructor() {
    super("That recovery passphrase does not open this vault.");
    this.name = "WrongRecoveryPassphraseError";
  }
}

/** Open the outer shell. Verifies the signature first; throws on a wrong passphrase. */
export async function openRecoveryVault(envelope: RecoveryVaultEnvelope, passphrase: string): Promise<VaultPayload> {
  if (!(await verifyRecoveryVault(envelope))) throw new Error("This vault's signature is invalid; it was not issued by its owner.");
  const key = await deriveShellKey(
    normalizePassphrase(passphrase),
    new Uint8Array(base64ToArrayBuffer(envelope.kdf.salt)),
    envelope.kdf.iterations,
  );
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64ToArrayBuffer(envelope.cipher.iv),
        additionalData: additionalData(envelope.userId, envelope.version),
      },
      key,
      base64ToArrayBuffer(envelope.ciphertext),
    );
  } catch {
    throw new WrongRecoveryPassphraseError();
  }
  const payload = JSON.parse(decoder.decode(plain)) as VaultPayload;
  if (
    payload.format !== VAULT_FORMAT ||
    payload.userId !== envelope.userId ||
    payload.version !== envelope.version ||
    payload.user?.publicKey !== envelope.signerPublicKey ||
    typeof payload.privateKey !== "string"
  ) {
    throw new Error("The vault contents do not match its envelope.");
  }
  return payload;
}

// ── Recovery links ─────────────────────────────────────────────────────

export const RECOVER_PATH = "/recover";

export interface RecoveryLinkParams {
  id: string;
  v: number;
  peer: string | null;
}

export function recoveryUrl(origin: string, params: RecoveryLinkParams): string {
  const q = new URLSearchParams({ id: params.id, v: String(params.v) });
  if (params.peer) q.set("peer", params.peer);
  return `${origin}${RECOVER_PATH}?${q.toString()}`;
}

const USER_ID_PATTERN = /^[0-9a-f]{16}$/;
const PEER_ID_PATTERN = /^peer-[a-zA-Z0-9_-]{1,120}$/;

export function parseRecoveryParams(search: string): RecoveryLinkParams | null {
  const q = new URLSearchParams(search);
  const id = (q.get("id") ?? "").trim().toLowerCase();
  if (!USER_ID_PATTERN.test(id)) return null;
  const vRaw = Number.parseInt(q.get("v") ?? "", 10);
  const peerRaw = (q.get("peer") ?? "").trim();
  return {
    id,
    v: Number.isInteger(vRaw) && vRaw >= 1 ? vRaw : 1,
    peer: PEER_ID_PATTERN.test(peerRaw) ? peerRaw : null,
  };
}

/**
 * `/#/recover?id=…` (hash-routed share wrappers) → `/recover?id=…`, so the
 * path router sees one shape. Returns null when already canonical or unrelated.
 */
export function canonicalRecoverHref(pathname: string, hash: string, search: string): string | null {
  const routed = /^#!?(\/recover)\/?(\?[^#]*)?$/.exec(hash);
  if (!routed) return null;
  if (pathname !== "/" && pathname !== "") return null;
  const merged = new URLSearchParams(search);
  for (const [k, v] of new URLSearchParams(routed[2] ?? "")) merged.set(k, v);
  const rest = merged.toString();
  return `${RECOVER_PATH}${rest ? `?${rest}` : ""}`;
}

/**
 * The canonical `?id=…&v=…` search of a Recovery Link, from whatever a person
 * pasted or a QR code held: a full `/recover?…` URL, a hash-routed
 * `/#/recover?…` wrapper, or a bare `?id=…` query. Null for anything else.
 */
export function recoverySearchFromLink(text: string, origin: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed, origin);
  } catch {
    return null;
  }
  const hashQuery = /^#!?\/recover\/?(\?[^#]*)$/.exec(url.hash)?.[1];
  const onRecoverPath = url.pathname.replace(/\/+$/, "") === RECOVER_PATH;
  const search = hashQuery ?? (onRecoverPath || trimmed.startsWith("?") ? url.search : "");
  const params = search ? parseRecoveryParams(search) : null;
  return params ? `?${new URLSearchParams({ id: params.id, v: String(params.v), ...(params.peer ? { peer: params.peer } : {}) }).toString()}` : null;
}

/**
 * Which vault holder a Recovery Link / QR names. The person's pick wins when
 * it still holds the current shell; otherwise a custodian that is connected
 * right now, then any custodian, then this node (so a second device can still
 * recover while this one is online).
 */
export function chooseRecoveryHolder(input: {
  custodians: readonly string[];
  connected: ReadonlySet<string> | readonly string[];
  selected?: string | null;
  self?: string | null;
}): string | null {
  const connected = input.connected instanceof Set ? input.connected : new Set(input.connected as readonly string[]);
  if (input.selected && input.custodians.includes(input.selected)) return input.selected;
  return input.custodians.find((p) => connected.has(p)) ?? input.custodians[0] ?? input.self ?? null;
}
