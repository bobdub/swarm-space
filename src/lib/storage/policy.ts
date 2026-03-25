import {
  deleteBlob,
  getBlob,
  list,
  readStorageUsage,
  setStorageProviderRootHandle,
} from './providers';

export type StorageMode = 'internal-only' | 'hybrid' | 'external-preferred';
export type StorageTarget = 'full-selected-folder' | 'capped-budget';

export interface StoragePolicy {
  mode: StorageMode;
  target: StorageTarget;
  budgetBytes: number;
  highWatermark: number;
  lowWatermark: number;
}

const STORAGE_POLICY_KEY = 'app.storage.policy';

const DEFAULT_POLICY: StoragePolicy = {
  mode: 'internal-only',
  target: 'full-selected-folder',
  budgetBytes: 5 * 1024 * 1024 * 1024,
  highWatermark: 0.9,
  lowWatermark: 0.75,
};

interface ReplicaRecord {
  manifestId: string;
  storedAt: number;
}

export function getStoragePolicy(): StoragePolicy {
  if (typeof window === 'undefined') {
    return DEFAULT_POLICY;
  }

  const raw = window.localStorage.getItem(STORAGE_POLICY_KEY);
  if (!raw) return DEFAULT_POLICY;

  try {
    const parsed = JSON.parse(raw) as Partial<StoragePolicy>;
    return {
      mode: parsed.mode === 'internal-only' || parsed.mode === 'hybrid' || parsed.mode === 'external-preferred'
        ? parsed.mode
        : DEFAULT_POLICY.mode,
      target: parsed.target === 'full-selected-folder' || parsed.target === 'capped-budget'
        ? parsed.target
        : DEFAULT_POLICY.target,
      budgetBytes: typeof parsed.budgetBytes === 'number' && Number.isFinite(parsed.budgetBytes)
        ? Math.max(parsed.budgetBytes, 32 * 1024 * 1024)
        : DEFAULT_POLICY.budgetBytes,
      highWatermark: typeof parsed.highWatermark === 'number'
        ? Math.min(Math.max(parsed.highWatermark, 0.5), 0.99)
        : DEFAULT_POLICY.highWatermark,
      lowWatermark: typeof parsed.lowWatermark === 'number'
        ? Math.min(Math.max(parsed.lowWatermark, 0.25), 0.95)
        : DEFAULT_POLICY.lowWatermark,
    };
  } catch {
    return DEFAULT_POLICY;
  }
}

export function setStoragePolicy(policy: StoragePolicy): StoragePolicy {
  const normalized = {
    ...policy,
    budgetBytes: Math.max(policy.budgetBytes, 32 * 1024 * 1024),
    highWatermark: Math.min(Math.max(policy.highWatermark, 0.5), 0.99),
    lowWatermark: Math.min(Math.max(policy.lowWatermark, 0.25), 0.95),
  };

  if (normalized.lowWatermark >= normalized.highWatermark) {
    normalized.lowWatermark = Math.max(0.25, normalized.highWatermark - 0.05);
  }

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_POLICY_KEY, JSON.stringify(normalized));
  }

  return normalized;
}

export async function chooseExternalStorageFolder(): Promise<void> {
  if (typeof window === 'undefined' || typeof window.showDirectoryPicker !== 'function') {
    throw new Error('File System Access API unavailable in this browser.');
  }

  const handle = await window.showDirectoryPicker();
  await setStorageProviderRootHandle(handle);
}

export async function getUsageByBackend(): Promise<{ internalBytes: number; externalBytes: number }> {
  const usage = await readStorageUsage();
  return {
    internalBytes: usage.indexeddb,
    externalBytes: usage.filesystem,
  };
}

export async function rebalanceNow(): Promise<number> {
  const policy = getStoragePolicy();
  if (policy.target !== 'capped-budget') return 0;

  const usage = await readStorageUsage();
  const high = policy.budgetBytes * policy.highWatermark;
  if (usage.indexeddb <= high) return 0;

  const low = policy.budgetBytes * policy.lowWatermark;
  return purgeReplicasUntil(low);
}

export async function purgeReplicasUntil(targetBytes = 0): Promise<number> {
  let purged = 0;
  const replicas = await list('replicas', undefined, 'indexeddb');
  const records = (await Promise.all(
    replicas.map((entry) => getBlob<ReplicaRecord>('replicas', entry.key, 'indexeddb')),
  )).filter((record): record is ReplicaRecord => Boolean(record));

  records.sort((a, b) => a.storedAt - b.storedAt);

  for (const record of records) {
    const manifest = await getBlob<{ chunks?: string[] }>('manifests', record.manifestId, 'indexeddb');
    if (Array.isArray(manifest?.chunks)) {
      for (const chunkRef of manifest.chunks) {
        await deleteBlob('chunks', chunkRef, 'indexeddb');
      }
    }

    await deleteBlob('manifests', record.manifestId, 'indexeddb');
    await deleteBlob('replicas', record.manifestId, 'indexeddb');
    purged += 1;

    if (targetBytes > 0) {
      const usage = await readStorageUsage();
      if (usage.indexeddb <= targetBytes) break;
    }
  }

  return purged;
}

export async function moveOldMediaToExternal(): Promise<number> {
  return rebalanceNow();
}
