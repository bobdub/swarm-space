import { FileSystemAccessProvider } from './fileSystemAccessProvider';
import { IndexedDbProvider } from './indexedDbProvider';
import { OPFSProvider } from './opfsProvider';
import type { StorageData, StorageHealth, StorageProvider, StorageStat } from './types';

export type StorageProviderId = 'indexeddb' | 'filesystem-access' | 'opfs';

const STORAGE_PROVIDER_KEY = 'app.storage.provider';


interface StoragePolicySnapshot {
  mode: 'internal-only' | 'hybrid' | 'external-preferred';
  target: 'full-selected-folder' | 'capped-budget';
  budgetBytes: number;
  highWatermark: number;
  lowWatermark: number;
}

const STORAGE_POLICY_KEY = 'app.storage.policy';
const DEFAULT_POLICY: StoragePolicySnapshot = {
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

function getPolicySnapshot(): StoragePolicySnapshot {
  if (typeof window === 'undefined') return DEFAULT_POLICY;
  const raw = window.localStorage.getItem(STORAGE_POLICY_KEY);
  if (!raw) return DEFAULT_POLICY;
  try {
    const parsed = JSON.parse(raw) as Partial<StoragePolicySnapshot>;
    return {
      mode: parsed.mode === 'internal-only' || parsed.mode === 'hybrid' || parsed.mode === 'external-preferred' ? parsed.mode : DEFAULT_POLICY.mode,
      target: parsed.target === 'full-selected-folder' || parsed.target === 'capped-budget' ? parsed.target : DEFAULT_POLICY.target,
      budgetBytes: typeof parsed.budgetBytes === 'number' && Number.isFinite(parsed.budgetBytes) ? Math.max(parsed.budgetBytes, 32 * 1024 * 1024) : DEFAULT_POLICY.budgetBytes,
      highWatermark: typeof parsed.highWatermark === 'number' ? Math.min(Math.max(parsed.highWatermark, 0.5), 0.99) : DEFAULT_POLICY.highWatermark,
      lowWatermark: typeof parsed.lowWatermark === 'number' ? Math.min(Math.max(parsed.lowWatermark, 0.25), 0.95) : DEFAULT_POLICY.lowWatermark,
    };
  } catch {
    return DEFAULT_POLICY;
  }
}

const indexedDbContentProvider = new IndexedDbProvider({
  dbName: 'imagination-db',
  dbVersion: 22,
  stores: ['chunks', 'manifests', 'replicas', 'meta'],
});
const indexedDbRecordingProvider = new IndexedDbProvider({
  dbName: 'imagination-recordings',
  dbVersion: 1,
  stores: ['recordings'],
});
const fileSystemProvider = new FileSystemAccessProvider();
const opfsProvider = new OPFSProvider();

let activeProviderId: StorageProviderId = 'indexeddb';

function pickProvider(providerId: StorageProviderId, scope: string): StorageProvider {
  if (providerId === 'indexeddb') {
    return scope === 'recordings' ? indexedDbRecordingProvider : indexedDbContentProvider;
  }
  if (providerId === 'filesystem-access') {
    return fileSystemProvider;
  }
  return opfsProvider;
}

function estimateSizeBytes(data: StorageData): number {
  if (data instanceof Blob) return data.size;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (data instanceof Uint8Array) return data.byteLength;
  if (typeof data === 'string') return new TextEncoder().encode(data).byteLength;
  return new TextEncoder().encode(JSON.stringify(data ?? null)).byteLength;
}

async function getProviderHealth(providerId: StorageProviderId, scope: string): Promise<boolean> {
  const provider = pickProvider(providerId, scope);
  const status = await provider.health();
  return status.ok;
}



async function purgeReplicasUntil(targetBytes: number): Promise<void> {
  const replicas = await list('replicas', undefined, 'indexeddb');
  const records = (await Promise.all(replicas.map((entry) => getBlob<ReplicaRecord>('replicas', entry.key, 'indexeddb'))))
    .filter((record): record is ReplicaRecord => Boolean(record))
    .sort((a, b) => a.storedAt - b.storedAt);

  for (const record of records) {
    const manifest = await getBlob<{ chunks?: string[] }>('manifests', record.manifestId, 'indexeddb');
    if (Array.isArray(manifest?.chunks)) {
      for (const chunkRef of manifest.chunks) {
        await deleteBlob('chunks', chunkRef, 'indexeddb');
      }
    }
    await deleteBlob('manifests', record.manifestId, 'indexeddb');
    await deleteBlob('replicas', record.manifestId, 'indexeddb');

    const usage = await readStorageUsage();
    if (usage.indexeddb <= targetBytes) {
      break;
    }
  }
}

async function chooseWriteProvider(scope: string, data: StorageData): Promise<StorageProviderId> {
  const preferred = getStorageProviderPreference();
  const policy = getPolicySnapshot();

  if (policy.mode === 'internal-only') {
    return 'indexeddb';
  }

  if (policy.mode === 'external-preferred') {
    const externalOk = await getProviderHealth('filesystem-access', scope);
    return externalOk ? 'filesystem-access' : 'indexeddb';
  }

  if (policy.target !== 'capped-budget') {
    return preferred;
  }

  const usage = await readStorageUsage();
  const projected = usage.indexeddb + estimateSizeBytes(data);
  const highMarkBytes = policy.budgetBytes * policy.highWatermark;

  if (projected <= highMarkBytes) {
    return 'indexeddb';
  }

  const externalOk = await getProviderHealth('filesystem-access', scope);
  if (externalOk) {
    return 'filesystem-access';
  }

  const lowMarkBytes = policy.budgetBytes * policy.lowWatermark;
  await purgeReplicasUntil(lowMarkBytes);
  return 'indexeddb';
}

export function getStorageProviderPreference(): StorageProviderId {
  if (typeof window === 'undefined') {
    return activeProviderId;
  }

  const preferred = window.localStorage.getItem(STORAGE_PROVIDER_KEY);
  if (preferred === 'filesystem-access' || preferred === 'opfs' || preferred === 'indexeddb') {
    activeProviderId = preferred;
  }
  return activeProviderId;
}

export function setStorageProviderPreference(providerId: StorageProviderId): void {
  activeProviderId = providerId;
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_PROVIDER_KEY, providerId);
  }
}

