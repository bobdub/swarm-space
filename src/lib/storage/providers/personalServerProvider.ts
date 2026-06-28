/**
 * Personal Server Provider — single entry point for chunk I/O against
 * user-linked storage servers. Routes through the right adapter based on
 * `kind`, enforces caps + URL rules, throttles writes, and feeds Q_Score.
 *
 * Security invariants:
 *  - Plaintext NEVER touches this module. Inputs are already-encrypted
 *    ciphertext chunks from the V2 pipeline.
 *  - Reads MUST go through verifyChunkBytes() before reaching any cache.
 *  - Credentials are unsealed from the In-Memory Vault per call and
 *    discarded immediately after.
 *  - HTTPS-only with localhost dev exemption (enforced in store).
 */

import {
  getPersonalServer,
  listPersonalServers,
  unsealServerCredentials,
  updatePersonalServer,
  isUrlAcceptable,
  MAX_CHUNK_BYTES,
  type PersonalServer,
  type PersonalServerHealth,
} from './personalServerStore';
import {
  httpsBlobPut, httpsBlobGet, httpsBlobHead, httpsBlobDelete, httpsBlobHealth,
  type HttpsBlobCreds,
} from './adapters/httpsBlob';
import {
  s3DirectPut, s3DirectGet, s3DirectHead, s3DirectDelete,
  type S3DirectConfig, type S3DirectCreds,
} from './adapters/s3Compatible';
import { withHealth, spikeHealth } from '@/lib/uqrc/withHealth';

// ── throttle (2.5m Core rule) for usage / health writeback ─────────────
const WRITE_THROTTLE_MS = 2.5 * 60 * 1000;
const lastWriteback = new Map<string, number>();
function shouldWriteback(id: string): boolean {
  const last = lastWriteback.get(id) ?? 0;
  if (Date.now() - last < WRITE_THROTTLE_MS) return false;
  lastWriteback.set(id, Date.now());
  return true;
}

function assertWritable(server: PersonalServer, byteSize: number): void {
  if (server.paused) throw new Error(`Server "${server.name}" is paused.`);
  const urlCheck = isUrlAcceptable(server.url);
  if (!urlCheck.ok) {
    throw new Error(urlCheck.reason);
  }
  if (byteSize > MAX_CHUNK_BYTES) {
    throw new Error(`Chunk exceeds 20 MiB cap (${byteSize} bytes).`);
  }
  if (server.usedBytes + byteSize > server.capBytes) {
    throw new Error(`Server "${server.name}" cap exceeded.`);
  }
}

async function getCreds<T>(serverId: string): Promise<T> {
  const creds = await unsealServerCredentials(serverId);
  if (!creds) {
    spikeHealth('storage', `personal-server.creds-missing:${serverId}`, 0.9);
    throw new Error('Server credentials missing — please relink this server.');
  }
  return creds as unknown as T;
}

function s3ConfigFor(server: PersonalServer, userId: string): S3DirectConfig {
  if (!server.bucket || !server.region) {
    throw new Error('S3 server missing bucket/region config.');
  }
  return {
    endpoint: server.url,
    region: server.region,
    bucket: server.bucket,
    userId,
  };
}

// ── PUT ────────────────────────────────────────────────────────────────

export const personalServerPut = withHealth(
  'storage', 'personal-server.put',
  async (serverId: string, userId: string, hash: string, body: ArrayBuffer): Promise<void> => {
    const server = getPersonalServer(serverId);
    if (!server) throw new Error('Unknown personal server.');
    assertWritable(server, body.byteLength);

    if (server.kind === 'https-blob') {
      const creds = await getCreds<HttpsBlobCreds>(serverId);
      await httpsBlobPut(server.url, creds, hash, body);
    } else {
      const creds = await getCreds<S3DirectCreds>(serverId);
      await s3DirectPut(s3ConfigFor(server, userId), creds, hash, body);
    }

    if (shouldWriteback(serverId)) {
      updatePersonalServer(serverId, { usedBytes: server.usedBytes + body.byteLength });
    }
  },
);

// ── GET (signature-gated) ──────────────────────────────────────────────

/**
 * Fetch a chunk; verifier MUST run before bytes touch the cache.
 * `verify` returns true if the bytes match the expected hash + signature.
 */
