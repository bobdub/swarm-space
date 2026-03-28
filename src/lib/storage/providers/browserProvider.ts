/**
 * Browser Storage Provider
 * Default provider wrapping existing IndexedDB store.ts
 */

import { get, put, remove, getAll } from '../../store';
import type { StorageProvider, StorageCapacity, StorageHealthResult } from './types';

export class BrowserStorageProvider implements StorageProvider {
  readonly id = 'browser';
  readonly name = 'Browser (IndexedDB)';

  async get<T>(store: string, key: string): Promise<T | null> {
    const result = await get<T>(store, key);
    return result ?? null;
  }

  async put<T>(store: string, key: string, data: T): Promise<void> {
    await put(store, data);
  }

  async remove(store: string, key: string): Promise<void> {
    await remove(store, key);
  }

  async getAll<T>(store: string): Promise<T[]> {
    return getAll<T>(store);
  }

  async getCapacity(): Promise<StorageCapacity> {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) {
      return { used: 0, total: 0, free: 0 };
    }

    try {
      const { quota = 0, usage = 0 } = await navigator.storage.estimate();
      return { used: usage, total: quota, free: quota - usage };
    } catch {
      return { used: 0, total: 0, free: 0 };
    }
  }

  async isAvailable(): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    try {
      return typeof window.indexedDB !== 'undefined';
    } catch {
      return false;
    }
  }

  async getHealthStatus(): Promise<StorageHealthResult> {
    const available = await this.isAvailable();
    const issues: string[] = [];

    if (!available) {
      issues.push('IndexedDB is not available in this environment.');
    }

    const capacity = await this.getCapacity();
    if (capacity.total > 0 && capacity.free / capacity.total < 0.1) {
      issues.push('Browser storage is nearly full (< 10% free).');
    }

    return { available, issues, lastCheckedAt: Date.now() };
  }
}
