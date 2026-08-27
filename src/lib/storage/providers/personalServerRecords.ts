/**
 * Device Record Replica — encrypted, content-addressed backup of the
 * *records* on this device (posts, projects, comments, world/builder data,
 * ledger snapshots …) to every linked personal server.
 *
 * The existing sync queue only ever carried media chunks + manifests, so a
 * text-only or world-only session wrote nothing to the server. This module
 * closes that gap.
 *
 * Security invariants:
 *  - Records are encrypted with a non-exportable, browser-bound AES-256-GCM
 *    key before leaving the device. The server only ever sees ciphertext.
 *  - Object keys are deterministic (`rec-<sha256(store:batch)>`) so updates
 *    overwrite instead of piling up duplicates.
 *  - Unchanged batches are skipped using a locally cached plaintext digest.
 */

import { get, getAll, put } from '@/lib/store';

const encoder = new TextEncoder();
const REPLICA_KEY_ID = 'replica-key:v1';
const STATE_KEY = 'personalServerRecordState:v1';
const BATCH_SIZE = 250;
/** Hard ceiling per encrypted batch object (well under the 20 MiB chunk cap). */
const MAX_BATCH_BYTES = 8 * 1024 * 1024;

/** IndexedDB stores replicated to the server, in priority order. */
export const REPLICA_STORES = [
  'posts',
  'projects',
  'users',
  'comments',
  'tasks',
  'milestones',
  'notifications',
  'entanglements',
  'connections',
  'replicas',
  'manifests',
  'blockchain',
  'tokenBalances',
  'nfts',
  'creditTransactions',
  'creditBalances',
  'achievementProgress',
  'miningSessions',
  'meta',
] as const;

/** localStorage prefixes that hold durable app state (never credentials). */
const LOCAL_PREFIXES = ['imagination.', 'swarm', 'world.', 'brain.'];
const LOCAL_DENY = ['token', 'secret', 'password', 'privateKey', 'creds'];

interface ReplicaKeyRecord { id: string; key: CryptoKey }
interface RecordStateEntry { digest: string; uploadedAt: number; bytes: number }
interface RecordStateDoc { k: string; v: Record<string, RecordStateEntry> }

export interface ReplicaBatch {
  /** Deterministic object key on the server. */
  objectKey: string;
  /** Human label, e.g. `posts#0`. */
  label: string;
  /** Digest of the plaintext, used to skip unchanged batches. */
  digest: string;
  /** Encrypted payload ready to PUT. */
  body: ArrayBuffer;
  itemCount: number;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)));
  }
  return btoa(binary);
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function sha256Hex(input: string | ArrayBuffer): Promise<string> {
  const buf = typeof input === 'string' ? asArrayBuffer(encoder.encode(input)) : input;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function getReplicaKey(): Promise<CryptoKey> {
  const existing = await get<ReplicaKeyRecord>('personalServerSecrets', REPLICA_KEY_ID);
  if (existing?.key) return existing.key;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  await put<ReplicaKeyRecord>('personalServerSecrets', { id: REPLICA_KEY_ID, key });
  return key;
}

async function readState(): Promise<Record<string, RecordStateEntry>> {
  const doc = await get<RecordStateDoc>('meta', STATE_KEY);
  return doc?.v ?? {};
}

async function writeState(state: Record<string, RecordStateEntry>): Promise<void> {
  await put<RecordStateDoc>('meta', { k: STATE_KEY, v: state });
}

function snapshotLocalStorage(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      if (!LOCAL_PREFIXES.some((p) => key.startsWith(p))) continue;
      if (LOCAL_DENY.some((d) => key.toLowerCase().includes(d.toLowerCase()))) continue;
      const value = localStorage.getItem(key);
      if (value && value.length < 512 * 1024) out[key] = value;
    }
  } catch { /* storage unavailable */ }
  return out;
}

