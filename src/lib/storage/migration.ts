import { getStoragePolicy } from './policy';
import {
  deleteBlob,
  getBlob,
  list,
  putBlob,
  readStorageUsage,
  stat,
  type StorageProviderId,
} from './providers';
import type { StorageData } from './providers/types';

const ELIGIBLE_SCOPES = ['chunks', 'recordings'] as const;
const POINTER_PREFIX = 'placement:';
const MIGRATION_SESSION_PREFIX = 'migration:session:';
const REBALANCE_JOB_KEY = 'storage:rebalance:active';

const DEFAULT_BATCH_SIZE = 20;
const MAX_FAILURE_RETRIES = 3;

export type MigrationClassification = 'eligible' | 'already-external' | 'missing' | 'read-failed';

export interface MigrationCandidate {
  scope: (typeof ELIGIBLE_SCOPES)[number];
  key: string;
  size: number;
  updatedAt: number;
  classification: MigrationClassification;
}

export interface MigrationScanReport {
  scanned: number;
  eligibleCount: number;
  eligibleBytes: number;
  candidates: MigrationCandidate[];
}

export interface MigrationFailedItem {
  scope: (typeof ELIGIBLE_SCOPES)[number];
  key: string;
  size: number;
  attempts: number;
  error: string;
}

export interface MigrationSession {
  id: string;
  provider: Exclude<StorageProviderId, 'indexeddb'>;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  baselineInternalBytes: number;
  pending: MigrationCandidate[];
  moved: MigrationCandidate[];
  failed: MigrationFailedItem[];
}

export interface MigrationBatchResult {
  session: MigrationSession;
  movedInBatch: number;
  failedInBatch: number;
  bytesMovedInBatch: number;
  progress: number;
}

export interface MigrationVerificationResult {
  checked: number;
  verified: number;
  failed: Array<{ scope: string; key: string; reason: string }>;
  internalBytesBefore: number;
  internalBytesAfter: number;
  internalBytesReduced: number;
}

function pointerKey(scope: string, key: string): string {
  return `${POINTER_PREFIX}${scope}:${key}`;
}

function migrationSessionKey(id: string): string {
  return `${MIGRATION_SESSION_PREFIX}${id}`;
}

function candidateId(candidate: Pick<MigrationCandidate, 'scope' | 'key'>): string {
  return `${candidate.scope}:${candidate.key}`;
}

function estimateSizeBytes(data: StorageData): number {
  if (data instanceof Blob) return data.size;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (data instanceof Uint8Array) return data.byteLength;
  if (typeof data === 'string') return new TextEncoder().encode(data).byteLength;
  return new TextEncoder().encode(JSON.stringify(data ?? null)).byteLength;
}

async function sha256Hex(data: StorageData): Promise<string> {
  let bytes: Uint8Array;
  if (data instanceof Blob) {
    bytes = new Uint8Array(await data.arrayBuffer());
  } else if (data instanceof ArrayBuffer) {
    bytes = new Uint8Array(data);
  } else if (data instanceof Uint8Array) {
    bytes = data;
  } else if (typeof data === 'string') {
    bytes = new TextEncoder().encode(data);
  } else {
    bytes = new TextEncoder().encode(JSON.stringify(data ?? null));
  }

  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export async function scanMovableData(): Promise<MigrationScanReport> {
  const candidates: MigrationCandidate[] = [];

  for (const scope of ELIGIBLE_SCOPES) {
    const stats = await list(scope, undefined, 'indexeddb');
    for (const entry of stats) {
      const pointer = await getBlob<Record<string, unknown>>('meta', pointerKey(scope, entry.key), 'indexeddb');
      if (pointer) {
        candidates.push({
          scope,
          key: entry.key,
          size: entry.size,
          updatedAt: entry.updatedAt,
          classification: 'already-external',
        });
        continue;
      }

      candidates.push({
        scope,
        key: entry.key,
        size: entry.size,
        updatedAt: entry.updatedAt,
        classification: 'eligible',
      });
    }
  }

  const eligible = candidates.filter((candidate) => candidate.classification === 'eligible');
  return {
    scanned: candidates.length,
    eligibleCount: eligible.length,
    eligibleBytes: eligible.reduce((sum, candidate) => sum + candidate.size, 0),
    candidates,
  };
}

export async function estimateDestinationFreeBytes(): Promise<number | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
    return null;
  }
  const estimate = await navigator.storage.estimate();
  if (typeof estimate.quota !== 'number' || typeof estimate.usage !== 'number') {
    return null;
  }
  return Math.max(estimate.quota - estimate.usage, 0);
}

export async function createMigrationSession(
  provider: Exclude<StorageProviderId, 'indexeddb'> = 'filesystem-access',
  batchSize = DEFAULT_BATCH_SIZE,
): Promise<MigrationSession> {
  const report = await scanMovableData();
  const usage = await readStorageUsage();

  const session: MigrationSession = {
    id: crypto.randomUUID(),
    provider,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    baselineInternalBytes: usage.indexeddb,
    pending: report.candidates
      .filter((candidate) => candidate.classification === 'eligible')
      .sort((a, b) => a.updatedAt - b.updatedAt || b.size - a.size)
      .slice(0, Math.max(batchSize, 1) * 500),
    moved: [],
    failed: [],
  };

  await putBlob('meta', migrationSessionKey(session.id), session, 'indexeddb');
  return session;
}

