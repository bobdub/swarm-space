import type { StorageData, StorageHealth, StorageProvider, StorageStat } from './types';

interface IndexedDbProviderOptions {
  dbName: string;
  dbVersion: number;
  stores: string[];
}

interface Envelope {
  value: StorageData;
  updatedAt: number;
}

export class IndexedDbProvider implements StorageProvider {
  readonly id = 'indexeddb';
  private dbPromise: Promise<IDBDatabase> | null = null;
  private readonly reservations = new Set<string>();

  constructor(private readonly options: IndexedDbProviderOptions) {}

  private async open(): Promise<IDBDatabase> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(this.options.dbName, this.options.dbVersion);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const storeName of this.options.stores) {
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName);
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    return this.dbPromise;
  }

  async putBlob(scope: string, key: string, data: StorageData): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(scope, 'readwrite');
      const store = tx.objectStore(scope);
      if (store.keyPath) {
        store.put(data as any);
      } else {
        store.put({ value: data, updatedAt: Date.now() } satisfies Envelope, key);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getBlob<T = unknown>(scope: string, key: string): Promise<T | null> {
    const db = await this.open();
    return new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(scope, 'readonly');
      const req = tx.objectStore(scope).get(key);
      req.onsuccess = () => {
        const value = req.result as Envelope | T | undefined;
        if (!value) {
          resolve(null);
          return;
        }
        if (typeof value === 'object' && value !== null && 'value' in (value as Record<string, unknown>)) {
          resolve((value as Envelope).value as T);
          return;
        }
        resolve(value as T);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async deleteBlob(scope: string, key: string): Promise<void> {
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(scope, 'readwrite');
      tx.objectStore(scope).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async stat(scope: string, key: string): Promise<StorageStat | null> {
    const value = await this.getBlob(scope, key);
    if (value == null) return null;
    return { key, size: JSON.stringify(value).length, updatedAt: Date.now() };
  }

  async list(scope: string, prefix = ''): Promise<StorageStat[]> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(scope, 'readonly');
      const store = tx.objectStore(scope);
      const out: StorageStat[] = [];
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) {
          resolve(out);
          return;
        }
        const key = String(cursor.key);
        if (key.startsWith(prefix)) {
          out.push({ key, size: JSON.stringify(cursor.value ?? null).length, updatedAt: Date.now() });
        }
        cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
  }

  async reserve(bytes: number): Promise<string | null> {
    if (bytes <= 0) return null;
    const token = `indexeddb:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    this.reservations.add(token);
    return token;
  }

  async release(token: string): Promise<void> {
    this.reservations.delete(token);
  }

  async health(): Promise<StorageHealth> {
    try {
      await this.open();
      return { ok: true, provider: this.id };
    } catch (error) {
      return {
        ok: false,
        provider: this.id,
        details: error instanceof Error ? error.message : 'IndexedDB unavailable',
      };
    }
  }
}
