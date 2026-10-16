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

const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function generateHostKeys(): Promise<{ publicJwk: JsonWebKey; privateJwk: JsonWebKey }> {
  const kp = await crypto.subtle.generateKey(ALG, true, ['sign', 'verify']);
  return {
    publicJwk: await crypto.subtle.exportKey('jwk', kp.publicKey),
    privateJwk: await crypto.subtle.exportKey('jwk', kp.privateKey),
  };
}

export async function signMembership(m: GroupWareMembership, privateJwk: JsonWebKey): Promise<SignedGroupWareMembership> {
  const key = await crypto.subtle.importKey('jwk', privateJwk, ALG, false, ['sign']);
  const sig = await crypto.subtle.sign(SIGN, key, new TextEncoder().encode(canonicalJson(m)));
  return { membership: m, signature: b64(sig) };
}

export async function verifyMembership(s: SignedGroupWareMembership, publicJwk: JsonWebKey): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('jwk', publicJwk, ALG, false, ['verify']);
    return await crypto.subtle.verify(SIGN, key, unb64(s.signature), new TextEncoder().encode(canonicalJson(s.membership)));
  } catch {
    return false;
  }
}