export async function loadMigrationSession(sessionId: string): Promise<MigrationSession | null> {
  return getBlob<MigrationSession>('meta', migrationSessionKey(sessionId), 'indexeddb');
}

async function saveMigrationSession(session: MigrationSession): Promise<void> {
  session.updatedAt = Date.now();
  await putBlob('meta', migrationSessionKey(session.id), session, 'indexeddb');
}

async function migrateCandidate(candidate: MigrationCandidate, provider: Exclude<StorageProviderId, 'indexeddb'>): Promise<void> {
  const payload = await getBlob<StorageData>(candidate.scope, candidate.key, 'indexeddb');
  if (payload == null) {
    throw new Error('Source blob missing from internal storage');
  }

  const checksum = await sha256Hex(payload);
  let pointerWritten = false;

  try {
    await putBlob(candidate.scope, candidate.key, payload, provider);

    const externalPayload = await getBlob<StorageData>(candidate.scope, candidate.key, provider);
    if (externalPayload == null) {
      throw new Error('External write missing after put');
    }

    const externalChecksum = await sha256Hex(externalPayload);
    if (checksum !== externalChecksum) {
      throw new Error('Checksum mismatch after external copy');
    }

    await putBlob('meta', pointerKey(candidate.scope, candidate.key), {
      version: 1,
      scope: candidate.scope,
      key: candidate.key,
      provider,
      externalKey: candidate.key,
      checksum,
      size: estimateSizeBytes(payload),
      storedAt: Date.now(),
      migrationVersion: 1,
    }, 'indexeddb');
    pointerWritten = true;

    await deleteBlob(candidate.scope, candidate.key, 'indexeddb');
  } catch (error) {
    if (!pointerWritten) {
      await deleteBlob(candidate.scope, candidate.key, provider);
    }
    throw error;
  }
}