export const personalServerGet = withHealth(
  'storage', 'personal-server.get',
  async (
    serverId: string,
    userId: string,
    hash: string,
    verify: (bytes: ArrayBuffer) => Promise<boolean>,
  ): Promise<ArrayBuffer | null> => {
    const server = getPersonalServer(serverId);
    if (!server) throw new Error('Unknown personal server.');

    let bytes: ArrayBuffer | null;
    if (server.kind === 'https-blob') {
      const creds = await getCreds<HttpsBlobCreds>(serverId);
      bytes = await httpsBlobGet(server.url, creds, hash);
    } else {
      const creds = await getCreds<S3DirectCreds>(serverId);
      bytes = await s3DirectGet(s3ConfigFor(server, userId), creds, hash);
    }
    if (!bytes) return null;

    const ok = await verify(bytes);
    if (!ok) {
      spikeHealth('storage', `personal-server.bad-chunk:${serverId}`, 1.0);
      console.warn('[PersonalServer] Signature/hash mismatch — chunk rejected.');
      return null;
    }
    return bytes;
  },
);

// ── DELETE / HEAD / HEALTH ─────────────────────────────────────────────

export const personalServerDelete = withHealth(
  'storage', 'personal-server.del',
  async (serverId: string, userId: string, hash: string): Promise<void> => {
    const server = getPersonalServer(serverId);
    if (!server) throw new Error('Unknown personal server.');
    if (server.kind === 'https-blob') {
      const creds = await getCreds<HttpsBlobCreds>(serverId);
      await httpsBlobDelete(server.url, creds, hash);
    } else {
      const creds = await getCreds<S3DirectCreds>(serverId);
      await s3DirectDelete(s3ConfigFor(server, userId), creds, hash);
    }
  },
);

export async function personalServerHead(
  serverId: string, userId: string, hash: string,
): Promise<boolean> {
  const server = getPersonalServer(serverId);
  if (!server) return false;
  if (server.kind === 'https-blob') {
    const creds = await getCreds<HttpsBlobCreds>(serverId);
    return httpsBlobHead(server.url, creds, hash);
  }
  const creds = await getCreds<S3DirectCreds>(serverId);
  return s3DirectHead(s3ConfigFor(server, userId), creds, hash);
}

/** Run a write+read+delete probe with a 1 KiB random payload. */
export async function probePersonalServer(
  serverId: string, userId: string,
): Promise<{ ok: boolean; steps: { step: string; ok: boolean; error?: string }[] }> {
  const steps: { step: string; ok: boolean; error?: string }[] = [];
  const random = crypto.getRandomValues(new Uint8Array(1024));
  const probeHash = 'probe-' + crypto.randomUUID();

  try {
    await personalServerPut(serverId, userId, probeHash, random.buffer);
    steps.push({ step: 'write', ok: true });
  } catch (e) {
    steps.push({ step: 'write', ok: false, error: (e as Error).message });
    return { ok: false, steps };
  }

  try {
    const got = await personalServerGet(serverId, userId, probeHash, async () => true);
    const ok = !!got && got.byteLength === random.byteLength;
    steps.push({ step: 'read', ok });
    if (!ok) throw new Error('Read mismatch');
  } catch (e) {
    steps.push({ step: 'read', ok: false, error: (e as Error).message });
  }

  try {
    await personalServerDelete(serverId, userId, probeHash);
    steps.push({ step: 'delete', ok: true });
  } catch (e) {
    steps.push({ step: 'delete', ok: false, error: (e as Error).message });
  }

  const ok = steps.every((s) => s.ok);
  const health: PersonalServerHealth = { ok, checkedAt: Date.now() };

  // For HTTPS blob, also pull /health
  const server = getPersonalServer(serverId);
  if (ok && server?.kind === 'https-blob') {
    try {
      const creds = await getCreds<HttpsBlobCreds>(serverId);
      const h = await httpsBlobHealth(server.url, creds);
      if (h.used !== undefined) health.usedBytes = h.used;
      if (h.cap !== undefined) health.capBytes = h.cap;
    } catch { /* optional */ }
  }
  updatePersonalServer(serverId, { health });
  return { ok, steps };
}

// ── Redundancy seeder candidate hook ───────────────────────────────────

/**
 * Returns servers eligible to seed *other users'* already-encrypted,
 * signature-verified chunks. Consumed by the Redundancy Sweep — we don't
 * add a new gossip path.
 */
export function getPublicPinServers(): PersonalServer[] {
  return listPersonalServers().filter(
    (s) => s.scope === 'public-pin' && !s.paused && s.usedBytes < s.capBytes,
  );
}

/** Local-only abuse-report path: deny + delete a chunk on every public-pin server. */
export async function denyAndPurgeChunk(
  hash: string, userId: string,
): Promise<void> {
  for (const server of getPublicPinServers()) {
    try { await personalServerDelete(server.id, userId, hash); } catch { /* ignore */ }
    const deny = new Set(server.denyHashes ?? []);
    deny.add(hash);
    updatePersonalServer(server.id, { denyHashes: Array.from(deny) });
  }
}