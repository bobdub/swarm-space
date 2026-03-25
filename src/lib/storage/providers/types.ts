export type StorageData = Blob | ArrayBuffer | Uint8Array | string | number | boolean | Record<string, unknown> | unknown[] | null;

export interface StorageStat {
  key: string;
  size: number;
  updatedAt: number;
}

export interface StorageHealth {
  ok: boolean;
  provider: string;
  details?: string;
}

export interface StorageProvider {
  readonly id: string;
  putBlob(scope: string, key: string, data: StorageData): Promise<void>;
  getBlob<T = unknown>(scope: string, key: string): Promise<T | null>;
  deleteBlob(scope: string, key: string): Promise<void>;
  stat(scope: string, key: string): Promise<StorageStat | null>;
  list(scope: string, prefix?: string): Promise<StorageStat[]>;
  reserve(bytes: number): Promise<string | null>;
  release(token: string): Promise<void>;
  health(): Promise<StorageHealth>;
}