export async function runMigrationBatch(
  sessionId: string,
  options?: { maxItems?: number; retryFailed?: boolean },
): Promise<MigrationBatchResult> {
  const session = await loadMigrationSession(sessionId);
  if (!session) {
    throw new Error(`Migration session not found: ${sessionId}`);
  }

  if (!session.startedAt) {
    session.startedAt = Date.now();
  }

  const maxItems = Math.max(options?.maxItems ?? DEFAULT_BATCH_SIZE, 1);
  const queue = [...session.pending];
  if (options?.retryFailed) {
    const retryable = session.failed.filter((item) => item.attempts < MAX_FAILURE_RETRIES);
    queue.push(
      ...retryable.map((item) => ({
        scope: item.scope,
        key: item.key,
        size: item.size,
        updatedAt: Date.now(),
        classification: 'eligible' as const,
      })),
    );
  }

  const seen = new Set<string>();
  const batch = queue.filter((candidate) => {
    const id = candidateId(candidate);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, maxItems);

  let movedInBatch = 0;
  let bytesMovedInBatch = 0;
  let failedInBatch = 0;

  for (const candidate of batch) {
    try {
      await migrateCandidate(candidate, session.provider);
      movedInBatch += 1;
      bytesMovedInBatch += candidate.size;
      session.pending = session.pending.filter((item) => candidateId(item) !== candidateId(candidate));
      session.failed = session.failed.filter((item) => candidateId(item) !== candidateId(candidate));
      session.moved.push(candidate);
    } catch (error) {
      failedInBatch += 1;
      const previous = session.failed.find((item) => candidateId(item) === candidateId(candidate));
      const attempts = (previous?.attempts ?? 0) + 1;
      const failure: MigrationFailedItem = {
        scope: candidate.scope,
        key: candidate.key,
        size: candidate.size,
        attempts,
        error: error instanceof Error ? error.message : 'Unknown migration error',
      };
      session.failed = session.failed.filter((item) => candidateId(item) !== candidateId(candidate));
      session.failed.push(failure);
      session.pending = session.pending.filter((item) => candidateId(item) !== candidateId(candidate));
      if (attempts < MAX_FAILURE_RETRIES) {
        session.pending.push(candidate);
      }
    }
  }

  if (session.pending.length === 0) {
    session.completedAt = Date.now();
  }

  await saveMigrationSession(session);

  const total = session.pending.length + session.moved.length + session.failed.length;
  const progress = total === 0 ? 1 : session.moved.length / total;

  return {
    session,
    movedInBatch,
    failedInBatch,
    bytesMovedInBatch,
    progress,
  };
}

export async function rollbackMigrationSession(sessionId: string): Promise<{ rolledBack: number; failed: number }> {
  const session = await loadMigrationSession(sessionId);
  if (!session) {
    throw new Error(`Migration session not found: ${sessionId}`);
  }

  let rolledBack = 0;
  let failed = 0;

  for (const moved of [...session.moved]) {
    try {
      const pointer = await getBlob<{ provider: StorageProviderId; externalKey: string }>('meta', pointerKey(moved.scope, moved.key), 'indexeddb');
      if (!pointer) continue;
      const externalData = await getBlob<StorageData>(moved.scope, pointer.externalKey, pointer.provider);
      if (externalData == null) {
        throw new Error('External payload missing for rollback');
      }

      await putBlob(moved.scope, moved.key, externalData, 'indexeddb');
      await deleteBlob('meta', pointerKey(moved.scope, moved.key), 'indexeddb');
      await deleteBlob(moved.scope, pointer.externalKey, pointer.provider);

      rolledBack += 1;
      session.moved = session.moved.filter((item) => candidateId(item) !== candidateId(moved));
      session.pending.push(moved);
    } catch {
      failed += 1;
    }
  }

  await saveMigrationSession(session);
  return { rolledBack, failed };
}

export async function verifyMigrationSession(sessionId: string): Promise<MigrationVerificationResult> {
  const session = await loadMigrationSession(sessionId);
  if (!session) {
    throw new Error(`Migration session not found: ${sessionId}`);
  }

  const failed: MigrationVerificationResult['failed'] = [];

  for (const candidate of session.moved) {
    const pointer = await getBlob<{ provider: StorageProviderId; externalKey: string; checksum: string }>(
      'meta',
      pointerKey(candidate.scope, candidate.key),
      'indexeddb',
    );
    if (!pointer) {
      failed.push({ scope: candidate.scope, key: candidate.key, reason: 'Missing pointer metadata' });
      continue;
    }

    const externalData = await getBlob<StorageData>(candidate.scope, pointer.externalKey, pointer.provider);
    if (externalData == null) {
      failed.push({ scope: candidate.scope, key: candidate.key, reason: 'Missing external payload' });
      continue;
    }

    const externalChecksum = await sha256Hex(externalData);
    if (externalChecksum !== pointer.checksum) {
      failed.push({ scope: candidate.scope, key: candidate.key, reason: 'Checksum mismatch' });
      continue;
    }

    const internalStillExists = await stat(candidate.scope, candidate.key, 'indexeddb');
    if (internalStillExists) {
      failed.push({ scope: candidate.scope, key: candidate.key, reason: 'Internal payload still present' });
    }
  }

  const usage = await readStorageUsage();
  return {
    checked: session.moved.length,
    verified: session.moved.length - failed.length,
    failed,
    internalBytesBefore: session.baselineInternalBytes,
    internalBytesAfter: usage.indexeddb,
    internalBytesReduced: Math.max(session.baselineInternalBytes - usage.indexeddb, 0),
  };
}

let rebalanceTimer: number | null = null;
let rebalanceRunning = false;

export async function runRebalancePolicyCycle(): Promise<{ movedItems: number; movedBytes: number }> {
  if (rebalanceRunning) {
    return { movedItems: 0, movedBytes: 0 };
  }

  const policy = getStoragePolicy();
  if (policy.mode === 'internal-only') {
    return { movedItems: 0, movedBytes: 0 };
  }

  const usage = await readStorageUsage();
  const highThreshold = policy.budgetBytes * policy.highWatermark;
  const lowThreshold = policy.budgetBytes * policy.lowWatermark;

  if (policy.target === 'capped-budget' && usage.indexeddb <= highThreshold) {
    return { movedItems: 0, movedBytes: 0 };
  }

  rebalanceRunning = true;
  try {
    const report = await scanMovableData();
    const sorted = report.candidates
      .filter((candidate) => candidate.classification === 'eligible')
      .sort((a, b) => a.updatedAt - b.updatedAt || b.size - a.size);

    if (sorted.length === 0) {
      return { movedItems: 0, movedBytes: 0 };
    }

    const targetBytes = policy.target === 'capped-budget' ? Math.max(usage.indexeddb - lowThreshold, 0) : Number.MAX_SAFE_INTEGER;
    let movedItems = 0;
    let movedBytes = 0;

    for (const candidate of sorted) {
      if (movedBytes >= targetBytes) break;
      try {
        await migrateCandidate(candidate, 'filesystem-access');
        movedItems += 1;
        movedBytes += candidate.size;
      } catch {
        // leave for later retries by periodic policy loop.
      }
    }

    return { movedItems, movedBytes };
  } finally {
    rebalanceRunning = false;
  }
}

export function startRebalancePolicyJob(intervalMs = 60_000): () => void {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  if (rebalanceTimer != null) {
    return () => stopRebalancePolicyJob();
  }

  window.localStorage.setItem(REBALANCE_JOB_KEY, 'true');
  rebalanceTimer = window.setInterval(() => {
    void runRebalancePolicyCycle();
  }, Math.max(intervalMs, 15_000));

  void runRebalancePolicyCycle();

  return () => stopRebalancePolicyJob();
}

export function stopRebalancePolicyJob(): void {
  if (rebalanceTimer != null && typeof window !== 'undefined') {
    window.clearInterval(rebalanceTimer);
  }
  rebalanceTimer = null;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(REBALANCE_JOB_KEY, 'false');
  }
}

export function isRebalancePolicyJobActive(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(REBALANCE_JOB_KEY) === 'true';
}
