/**
 * Personal Server Store — metadata about user-linked storage servers.
 *
 * NOTE: Credentials (bearer tokens, S3 secrets) NEVER land here. They live
 * only in the In-Memory Vault (src/lib/crypto/memoryVault.ts). What we keep
 * on disk is non-secret metadata + a sealed credential blob produced by the
 * vault. A relink prompt is expected after a fresh tab open if the vault
 * key was lost (Brave / private mode behaviour).
 */

import { vault, type SealedValue } from '@/lib/crypto/memoryVault';

const LS_KEY = 'imagination.personalServers.v1';

export type PersonalServerKind = 'https-blob' | 's3-compatible';
export type PersonalServerScope = 'private' | 'public-pin';

export interface PersonalServerHealth {
  ok: boolean;
  checkedAt: number;
  usedBytes?: number;
  capBytes?: number;
  error?: string;
}

export interface PersonalServer {
  id: string;
  name: string;
  kind: PersonalServerKind;
  url: string;             // HTTPS endpoint or S3 endpoint
  scope: PersonalServerScope;
  capBytes: number;        // user-adjustable storage cap
  usedBytes: number;
  paused: boolean;
  createdAt: number;
  health?: PersonalServerHealth;
  /** Sealed credentials blob (vault-encrypted JSON). Lost on tab close. */
  sealedCreds?: SealedValue;
  /** Per-server allow/deny list of content hashes (local only). */
  denyHashes?: string[];
  /** S3-only fields (non-secret). */
  bucket?: string;
  region?: string;
}

function read(): PersonalServer[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function write(list: PersonalServer[]): void {
  try { localStorage.setItem(LS_KEY, JSON.stringify(list)); } catch { /* ignore */ }
  for (const fn of listeners) { try { fn(list); } catch { /* ignore */ } }
}

const listeners = new Set<(list: PersonalServer[]) => void>();

export function subscribePersonalServers(fn: (list: PersonalServer[]) => void): () => void {
  listeners.add(fn);
  try { fn(read()); } catch { /* ignore */ }
  return () => { listeners.delete(fn); };
}

export function listPersonalServers(): PersonalServer[] {
  return read();
}

export function getPersonalServer(id: string): PersonalServer | undefined {
  return read().find((s) => s.id === id);
}

export function upsertPersonalServer(server: PersonalServer): void {
  const list = read();
  const idx = list.findIndex((s) => s.id === server.id);
  if (idx >= 0) list[idx] = server; else list.push(server);
  write(list);
}

export function removePersonalServer(id: string): void {
  write(read().filter((s) => s.id !== id));
}

export function updatePersonalServer(id: string, patch: Partial<PersonalServer>): void {
  const list = read();
  const idx = list.findIndex((s) => s.id === id);
  if (idx < 0) return;
  list[idx] = { ...list[idx], ...patch };
  write(list);
}

/** Seal credentials into the in-memory vault and persist the sealed blob. */
export async function sealServerCredentials(
  id: string,
  credentials: Record<string, string>,
): Promise<void> {
  const sealed = await vault.seal(JSON.stringify(credentials));
  updatePersonalServer(id, { sealedCreds: sealed });
}

/** Returns null if vault was reset (tab close) — caller must prompt relink. */
export async function unsealServerCredentials(
  id: string,
): Promise<Record<string, string> | null> {
  const server = getPersonalServer(id);
  if (!server?.sealedCreds) return null;
  try {
    const plain = await vault.unseal(server.sealedCreds);
    return JSON.parse(plain);
  } catch {
    return null;
  }
}

export function newServerId(): string {
  return `psv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** HTTPS-only with localhost dev exemption. */
export function isUrlAcceptable(url: string): { ok: boolean; reason?: string } {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return { ok: true };
    if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) {
      return { ok: true };
    }
    return { ok: false, reason: 'HTTPS is required (only http://localhost is allowed for dev).' };
  } catch {
    return { ok: false, reason: 'Invalid URL.' };
  }
}

export const DEFAULT_SERVER_CAP_BYTES = 1024 * 1024 * 1024; // 1 GiB
export const MAX_CHUNK_BYTES = 20 * 1024 * 1024;            // 20 MiB Core rule