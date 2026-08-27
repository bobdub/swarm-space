import { get, getAll, put, remove, type Chunk, type Manifest } from '@/lib/store';
import { getCurrentUser } from '@/lib/auth';
import {
  listPersonalServers,
  subscribePersonalServers,
  updatePersonalServer,
  type PersonalServer,
} from './personalServerStore';
import {
  personalServerGet,
  personalServerHead,
  personalServerPut,
  personalServerPutPublic,
  personalServerPublicHead,
  publicMirrorGet,
} from './personalServerProvider';
import { listKnownMirrors } from './personalServerMirrors';
import { hasPersonalServerCredentials } from './personalServerSecrets';
import {
  buildReplicaBatches,
  buildReplicaIndex,
  clearRecordState,
  markBatchUploaded,
  selectChangedBatches,
} from './personalServerRecords';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_ATTEMPTS = 8;

const log = (...args: unknown[]) => console.log('[PersonalServerSync]', ...args);
const warn = (...args: unknown[]) => console.warn('[PersonalServerSync]', ...args);

export interface PersonalServerSyncRecord {
  id: string;
  serverId: string;
  userId: string;
  manifestId: string;
  manifestStore: 'manifests' | 'meta';
  chunkRefs: string[];
  status: 'pending' | 'syncing' | 'complete' | 'failed';
  attempts: number;
  nextAttemptAt: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

export interface PersonalServerDiagnostics {
  serverId: string;
  lastRunAt?: number;
  lastObjectKey?: string;
  lastError?: string;
  objectsWritten: number;
  recordsWritten: number;
  recordsSkipped: number;
  queued: number;
  failed: number;
  state: 'idle' | 'syncing' | 'relink-required' | 'paused' | 'error';
}

const diagnostics = new Map<string, PersonalServerDiagnostics>();
const diagListeners = new Set<(d: PersonalServerDiagnostics[]) => void>();

function diag(serverId: string): PersonalServerDiagnostics {
  let entry = diagnostics.get(serverId);
  if (!entry) {
    entry = {
      serverId, objectsWritten: 0, recordsWritten: 0, recordsSkipped: 0,
      queued: 0, failed: 0, state: 'idle',
    };
    diagnostics.set(serverId, entry);
  }
  return entry;
}

function emitDiagnostics(): void {
  const snapshot = Array.from(diagnostics.values()).map((d) => ({ ...d }));
  for (const fn of diagListeners) { try { fn(snapshot); } catch { /* ignore */ } }
}

function patchDiag(serverId: string, patch: Partial<PersonalServerDiagnostics>): void {
  Object.assign(diag(serverId), patch);
  emitDiagnostics();
}

export function getPersonalServerDiagnostics(): PersonalServerDiagnostics[] {
  return Array.from(diagnostics.values()).map((d) => ({ ...d }));
}

export function subscribePersonalServerDiagnostics(
  fn: (d: PersonalServerDiagnostics[]) => void,
): () => void {
  diagListeners.add(fn);
  try { fn(getPersonalServerDiagnostics()); } catch { /* ignore */ }
  return () => { diagListeners.delete(fn); };
}

let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function manifestKey(fileId: string): string {
  return `manifest:${fileId}`;
}

function syncId(serverId: string, manifestId: string): string {
  return `${serverId}:${manifestId}`;
}

/**
 * Every linked, non-paused server with room left receives the owner's own
 * replica — including `public-pin` servers, which previously received
 * nothing at all with no message saying so.
 */
function eligibleServers(): PersonalServer[] {
  return listPersonalServers().filter(
    (server) => !server.paused && server.usedBytes < server.capBytes,
  );
}

function encodeJson(value: unknown): ArrayBuffer {
  const encoded = encoder.encode(JSON.stringify(value));
  const copy = new Uint8Array(encoded.byteLength);
  copy.set(encoded);
  return copy.buffer;
}

function schedule(delay = 250): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { void processPersonalServerSyncQueue(); }, delay);
}

async function updatePendingCounts(): Promise<void> {
  const records = await getAll<PersonalServerSyncRecord>('personalServerSync');
  for (const server of listPersonalServers()) {
    const mine = records.filter((record) => record.serverId === server.id);
    const pendingItems = mine.filter((record) => record.status !== 'complete').length;
    updatePersonalServer(server.id, { pendingItems });
    patchDiag(server.id, {
      queued: pendingItems,
      failed: mine.filter((record) => record.status === 'failed').length,
    });
  }
}


