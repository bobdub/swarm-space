import { getStoragePolicy } from './policy';
import {
  deleteBlob,
  getBlob,
  getStorageProviderPreference,
  putBlob,
  type StorageProviderId,
} from './providers';
import type { StorageData } from './providers/types';

interface PlacementPointer {
  version: 1;
  scope: string;
  key: string;
  provider: Exclude<StorageProviderId, 'indexeddb'>;
  externalKey: string;
  checksum: string;
  size: number;
  storedAt: number;
}

interface PlacementOptions {
  sensitive?: boolean;
  estimatedSizeBytes?: number;
}

const POINTER_PREFIX = 'placement:';
const LARGE_BLOB_THRESHOLD_BYTES = 512 * 1024;

function getPointerKey(scope: string, key: string): string {
  return `${POINTER_PREFIX}${scope}:${key}`;
}

function isSecurityCriticalScope(scope: string): boolean {
  return /(identity|session|security|auth|credential|key)/i.test(scope);
}

function estimateSizeBytes(data: StorageData, estimate?: number): number {
  if (typeof estimate === 'number' && Number.isFinite(estimate) && estimate >= 0) {
    return estimate;
  }
  if (data instanceof Blob) return data.size;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (data instanceof Uint8Array) return data.byteLength;
  if (typeof data === 'string') return new TextEncoder().encode(data).byteLength;
  return new TextEncoder().encode(JSON.stringify(data ?? null)).byteLength;
}

async function toBytes(data: StorageData): Promise<Uint8Array> {
  if (data instanceof Blob) {
    return new Uint8Array(await data.arrayBuffer());
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (data instanceof Uint8Array) {
    return data;
  }
  if (typeof data === 'string') {
    return new TextEncoder().encode(data);
  }
  return new TextEncoder().encode(JSON.stringify(data ?? null));
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(data: StorageData): Promise<string> {
  const bytes = await toBytes(data);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(digest);
}

async function shouldRouteExternal(scope: string, data: StorageData, options?: PlacementOptions): Promise<boolean> {
  if (options?.sensitive || isSecurityCriticalScope(scope)) {
    return false;
  }

  const policy = getStoragePolicy();
  if (policy.mode === 'internal-only') {
    return false;
  }

  if (scope !== 'chunks' && scope !== 'recordings') {
    return false;
  }

  const size = estimateSizeBytes(data, options?.estimatedSizeBytes);
  if (size < LARGE_BLOB_THRESHOLD_BYTES) {
    return false;
  }

  const preferred = getStorageProviderPreference();
  return preferred === 'filesystem-access' || preferred === 'opfs';
}

function resolveExternalProvider(): Exclude<StorageProviderId, 'indexeddb'> {
  const preferred = getStorageProviderPreference();
  if (preferred === 'filesystem-access' || preferred === 'opfs') {
    return preferred;
  }
  return 'filesystem-access';
}

export async function storeByPlacementPolicy(
  scope: string,
  key: string,
  data: StorageData,
  options?: PlacementOptions,
): Promise<'internal' | 'external'> {
  const routeExternal = await shouldRouteExternal(scope, data, options);
  const pointerKey = getPointerKey(scope, key);

  if (!routeExternal) {
    await putBlob(scope, key, data, 'indexeddb');
    await deleteBlob('meta', pointerKey, 'indexeddb');
    return 'internal';
  }

  const provider = resolveExternalProvider();
  const checksum = await sha256Hex(data);
  const size = estimateSizeBytes(data, options?.estimatedSizeBytes);

  try {
    await putBlob(scope, key, data, provider);

    const pointer: PlacementPointer = {
      version: 1,
      scope,
      key,
      provider,
      externalKey: key,
      checksum,
      size,
      storedAt: Date.now(),
    };

    await putBlob('meta', pointerKey, pointer, 'indexeddb');
    return 'external';
  } catch (error) {
    console.warn('[PlacementPolicy] External write failed; falling back to IndexedDB', error);
    await putBlob(scope, key, data, 'indexeddb');
    await deleteBlob('meta', pointerKey, 'indexeddb');
    return 'internal';
  }
}

export async function readByPlacementPolicy<T = unknown>(
  scope: string,
  key: string,
  options?: { sensitive?: boolean },
): Promise<T | null> {
  if (options?.sensitive || isSecurityCriticalScope(scope)) {
    return getBlob<T>(scope, key, 'indexeddb');
  }

  const pointerKey = getPointerKey(scope, key);
  const pointer = await getBlob<PlacementPointer>('meta', pointerKey, 'indexeddb');

  if (!pointer) {
    return getBlob<T>(scope, key, 'indexeddb');
  }

  const external = await getBlob<T>(scope, pointer.externalKey, pointer.provider);
  if (!external) {
    return getBlob<T>(scope, key, 'indexeddb');
  }

  const checksum = await sha256Hex(external as StorageData);
  if (checksum !== pointer.checksum) {
    throw new Error(`External blob integrity check failed for ${scope}:${key}`);
  }

  return external;
}

export async function deleteByPlacementPolicy(scope: string, key: string): Promise<void> {
  const pointerKey = getPointerKey(scope, key);
  const pointer = await getBlob<PlacementPointer>('meta', pointerKey, 'indexeddb');

  if (pointer) {
    await deleteBlob(scope, pointer.externalKey, pointer.provider);
    await deleteBlob('meta', pointerKey, 'indexeddb');
  }

  await deleteBlob(scope, key, 'indexeddb');
}