export async function setStorageProviderRootHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await fileSystemProvider.setRootHandle(handle);
  setStorageProviderPreference('filesystem-access');
}

async function getActiveStorageProvider(scope: string, explicitProvider?: StorageProviderId, allowFallback = true): Promise<StorageProvider> {
  const providerId = explicitProvider ?? getStorageProviderPreference();
  let provider = pickProvider(providerId, scope);
  const status = await provider.health();
  if (allowFallback && !status.ok && providerId !== 'indexeddb') {
    provider = pickProvider('indexeddb', scope);
  }
  return provider;
}

export async function putBlob(scope: string, key: string, data: StorageData, explicitProvider?: StorageProviderId): Promise<void> {
  const providerId = explicitProvider ?? (await chooseWriteProvider(scope, data));
  const provider = await getActiveStorageProvider(scope, providerId);
  return provider.putBlob(scope, key, data);
}

export async function getBlob<T = unknown>(scope: string, key: string, explicitProvider?: StorageProviderId): Promise<T | null> {
  const provider = await getActiveStorageProvider(scope, explicitProvider);
  return provider.getBlob<T>(scope, key);
}

export async function deleteBlob(scope: string, key: string, explicitProvider?: StorageProviderId): Promise<void> {
  const provider = await getActiveStorageProvider(scope, explicitProvider);
  return provider.deleteBlob(scope, key);
}

export async function stat(scope: string, key: string, explicitProvider?: StorageProviderId): Promise<StorageStat | null> {
  const provider = await getActiveStorageProvider(scope, explicitProvider);
  return provider.stat(scope, key);
}

export async function list(scope: string, prefix?: string, explicitProvider?: StorageProviderId): Promise<StorageStat[]> {
  const provider = await getActiveStorageProvider(scope, explicitProvider);
  return provider.list(scope, prefix);
}

export async function reserve(bytes: number, scope = 'chunks', explicitProvider?: StorageProviderId): Promise<string | null> {
  const provider = await getActiveStorageProvider(scope, explicitProvider);
  return provider.reserve(bytes);
}

export async function release(token: string, scope = 'chunks', explicitProvider?: StorageProviderId): Promise<void> {
  const provider = await getActiveStorageProvider(scope, explicitProvider);
  return provider.release(token);
}

export async function health(scope = 'chunks', explicitProvider?: StorageProviderId): Promise<StorageHealth> {
  const provider = await getActiveStorageProvider(scope, explicitProvider);
  return provider.health();
}

async function sumUsageForProvider(providerId: StorageProviderId, scopes: string[]): Promise<number> {
  let total = 0;
  for (const scope of scopes) {
    try {
      const provider = await getActiveStorageProvider(scope, providerId, false);
      const entries = await provider.list(scope);
      for (const entry of entries) {
        total += entry.size;
      }
    } catch {
      // ignored: provider/scope can be unavailable.
    }
  }
  return total;
}

export async function readStorageUsage(): Promise<{ indexeddb: number; filesystem: number; opfs: number }> {
  const scopes = ['chunks', 'manifests', 'replicas', 'meta', 'recordings'];
  const [indexeddb, filesystem, opfs] = await Promise.all([
    sumUsageForProvider('indexeddb', scopes),
    sumUsageForProvider('filesystem-access', scopes),
    sumUsageForProvider('opfs', scopes),
  ]);

  return { indexeddb, filesystem, opfs };
}
