/**
 * External Device Storage Provider
 * Uses File System Access API to store manifests/chunks on a user-selected directory.
 */

import type { StorageProvider, StorageCapacity, StorageHealthResult } from './types';

type FSHandle = FileSystemDirectoryHandle;

const HANDLE_DB_KEY = 'external-storage-handle';

export class ExternalDeviceProvider implements StorageProvider {
  readonly id = 'external-device';
  readonly name = 'External Device';
  private rootHandle: FSHandle | null = null;

  // ── Lifecycle ─────────────────────────────────────────

  /**
   * Prompt user to select a directory.
   */
  async connect(): Promise<boolean> {
    if (typeof (window as any).showDirectoryPicker !== 'function') {
      console.warn('[ExternalDevice] File System Access API not available');
      return false;
    }

    try {
      this.rootHandle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
      await this.persistHandle();
      // Ensure sub-dirs exist
      await this.ensureSubDirs();
      return true;
    } catch (error) {
      console.warn('[ExternalDevice] User cancelled or error:', error);
      return false;
    }
  }

  /**
   * Drop the stored handle reference.
   */
  disconnect(): void {
    this.rootHandle = null;
    try {
      localStorage.removeItem(HANDLE_DB_KEY);
    } catch { /* noop */ }
  }

  /**
   * Try to restore a previously-granted handle from IndexedDB.
   */
  async tryRestore(): Promise<boolean> {
    try {
      const db = await this.openHandleDb();
      const tx = db.transaction('handles', 'readonly');
      const req = tx.objectStore('handles').get(HANDLE_DB_KEY);
      const handle = await new Promise<FSHandle | undefined>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result?.handle);
        req.onerror = () => reject(req.error);
      });
      db.close();

      if (!handle) return false;

      const perm = await (handle as any).queryPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        this.rootHandle = handle;
        return true;
      }

      // Try requesting permission (requires user gesture)
      const requested = await (handle as any).requestPermission({ mode: 'readwrite' });
      if (requested === 'granted') {
        this.rootHandle = handle;
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  // ── StorageProvider CRUD ──────────────────────────────

  async get<T>(store: string, key: string): Promise<T | null> {
    if (!this.rootHandle) return null;
    try {
      const dir = await this.getStoreDir(store);
      const file = await dir.getFileHandle(`${key}.json`);
      const blob = await file.getFile();
      const text = await blob.text();
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  async put<T>(store: string, key: string, data: T): Promise<void> {
    if (!this.rootHandle) throw new Error('External device not connected');
    const dir = await this.getStoreDir(store);
    // Atomic write: .tmp → rename
    const tmpName = `${key}.tmp`;
    const finalName = `${key}.json`;
    const tmpFile = await dir.getFileHandle(tmpName, { create: true });
    const writable = await (tmpFile as any).createWritable();
    await writable.write(JSON.stringify(data));
    await writable.close();
    // "Rename" by copying then deleting tmp
    // File System Access API doesn't have rename — read tmp, write final, delete tmp
    const tmpBlob = await (await dir.getFileHandle(tmpName)).getFile();
    const finalFile = await dir.getFileHandle(finalName, { create: true });
    const finalWritable = await (finalFile as any).createWritable();
    await finalWritable.write(await tmpBlob.arrayBuffer());
    await finalWritable.close();
    try {
      await dir.removeEntry(tmpName);
    } catch { /* best effort */ }
  }

  async remove(store: string, key: string): Promise<void> {
    if (!this.rootHandle) return;
    try {
      const dir = await this.getStoreDir(store);
      await dir.removeEntry(`${key}.json`);
    } catch { /* file may not exist */ }
  }

  async getAll<T>(store: string): Promise<T[]> {
    if (!this.rootHandle) return [];
    try {
      const dir = await this.getStoreDir(store);
      const results: T[] = [];
      for await (const [name, handle] of (dir as any).entries()) {
        if (name.endsWith('.json') && handle.kind === 'file') {
          try {
            const blob = await handle.getFile();
            const text = await blob.text();
            results.push(JSON.parse(text) as T);
          } catch { /* skip corrupt entries */ }
        }
      }
      return results;
    } catch {
      return [];
    }
  }

  // ── Capacity ──────────────────────────────────────────

  async getCapacity(): Promise<StorageCapacity> {
    // File System Access API doesn't expose disk capacity directly.
    // We can only estimate from navigator.storage if it reflects the device.
    // For now, return unknowns.
    return { used: 0, total: 0, free: 0 };
  }

  // ── Health ────────────────────────────────────────────

  async isAvailable(): Promise<boolean> {
    if (!this.rootHandle) return false;
    try {
      const perm = await (this.rootHandle as any).queryPermission({ mode: 'readwrite' });
      return perm === 'granted';
    } catch {
      return false;
    }
  }

  async getHealthStatus(): Promise<StorageHealthResult> {
    const available = await this.isAvailable();
    const issues: string[] = [];

    if (!this.rootHandle) {
      issues.push('No external directory connected.');
    } else if (!available) {
      issues.push('Permission to external directory was revoked. Please reconnect.');
    }

    return { available, issues, lastCheckedAt: Date.now() };
  }

  // ── Private helpers ───────────────────────────────────

  private async getStoreDir(store: string): Promise<FileSystemDirectoryHandle> {
    if (!this.rootHandle) throw new Error('No root handle');
    return this.rootHandle.getDirectoryHandle(store, { create: true });
  }

  private async ensureSubDirs(): Promise<void> {
    if (!this.rootHandle) return;
    for (const dir of ['manifests', 'chunks', 'replicas']) {
      await this.rootHandle.getDirectoryHandle(dir, { create: true });
    }
  }

  private async persistHandle(): Promise<void> {
    if (!this.rootHandle) return;
    try {
      const db = await this.openHandleDb();
      const tx = db.transaction('handles', 'readwrite');
      tx.objectStore('handles').put({ id: HANDLE_DB_KEY, handle: this.rootHandle });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch (error) {
      console.warn('[ExternalDevice] Failed to persist handle:', error);
    }
  }

  private openHandleDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('external-storage-handles', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('handles', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
}
