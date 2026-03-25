import type { StorageData, StorageHealth, StorageProvider, StorageStat } from './types';

function toBlob(data: StorageData): Blob {
  if (data instanceof Blob) return data;
  if (data instanceof ArrayBuffer) return new Blob([data]);
  if (data instanceof Uint8Array) return new Blob([data]);
  if (typeof data === 'string') return new Blob([data], { type: 'text/plain' });
  return new Blob([JSON.stringify(data ?? null)], { type: 'application/json' });
}

export class OPFSProvider implements StorageProvider {
  readonly id = 'opfs';
  private rootPromise: Promise<FileSystemDirectoryHandle> | null = null;
  private reservations = new Set<string>();

  private async getRoot(): Promise<FileSystemDirectoryHandle> {
    if (!this.rootPromise) {
      this.rootPromise = navigator.storage.getDirectory();
    }
    return this.rootPromise;
  }

  private async getScopeDir(scope: string): Promise<FileSystemDirectoryHandle> {
    const root = await this.getRoot();
    return root.getDirectoryHandle(scope, { create: true });
  }

  async putBlob(scope: string, key: string, data: StorageData): Promise<void> {
    const dir = await this.getScopeDir(scope);
    const file = await dir.getFileHandle(`${key}.blob`, { create: true });
    const writable = await file.createWritable();
    await writable.write(toBlob(data));
    await writable.close();
  }

  async getBlob<T = unknown>(scope: string, key: string): Promise<T | null> {
    const dir = await this.getScopeDir(scope);
    try {
      const fileHandle = await dir.getFileHandle(`${key}.blob`);
      const file = await fileHandle.getFile();
      const text = await file.text();
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as T;
      }
    } catch {
      return null;
    }
  }

  async deleteBlob(scope: string, key: string): Promise<void> {
    const dir = await this.getScopeDir(scope);
    try {
      await dir.removeEntry(`${key}.blob`);
    } catch {
      // noop
    }
  }

  async stat(scope: string, key: string): Promise<StorageStat | null> {
    const dir = await this.getScopeDir(scope);
    try {
      const fileHandle = await dir.getFileHandle(`${key}.blob`);
      const file = await fileHandle.getFile();
      return { key, size: file.size, updatedAt: file.lastModified };
    } catch {
      return null;
    }
  }

  async list(scope: string, prefix = ''): Promise<StorageStat[]> {
    const dir = await this.getScopeDir(scope);
    const out: StorageStat[] = [];
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== 'file' || !name.endsWith('.blob')) continue;
      const key = name.slice(0, -5);
      if (!key.startsWith(prefix)) continue;
      const file = await (handle as FileSystemFileHandle).getFile();
      out.push({ key, size: file.size, updatedAt: file.lastModified });
    }
    return out;
  }

  async reserve(bytes: number): Promise<string | null> {
    if (bytes <= 0) return null;
    const token = `opfs:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    this.reservations.add(token);
    return token;
  }

  async release(token: string): Promise<void> {
    this.reservations.delete(token);
  }

  async health(): Promise<StorageHealth> {
    const available = typeof navigator !== 'undefined' && 'storage' in navigator && typeof navigator.storage.getDirectory === 'function';
    return {
      ok: available,
      provider: this.id,
      details: available ? undefined : 'OPFS unavailable in this browser',
    };
  }
}
