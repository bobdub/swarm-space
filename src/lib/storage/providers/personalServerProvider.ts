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
  isLocalServerUrl,
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
  s3PublicPut, s3PublicHead, s3PublicDelete, s3AnonymousGet,
  type S3DirectConfig, type S3DirectCreds,
} from './adapters/s3Compatible';
import { httpsBlobAnonymousGet } from './adapters/httpsBlob';
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

async function getCreds<T>(serverId: string, userId: string): Promise<T> {
  const creds = await unsealServerCredentials(serverId, userId);
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

/**
 * Bytes written since the last throttled writeback. Without this the 2.5m
 * writeback throttle silently dropped every write in between, so the panel
 * reported far less stored than the server actually held.
 */
const pendingUsage = new Map<string, number>();

function accrueUsage(serverId: string, bytes: number, current: number): void {
  const pending = (pendingUsage.get(serverId) ?? 0) + bytes;
  if (!shouldWriteback(serverId)) {
    pendingUsage.set(serverId, pending);
    return;
  }
  pendingUsage.delete(serverId);
  updatePersonalServer(serverId, { usedBytes: current + pending });
}

export const personalServerPut = withHealth(
  'storage', 'personal-server.put',
  async (serverId: string, userId: string, hash: string, body: ArrayBuffer): Promise<void> => {
    const server = getPersonalServer(serverId);
    if (!server) throw new Error('Unknown personal server.');
    assertWritable(server, body.byteLength);

    if (server.kind === 'https-blob') {
      const creds = await getCreds<HttpsBlobCreds>(serverId, userId);
      await httpsBlobPut(server.url, creds, hash, body);
    } else {
      const creds = await getCreds<S3DirectCreds>(serverId, userId);
      await s3DirectPut(s3ConfigFor(server, userId), creds, hash, body);
    }

    accrueUsage(serverId, body.byteLength, server.usedBytes);
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
      const creds = await getCreds<HttpsBlobCreds>(serverId, userId);
      bytes = await httpsBlobGet(server.url, creds, hash);
    } else {
      const creds = await getCreds<S3DirectCreds>(serverId, userId);
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
      const creds = await getCreds<HttpsBlobCreds>(serverId, userId);
      await httpsBlobDelete(server.url, creds, hash);
    } else {
      const creds = await getCreds<S3DirectCreds>(serverId, userId);
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
    const creds = await getCreds<HttpsBlobCreds>(serverId, userId);
    return httpsBlobHead(server.url, creds, hash);
  }
  const creds = await getCreds<S3DirectCreds>(serverId, userId);
  return s3DirectHead(s3ConfigFor(server, userId), creds, hash);
}

async function sha256Hex(body: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', body);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Run a write+read+delete probe with a 1 KiB random payload.
 * The object key is the SHA-256 of the payload, matching the server
 * contract (servers reject a PUT whose body hash != the hash in the URL).
 */
export async function probePersonalServer(
  serverId: string, userId: string,
): Promise<{ ok: boolean; steps: { step: string; ok: boolean; error?: string }[] }> {
  const steps: { step: string; ok: boolean; error?: string }[] = [];
  const random = crypto.getRandomValues(new Uint8Array(1024));
  const probeBody = random.buffer.slice(0) as ArrayBuffer;
  const probeHash = await sha256Hex(probeBody);

  const finishProbe = async (): Promise<{ ok: boolean; steps: { step: string; ok: boolean; error?: string }[] }> => {
    const ok = steps.every((step) => step.ok);
    const firstFail = steps.find((step) => !step.ok);
    const health: PersonalServerHealth = {
      ok,
      checkedAt: Date.now(),
      steps,
      ...(firstFail ? { error: `${firstFail.step}: ${firstFail.error ?? 'failed'}` } : {}),
    };

    const server = getPersonalServer(serverId);
    if (ok && server?.kind === 'https-blob') {
      try {
        const creds = await getCreds<HttpsBlobCreds>(serverId, userId);
        const serverHealth = await httpsBlobHealth(server.url, creds);
        if (serverHealth.used !== undefined) health.usedBytes = serverHealth.used;
        if (serverHealth.cap !== undefined) health.capBytes = serverHealth.cap;
      } catch { /* optional */ }
    }

    updatePersonalServer(serverId, { health });
    return { ok, steps };
  };

  try {
    await personalServerPut(serverId, userId, probeHash, probeBody);
    steps.push({ step: 'write', ok: true });
  } catch (e) {
    steps.push({ step: 'write', ok: false, error: (e as Error).message });
    return finishProbe();
  }

  try {
    const got = await personalServerGet(serverId, userId, probeHash, async () => true);
    const ok = !!got && got.byteLength === probeBody.byteLength;
    if (!ok) throw new Error('Read mismatch');
    steps.push({ step: 'read', ok: true });
  } catch (e) {
    steps.push({ step: 'read', ok: false, error: (e as Error).message });
  }

  try {
    await personalServerDelete(serverId, userId, probeHash);
    steps.push({ step: 'delete', ok: true });
  } catch (e) {
    steps.push({ step: 'delete', ok: false, error: (e as Error).message });
  }

  return finishProbe();
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

// ── Public mirror (peer downloads) ─────────────────────────────────────

export interface PublicMirror {
  kind: PersonalServer['kind'];
  /** Base endpoint (S3 endpoint or HTTPS-blob base URL). */
  url: string;
  /** S3 bucket, when kind === 's3-compatible'. */
  bucket?: string;
}

/** Mirrors on this device that are advertised to peers. */
export function listPublicMirrors(): PublicMirror[] {
  return listPersonalServers()
    .filter((s) => s.sharePublic && !s.paused && !isLocalServerUrl(s.url))
    .map((s) => ({ kind: s.kind, url: s.url, bucket: s.bucket }));
}

/** Write ciphertext to the credential-free mirror prefix. */
export async function personalServerPutPublic(
  serverId: string, userId: string, hash: string, body: ArrayBuffer,
): Promise<void> {
  const server = getPersonalServer(serverId);
  if (!server || !server.sharePublic) return;
  assertWritable(server, body.byteLength);
  const cap = server.publicCapBytes ?? server.capBytes;
  if ((server.publicBytes ?? 0) + body.byteLength > cap) {
    throw new Error(`Public mirror cap reached on "${server.name}".`);
  }
  if (server.kind === 'https-blob') {
    // The HTTPS-blob contract already serves /chunks/:hash; the owner opts
    // into anonymous GET on the server side.
    const creds = await getCreds<HttpsBlobCreds>(serverId, userId);
    await httpsBlobPut(server.url, creds, hash, body);
  } else {
    const creds = await getCreds<S3DirectCreds>(serverId, userId);
    await s3PublicPut(s3ConfigFor(server, userId), creds, hash, body);
  }
  updatePersonalServer(serverId, { publicBytes: (server.publicBytes ?? 0) + body.byteLength });
}

export async function personalServerPublicHead(
  serverId: string, userId: string, hash: string,
): Promise<boolean> {
  const server = getPersonalServer(serverId);
  if (!server || !server.sharePublic) return false;
  if (server.kind === 'https-blob') {
    const creds = await getCreds<HttpsBlobCreds>(serverId, userId);
    return httpsBlobHead(server.url, creds, hash);
  }
  const creds = await getCreds<S3DirectCreds>(serverId, userId);
  return s3PublicHead(s3ConfigFor(server, userId), creds, hash);
}

/** Owner control: stop sharing and delete a mirrored object. */
export async function personalServerPublicDelete(
  serverId: string, userId: string, hash: string,
): Promise<void> {
  const server = getPersonalServer(serverId);
  if (!server) return;
  if (server.kind === 'https-blob') {
    const creds = await getCreds<HttpsBlobCreds>(serverId, userId);
    await httpsBlobDelete(server.url, creds, hash);
  } else {
    const creds = await getCreds<S3DirectCreds>(serverId, userId);
    await s3PublicDelete(s3ConfigFor(server, userId), creds, hash);
  }
}

/**
 * Credential-free read from someone else's advertised mirror. Bytes are
 * untrusted until `verify` (content hash + Stage 4 signature) passes.
 */
export async function publicMirrorGet(
  mirror: PublicMirror,
  hash: string,
  verify: (bytes: ArrayBuffer) => Promise<boolean>,
): Promise<ArrayBuffer | null> {
  let bytes: ArrayBuffer | null = null;
  try {
    bytes = mirror.kind === 's3-compatible' && mirror.bucket
      ? await s3AnonymousGet(mirror.url, mirror.bucket, hash)
      : await httpsBlobAnonymousGet(mirror.url, hash);
  } catch { return null; }
  if (!bytes) return null;
  if (!(await verify(bytes))) {
    spikeHealth('storage', 'personal-server.mirror-bad-chunk', 1.0);
    console.warn('[PersonalServer] Mirror bytes failed verification — rejected.');
    return null;
  }
  return bytes;
}
