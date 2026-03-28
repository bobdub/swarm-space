/**
 * In-Memory Vault — Session-ephemeral encryption for sensitive data
 * 
 * Uses a non-exportable AES-256-GCM CryptoKey to encrypt sensitive values
 * (private keys, decrypted content) at rest in the JS heap. Browser extensions
 * with page access see only opaque CryptoKey handles and ciphertext blobs —
 * they cannot extract raw key bytes from a non-exportable key.
 * 
 * The vault key is generated once per session (page load) and never leaves
 * the Web Crypto subsystem.
 */

export interface SealedValue {
  ciphertext: string; // base64
  iv: string;         // base64
}

class MemoryVault {
  private key: CryptoKey | null = null;
  private ready: Promise<void>;

  constructor() {
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    this.key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false, // NON-EXPORTABLE — extensions cannot read key bytes
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Encrypt a plaintext string. Returns an opaque sealed blob.
   */
  async seal(plaintext: string): Promise<SealedValue> {
    await this.ready;
    if (!this.key) throw new Error('Vault not initialized');

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);

    const cipherBuf = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.key,
      encoded
    );

    return {
      ciphertext: bufToB64(cipherBuf),
      iv: bufToB64(iv.buffer as ArrayBuffer),
    };
  }

  /**
   * Decrypt a sealed blob back to plaintext.
   * Caller should use the result immediately and avoid storing it long-term.
   */
  async unseal(sealed: SealedValue): Promise<string> {
    await this.ready;
    if (!this.key) throw new Error('Vault not initialized');

    const iv = new Uint8Array(b64ToBuf(sealed.iv));
    const cipherBuf = b64ToBuf(sealed.ciphertext);

    const plainBuf = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      this.key,
      cipherBuf
    );

    return new TextDecoder().decode(plainBuf);
  }
}

// ── helpers ──

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
  }
  return btoa(binary);
}

function b64ToBuf(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer as ArrayBuffer;
}

/** Singleton vault instance — created at module load */
export const vault = new MemoryVault();
