/**
 * Personal Server Mirrors — advertise and remember credential-free read
 * mirrors so peers can download shared project content directly from a
 * user's own server.
 *
 * Mirrors carry ciphertext only. Anything fetched from a mirror still has
 * to pass the content-hash + Stage 4 signature gate before it is cached,
 * so a hostile mirror can only fail the check, never inject content.
 */

import { listPublicMirrors, type PublicMirror } from './personalServerProvider';

const LS_KEY = 'imagination.personalServerMirrors.v1';
const MAX_MIRRORS = 24;

interface StoredMirror extends PublicMirror {
  seenAt: number;
}

function readAll(): StoredMirror[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((m) => m && typeof m.url === 'string') : [];
  } catch { return []; }
}

function writeAll(list: StoredMirror[]): void {
  try {
    localStorage.setItem(
      LS_KEY,
      JSON.stringify(list.sort((a, b) => b.seenAt - a.seenAt).slice(0, MAX_MIRRORS)),
    );
  } catch { /* ignore */ }
}

function isUsable(mirror: PublicMirror | undefined): mirror is PublicMirror {
  if (!mirror || typeof mirror.url !== 'string') return false;
  try {
    const u = new URL(mirror.url);
    // Only public HTTPS mirrors are ever contacted; a LAN address cannot
    // serve other users and must not be probed from a foreign network.
    return u.protocol === 'https:';
  } catch { return false; }
}

function keyOf(mirror: PublicMirror): string {
  return `${mirror.kind}|${mirror.url.replace(/\/$/, '')}|${mirror.bucket ?? ''}`;
}

/** Attach this device's advertised mirrors to an outgoing manifest. */
export function attachMirrorHints<T extends Record<string, unknown>>(manifest: T): T {
  const mirrors = listPublicMirrors().filter(isUsable);
  if (mirrors.length === 0) return manifest;
  return { ...manifest, mirrors };
}

/** Remember mirrors advertised on an incoming manifest. */
export function rememberMirrorHints(manifest: unknown): void {
  const hints = (manifest as { mirrors?: PublicMirror[] } | null)?.mirrors;
  if (!Array.isArray(hints) || hints.length === 0) return;
  const list = readAll();
  const seen = new Map(list.map((m) => [keyOf(m), m]));
  let changed = false;
  for (const hint of hints.slice(0, MAX_MIRRORS)) {
    if (!isUsable(hint)) continue;
    const entry: StoredMirror = {
      kind: hint.kind === 's3-compatible' ? 's3-compatible' : 'https-blob',
      url: hint.url,
      bucket: typeof hint.bucket === 'string' ? hint.bucket : undefined,
      seenAt: Date.now(),
    };
    seen.set(keyOf(entry), entry);
    changed = true;
  }
  if (changed) writeAll(Array.from(seen.values()));
}

/** Mirrors this device may try when a chunk is missing locally. */
export function listKnownMirrors(): PublicMirror[] {
  const own = listPublicMirrors().filter(isUsable);
  const seen = new Map(own.map((m) => [keyOf(m), m as PublicMirror]));
  for (const m of readAll()) if (isUsable(m)) seen.set(keyOf(m), m);
  return Array.from(seen.values());
}

export function clearKnownMirrors(): void {
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}
