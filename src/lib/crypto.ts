// Web Crypto utilities for local-first encryption

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}

export function arrayBufferToHex(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf);
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

// Generate ECDH key pair for identity
export async function genIdentityKeyPair() {
  const ecdh = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey", "deriveBits"]
  );
  const pub = await crypto.subtle.exportKey("spki", ecdh.publicKey);
  const priv = await crypto.subtle.exportKey("pkcs8", ecdh.privateKey);
  return {
    publicKey: arrayBufferToBase64(pub),
    privateKey: arrayBufferToBase64(priv),
  };
}

// Derive wrapping key from passphrase using PBKDF2
export async function deriveWrappingKey(
  passphrase: string,
  salt: BufferSource
) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: 200_000,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

// Wrap private key with passphrase
export async function wrapPrivateKey(
  privateKeyBase64: string,
  passphrase: string
) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const wrappingKey = await deriveWrappingKey(passphrase, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = base64ToArrayBuffer(privateKeyBase64);
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    wrappingKey,
    data
  );
  return {
    wrapped: arrayBufferToBase64(cipher),
    salt: arrayBufferToBase64(salt.buffer),
    iv: arrayBufferToBase64(iv.buffer),
  };
}

// Unwrap private key with passphrase
export async function unwrapPrivateKey(
  wrappedObj: { wrapped: string; salt: string; iv: string },
  passphrase: string
): Promise<string> {
  const salt = new Uint8Array(base64ToArrayBuffer(wrappedObj.salt));
  const iv = new Uint8Array(base64ToArrayBuffer(wrappedObj.iv));
  const wrappingKey = await deriveWrappingKey(passphrase, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    wrappingKey,
    base64ToArrayBuffer(wrappedObj.wrapped)
  );
  return arrayBufferToBase64(decrypted);
}

// Compute user ID from public key
export async function computeUserId(pubB64: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    base64ToArrayBuffer(pubB64)
  );
  return arrayBufferToHex(hash).slice(0, 16);
}

// Generate symmetric key for file encryption
export async function genFileKey() {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

// Export key as base64
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

// SHA-256 hash function for content addressing
export async function sha256(data: Uint8Array | ArrayBuffer): Promise<string> {
  const buffer = data instanceof Uint8Array ? (data.buffer as ArrayBuffer) : data;
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return arrayBufferToHex(hash);
}