export async function enqueueManifestForPersonalServers(manifest: Manifest): Promise<void> {
  const userId = getCurrentUser()?.id;
  if (!userId || !Array.isArray(manifest.chunks)) return;
  const now = Date.now();
  for (const server of eligibleServers()) {
    const id = syncId(server.id, manifest.fileId);
    const existing = await get<PersonalServerSyncRecord>('personalServerSync', id);
    if (existing?.status === 'complete') continue;
    await put<PersonalServerSyncRecord>('personalServerSync', {
      id,
      serverId: server.id,
      userId,
      manifestId: manifest.fileId,
      manifestStore: 'manifests',
      chunkRefs: [...manifest.chunks],
      status: 'pending',
      attempts: existing?.attempts ?? 0,
      nextAttemptAt: now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }
  await updatePendingCounts();
  schedule();
}

export async function enqueuePipelineContentForPersonalServers(
  manifest: { contentId: string; chunkRefs: string[] },
): Promise<void> {
  const userId = getCurrentUser()?.id;
  if (!userId) return;
  const now = Date.now();
  for (const server of eligibleServers()) {
    const id = syncId(server.id, manifest.contentId);
    const existing = await get<PersonalServerSyncRecord>('personalServerSync', id);
    if (existing?.status === 'complete') continue;
    await put<PersonalServerSyncRecord>('personalServerSync', {
      id,
      serverId: server.id,
      userId,
      manifestId: manifest.contentId,
      manifestStore: 'meta',
      chunkRefs: [...manifest.chunkRefs],
      status: 'pending',
      attempts: existing?.attempts ?? 0,
      nextAttemptAt: now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }
  await updatePendingCounts();
  schedule();
}

async function syncRecord(record: PersonalServerSyncRecord): Promise<void> {
  const manifest = record.manifestStore === 'meta'
    ? (await get<{ k: string; v: unknown }>('meta', manifestKey(record.manifestId)))?.v
    : await get<Manifest>('manifests', record.manifestId);
  if (!manifest) throw new Error(`Manifest ${record.manifestId} is no longer available locally.`);

  await put<PersonalServerSyncRecord>('personalServerSync', {
    ...record,
    status: 'syncing',
    updatedAt: Date.now(),
  });

  const server = listPersonalServers().find((entry) => entry.id === record.serverId);
  const mirrorPublicly = !!server?.sharePublic;

  for (const ref of record.chunkRefs) {
    const alreadyPrivate = await personalServerHead(record.serverId, record.userId, ref);
    let payload: ArrayBuffer | null = null;
    if (!alreadyPrivate) {
      const chunk = await get<Record<string, unknown>>('chunks', ref);
      if (!chunk) throw new Error(`Local upload queue is missing chunk ${ref}.`);
      payload = encodeJson(chunk);
      await personalServerPut(record.serverId, record.userId, ref, payload);
    }
    if (!mirrorPublicly) continue;
    try {
      if (await personalServerPublicHead(record.serverId, record.userId, ref)) continue;
      if (!payload) {
        const chunk = await get<Record<string, unknown>>('chunks', ref);
        if (!chunk) continue;
        payload = encodeJson(chunk);
      }
      await personalServerPutPublic(record.serverId, record.userId, ref, payload);
    } catch (error) {
      // Mirroring is best-effort; the private replica is the source of truth.
      console.warn('[PersonalServerSync] Public mirror write skipped:', error);
    }
  }

  const remoteManifestKey = manifestKey(record.manifestId);
  if (!(await personalServerHead(record.serverId, record.userId, remoteManifestKey))) {
    await personalServerPut(
      record.serverId,
      record.userId,
      remoteManifestKey,
      encodeJson(manifest),
    );
  }

  const verified = await Promise.all([
    ...record.chunkRefs.map((ref) => personalServerHead(record.serverId, record.userId, ref)),
    personalServerHead(record.serverId, record.userId, remoteManifestKey),
  ]);
  if (verified.some((ok) => !ok)) throw new Error('Remote verification did not confirm every object.');

  const completedAt = Date.now();
  await put<PersonalServerSyncRecord>('personalServerSync', {
    ...record,
    status: 'complete',
    attempts: record.attempts + 1,
    nextAttemptAt: 0,
    updatedAt: completedAt,
    error: undefined,
  });
  updatePersonalServer(record.serverId, { lastSyncedAt: completedAt });

  // Keep signed manifest/index metadata locally. Evict bulk bytes only after
  // every configured private replica for this manifest has completed.
  const allRecords = await getAll<PersonalServerSyncRecord>('personalServerSync');
  const manifestRecords = allRecords.filter((entry) => entry.manifestId === record.manifestId);
  if (manifestRecords.length > 0 && manifestRecords.every((entry) => (
    entry.id === record.id ? true : entry.status === 'complete'
  ))) {
    for (const ref of record.chunkRefs) {
      const neededByPendingManifest = allRecords.some((entry) => (
        entry.manifestId !== record.manifestId
        && entry.status !== 'complete'
        && entry.chunkRefs.includes(ref)
      ));
      if (!neededByPendingManifest) await remove('chunks', ref);
    }
  }
}

export async function processPersonalServerSyncQueue(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    const records = (await getAll<PersonalServerSyncRecord>('personalServerSync'))
      .filter((record) => record.status !== 'complete' && record.nextAttemptAt <= now)
      .sort((a, b) => a.createdAt - b.createdAt);
    for (const record of records) {
      try {
        await syncRecord(record);
      } catch (error) {
        const attempts = record.attempts + 1;
        const message = error instanceof Error ? error.message : String(error);
        await put<PersonalServerSyncRecord>('personalServerSync', {
          ...record,
          status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
          attempts,
          nextAttemptAt: Date.now() + Math.min(5 * 60_000, 2 ** attempts * 2_000),
          updatedAt: Date.now(),
          error: message,
        });
      }
    }
    await updatePendingCounts();
  } finally {
    running = false;
  }
}

export async function backfillPersonalServerSync(): Promise<void> {
  const manifests = await getAll<Manifest>('manifests');
  for (const manifest of manifests) await enqueueManifestForPersonalServers(manifest);
  const metaEntries = await getAll<{ k: string; v: { contentId?: string; chunkRefs?: string[] } }>('meta');
  for (const entry of metaEntries) {
    if (!entry.k.startsWith('manifest:') || !entry.v?.contentId || !Array.isArray(entry.v.chunkRefs)) continue;
    await enqueuePipelineContentForPersonalServers({
      contentId: entry.v.contentId,
      chunkRefs: entry.v.chunkRefs,
    });
  }
  await processPersonalServerSyncQueue();
}

export async function retryPersonalServerSync(serverId?: string): Promise<void> {
  const records = await getAll<PersonalServerSyncRecord>('personalServerSync');
  for (const record of records) {
    if (record.status === 'complete' || (serverId && record.serverId !== serverId)) continue;
    await put('personalServerSync', {
      ...record,
      status: 'pending',
      nextAttemptAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
  await processPersonalServerSyncQueue();
}

export async function clearPersonalServerSync(serverId: string): Promise<void> {
  const records = await getAll<PersonalServerSyncRecord>('personalServerSync');
  for (const record of records) {
    if (record.serverId === serverId) await remove('personalServerSync', record.id);
  }
}

async function verifyRemoteChunk(bytes: ArrayBuffer, expectedRef: string): Promise<boolean> {
  try {
    const chunk = JSON.parse(decoder.decode(bytes)) as Chunk & {
      index?: number;
      ciphertext?: string;
      contentId?: string;
    };
    if (chunk.ref !== expectedRef) return false;
    const hashInput = typeof chunk.cipher === 'string' && Number.isInteger(chunk.seq)
      ? chunk.cipher + chunk.seq
      : typeof chunk.ciphertext === 'string' && typeof chunk.contentId === 'string' && Number.isInteger(chunk.index)
        ? `${chunk.contentId}:${chunk.index}:${chunk.ciphertext}`
        : null;
    if (!hashInput) return false;
    const encoded = encoder.encode(hashInput);
    const source = new Uint8Array(encoded.byteLength);
    source.set(encoded);
    const digest = await crypto.subtle.digest('SHA-256', source.buffer);
    const hex = Array.from(new Uint8Array(digest))
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    return expectedRef === `chunk-${hex}` || expectedRef === `pc-${hex.slice(0, 32)}`;
  } catch {
    return false;
  }
}

export async function fetchChunkFromPersonalServers<T extends { ref: string } = Chunk>(ref: string): Promise<T | null> {
  const userId = getCurrentUser()?.id;
  if (!userId) return null;
  for (const server of eligibleServers()) {
    try {
      const bytes = await personalServerGet(
        server.id,
        userId,
        ref,
        (candidate) => verifyRemoteChunk(candidate, ref),
      );
      if (!bytes) continue;
      const chunk = JSON.parse(decoder.decode(bytes)) as T;
      await put('chunks', chunk);
      return chunk;
    } catch { /* try the next server */ }
  }
  return await fetchChunkFromPublicMirrors<T>(ref);
}

/**
 * Credential-free fallback: pull a shared chunk from any advertised mirror.
 * Works for peers who have no account on the server at all — bytes must
 * still pass the same hash/signature gate before they are cached.
 */
export async function fetchChunkFromPublicMirrors<T extends { ref: string } = Chunk>(
  ref: string,
): Promise<T | null> {
  for (const mirror of listKnownMirrors()) {
    try {
      const bytes = await publicMirrorGet(
        mirror,
        ref,
        (candidate) => verifyRemoteChunk(candidate, ref),
      );
      if (!bytes) continue;
      const chunk = JSON.parse(decoder.decode(bytes)) as T;
      await put('chunks', chunk);
      return chunk;
    } catch { /* try the next mirror */ }
  }
  return null;
}

export function startPersonalServerSync(): void {
  void backfillPersonalServerSync();
  window.addEventListener('online', () => { void retryPersonalServerSync(); });
  setInterval(() => { void processPersonalServerSyncQueue(); }, 60_000);
}