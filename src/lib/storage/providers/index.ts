import { FileSystemAccessProvider } from './fileSystemAccessProvider';
import { IndexedDbProvider } from './indexedDbProvider';
import { OPFSProvider } from './opfsProvider';
import type { StorageData, StorageHealth, StorageProvider, StorageStat } from './types';

export type StorageProviderId = 'indexeddb' | 'filesystem-access' | 'opfs';

const STORAGE_PROVIDER_KEY = 'app.storage.provider';

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

async function getActiveStorageProvider(scope: string): Promise<StorageProvider> {
  const providerId = getStorageProviderPreference();
  let provider = pickProvider(providerId, scope);
  const status = await provider.health();
  if (!status.ok && providerId !== 'indexeddb') {
    provider = pickProvider('indexeddb', scope);
  }
  return provider;
}

export async function putBlob(scope: string, key: string, data: StorageData): Promise<void> {
  const provider = await getActiveStorageProvider(scope);
  return provider.putBlob(scope, key, data);
}

export async function getBlob<T = unknown>(scope: string, key: string): Promise<T | null> {
  const provider = await getActiveStorageProvider(scope);
  return provider.getBlob<T>(scope, key);
}

export async function deleteBlob(scope: string, key: string): Promise<void> {
  const provider = await getActiveStorageProvider(scope);
  return provider.deleteBlob(scope, key);
}

export async function stat(scope: string, key: string): Promise<StorageStat | null> {
  const provider = await getActiveStorageProvider(scope);
  return provider.stat(scope, key);
}

export async function list(scope: string, prefix?: string): Promise<StorageStat[]> {
  const provider = await getActiveStorageProvider(scope);
  return provider.list(scope, prefix);
}

export async function reserve(bytes: number, scope = 'chunks'): Promise<string | null> {
  const provider = await getActiveStorageProvider(scope);
  return provider.reserve(bytes);
}

export async function release(token: string, scope = 'chunks'): Promise<void> {
  const provider = await getActiveStorageProvider(scope);
  return provider.release(token);
}

export async function health(scope = 'chunks'): Promise<StorageHealth> {
  const provider = await getActiveStorageProvider(scope);
  return provider.health();
}
