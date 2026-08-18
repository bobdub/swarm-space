import { get, getAll, put, remove, type Chunk, type Manifest } from '@/lib/store';
import { getCurrentUser } from '@/lib/auth';
import {
  listPersonalServers,
  updatePersonalServer,
  type PersonalServer,
} from './personalServerStore';
import {
  personalServerGet,
  personalServerHead,
  personalServerPut,
} from './personalServerProvider';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_ATTEMPTS = 8;

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

let running = false;
let timer: ReturnType<typeof setTimeout> | null = null;

function manifestKey(fileId: string): string {
  return `manifest:${fileId}`;
}

function syncId(serverId: string, manifestId: string): string {
  return `${serverId}:${manifestId}`;
}

function eligibleServers(): PersonalServer[] {
  return listPersonalServers().filter(
    (server) => server.scope === 'private' && !server.paused && server.usedBytes < server.capBytes,
  );
}

function encodeJson(value: unknown): ArrayBuffer {
  return encoder.encode(JSON.stringify(value)).buffer;
}

function schedule(delay = 250): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { void processPersonalServerSyncQueue(); }, delay);
}

async function updatePendingCounts(): Promise<void> {
  const records = await getAll<PersonalServerSyncRecord>('personalServerSync');
  for (const server of listPersonalServers()) {
    const pendingItems = records.filter(
      (record) => record.serverId === server.id && record.status !== 'complete',
    ).length;
    updatePersonalServer(server.id, { pendingItems });
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

  for (const ref of record.chunkRefs) {
    if (await personalServerHead(record.serverId, record.userId, ref)) continue;
    const chunk = await get<Record<string, unknown>>('chunks', ref);
    if (!chunk) throw new Error(`Local upload queue is missing chunk ${ref}.`);
    await personalServerPut(record.serverId, record.userId, ref, encodeJson(chunk));
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
    for (const ref of record.chunkRefs) await remove('chunks', ref);
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
  return null;
}

export function startPersonalServerSync(): void {
  void backfillPersonalServerSync();
  window.addEventListener('online', () => { void retryPersonalServerSync(); });
  setInterval(() => { void processPersonalServerSyncQueue(); }, 60_000);
}