import type { GroupWareMembership, SignedGroupWareMembership } from './types';

const ALG = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN = { name: 'ECDSA', hash: 'SHA-256' } as const;

/** Stable key-ordered JSON so signer and verifier hash identical bytes. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

export function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s);
}
export const b64ToBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export interface HostKeys { privateKey: CryptoKey; publicJwk: JsonWebKey }

/** Private key is non-extractable; only the public half is exported. */
export async function generateHostKeys(): Promise<HostKeys> {
  const kp = await crypto.subtle.generateKey(ALG, false, ['sign', 'verify']);
  return { privateKey: kp.privateKey, publicJwk: await crypto.subtle.exportKey('jwk', kp.publicKey) };
}

export async function signMembership(m: GroupWareMembership, privateKey: CryptoKey): Promise<SignedGroupWareMembership> {
  const sig = await crypto.subtle.sign(SIGN, privateKey, new TextEncoder().encode(canonicalJson(m)));
  return { membership: m, signature: bytesToB64(new Uint8Array(sig)) };
}

export async function verifyMembership(s: SignedGroupWareMembership, publicJwk: JsonWebKey): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('jwk', publicJwk, ALG, false, ['verify']);
    return await crypto.subtle.verify(SIGN, key, b64ToBytes(s.signature), new TextEncoder().encode(canonicalJson(s.membership)));
  } catch {
    return false;
  }
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── Key persistence (IndexedDB stores CryptoKey objects without exposing bytes) ──
const DB = 'swarm-groupware';
function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('keys')) r.result.createObjectStore('keys'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function loadOrCreateHostKeys(): Promise<HostKeys> {
  const db = await openDb();
  const existing = await new Promise<HostKeys | undefined>((res) => {
    const g = db.transaction('keys').objectStore('keys').get('host');
    g.onsuccess = () => res(g.result as HostKeys | undefined);
    g.onerror = () => res(undefined);
  });
  if (existing?.privateKey && existing.publicJwk) return existing;
  const keys = await generateHostKeys();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction('keys', 'readwrite');
    tx.objectStore('keys').put(keys, 'host');
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  return keys;
}