async function encryptBatch(
  userId: string, label: string, payload: unknown,
): Promise<{ body: ArrayBuffer; digest: string } | null> {
  const plaintext = JSON.stringify(payload);
  const digest = await sha256Hex(plaintext);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: asArrayBuffer(iv),
      additionalData: asArrayBuffer(encoder.encode(`device-replica:v1:${userId}:${label}`)),
    },
    await getReplicaKey(),
    asArrayBuffer(encoder.encode(plaintext)),
  );
  const envelope = JSON.stringify({
    v: 1,
    label,
    userId,
    digest,
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(cipher)),
    createdAt: Date.now(),
  });
  const bytes = encoder.encode(envelope);
  if (bytes.byteLength > MAX_BATCH_BYTES) {
    console.warn(`[PersonalServerRecords] Batch ${label} too large (${bytes.byteLength}B) — skipped.`);
    return null;
  }
  return { body: asArrayBuffer(bytes), digest };
}

/**
 * Build the encrypted batches that represent this device's records.
 * Pure: performs no network I/O.
 */
export async function buildReplicaBatches(userId: string): Promise<ReplicaBatch[]> {
  const batches: ReplicaBatch[] = [];

  const push = async (label: string, items: unknown[]): Promise<void> => {
    const encrypted = await encryptBatch(userId, label, items);
    if (!encrypted) return;
    batches.push({
      objectKey: `rec-${await sha256Hex(`${userId}:${label}`)}`,
      label,
      digest: encrypted.digest,
      body: encrypted.body,
      itemCount: items.length,
    });
  };

  for (const store of REPLICA_STORES) {
    let items: unknown[] = [];
    try {
      items = await getAll<unknown>(store);
    } catch { continue; }
    if (store === 'meta') {
      // Skip transient/bulk meta rows; manifests already ride the chunk track.
      items = items.filter((entry) => {
        const k = (entry as { k?: string })?.k ?? '';
        return !k.startsWith('manifest:') && k !== STATE_KEY;
      });
    }
    if (items.length === 0) continue;
    for (let i = 0; i < items.length; i += BATCH_SIZE) {
      await push(`${store}#${i / BATCH_SIZE}`, items.slice(i, i + BATCH_SIZE));
    }
  }

  const local = snapshotLocalStorage();
  if (Object.keys(local).length > 0) await push('localStorage#0', [local]);

  return batches;
}

/** Batches whose plaintext changed since the last confirmed upload. */
export async function selectChangedBatches(
  serverId: string, batches: ReplicaBatch[],
): Promise<{ changed: ReplicaBatch[]; skipped: number }> {
  const state = await readState();
  const changed = batches.filter((b) => state[`${serverId}:${b.objectKey}`]?.digest !== b.digest);
  return { changed, skipped: batches.length - changed.length };
}

export async function markBatchUploaded(serverId: string, batch: ReplicaBatch): Promise<void> {
  const state = await readState();
  state[`${serverId}:${batch.objectKey}`] = {
    digest: batch.digest,
    uploadedAt: Date.now(),
    bytes: batch.body.byteLength,
  };
  await writeState(state);
}

export async function clearRecordState(serverId: string): Promise<void> {
  const state = await readState();
  for (const key of Object.keys(state)) {
    if (key.startsWith(`${serverId}:`)) delete state[key];
  }
  await writeState(state);
}

/** Signed-ish index object so the bucket is self-describing. */
export async function buildReplicaIndex(
  userId: string, batches: ReplicaBatch[],
): Promise<{ objectKey: string; body: ArrayBuffer }> {
  const index = {
    v: 1,
    userId,
    updatedAt: Date.now(),
    batches: batches.map((b) => ({ key: b.objectKey, label: b.label, items: b.itemCount, digest: b.digest })),
  };
  return {
    objectKey: `rec-index-${await sha256Hex(userId)}`,
    body: asArrayBuffer(encoder.encode(JSON.stringify(index))),
  };
}
