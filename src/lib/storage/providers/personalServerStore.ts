/**
 * Personal Server Store — metadata about user-linked storage servers.
 *
 * NOTE: Credentials (bearer tokens, S3 secrets) NEVER land here. They are
 * encrypted in IndexedDB with a browser-bound, non-exportable device key.
 * This store keeps only non-secret metadata and legacy sealed blobs.
 */

import { type SealedValue } from '@/lib/crypto/memoryVault';
import { isLocalHostname } from './adapters/netError';
import {
  persistPersonalServerCredentials,
  readPersonalServerCredentials,
  removePersonalServerCredentials,
} from './personalServerSecrets';

const LS_KEY = 'imagination.personalServers.v1';

export type PersonalServerKind = 'https-blob' | 's3-compatible';
export type PersonalServerScope = 'private' | 'public-pin';

export interface PersonalServerHealth {
  ok: boolean;
  checkedAt: number;
  usedBytes?: number;
  capBytes?: number;
  error?: string;
  /** Per-step outcome of the last write/read/delete probe. */
  steps?: { step: string; ok: boolean; error?: string }[];
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
  /** Legacy session-only credential blob. New records use IndexedDB. */
  sealedCreds?: SealedValue;
  /** Per-server allow/deny list of content hashes (local only). */
  denyHashes?: string[];
  /** S3-only fields (non-secret). */
  bucket?: string;
  region?: string;
  lastSyncedAt?: number;
  pendingItems?: number;
  /** Mirror encrypted project content under a credential-free public prefix. */
  sharePublic?: boolean;
  /** Bytes written to the public mirror prefix (local estimate). */
  publicBytes?: number;
  /** Cap for the public mirror prefix. */
  publicCapBytes?: number;
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

export function removePersonalServer(id: string, userId?: string): void {
  write(read().filter((s) => s.id !== id));
  if (userId) void removePersonalServerCredentials(userId, id);
  void import('./personalServerSync').then((sync) => sync.clearPersonalServerSync(id));
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
  userId: string,
): Promise<void> {
  await persistPersonalServerCredentials(userId, id, credentials);
  updatePersonalServer(id, { sealedCreds: undefined });
}

/** Returns null if vault was reset (tab close) — caller must prompt relink. */
export async function unsealServerCredentials(
  id: string,
  userId: string,
): Promise<Record<string, string> | null> {
  return readPersonalServerCredentials(userId, id);
}

export function newServerId(): string {
  return `psv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * HTTPS everywhere on the public internet; plain HTTP is allowed only for
 * addresses that cannot leave your own machine or LAN (loopback, *.local,
 * private IPv4 ranges) — which is where a desktop-hosted server lives.
 */
export function isUrlAcceptable(url: string): { ok: boolean; reason?: string } {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:') return { ok: true };
    if (u.protocol === 'http:' && isLocalHostname(u.hostname)) return { ok: true };
    return {
      ok: false,
      reason: 'HTTPS is required for public addresses. Plain http:// works only for '
        + 'localhost, *.local, or a private LAN address (10.x, 172.16–31.x, 192.168.x).',
    };
  } catch {
    return { ok: false, reason: 'Invalid URL.' };
  }
}

/** True when the URL points at this device or the local network. */
export function isLocalServerUrl(url: string): boolean {
  try { return isLocalHostname(new URL(url).hostname); } catch { return false; }
}

export const DEFAULT_SERVER_CAP_BYTES = 1024 * 1024 * 1024; // 1 GiB
export const MAX_CHUNK_BYTES = 20 * 1024 * 1024;            // 20 MiB Core rule