/**
 * Personal Server Tier Provider
 *
 * Bridges the linked personal server into the tiered storage registry so
 * bulk data (media pieces, file records) lands on the user's own server
 * instead of filling the browser.
 *
 * Behaviour:
 *  - put: writes to the server; any failure falls back to the browser.
 *  - get: browser first (fast path), then the server (hash-verified).
 *  - getAll: browser only — servers are keyed blob stores.
 *  - remove: browser + best-effort server delete.
 */

import { getCurrentUser } from '@/lib/auth';
import { browserProvider, registerProvider, setTierOverride, clearTierOverride, unregisterProvider } from './index';
import type { StorageProvider, StorageCapacity, StorageHealthResult } from './types';
import {
  listPersonalServers,
  subscribePersonalServers,
  type PersonalServer,
} from './personalServerStore';
import { personalServerPut, personalServerDelete } from './personalServerProvider';
import { fetchChunkFromPersonalServers } from './personalServerSync';

const PROVIDER_ID = 'personal-server';
const encoder = new TextEncoder();

function usableServers(): PersonalServer[] {
  return listPersonalServers().filter(
    (s) => !s.paused && s.usedBytes < s.capBytes && (s.health?.ok ?? true),
  );
}

export class PersonalServerTierProvider implements StorageProvider {
  readonly id = PROVIDER_ID;
  readonly name = 'Personal Server';

  async get<T>(store: string, key: string): Promise<T | null> {
    const local = await browserProvider.get<T>(store, key);
    if (local) return local;
    if (store !== 'chunks') return null;
    try {
      const chunk = await fetchChunkFromPersonalServers(key);
      return (chunk as unknown as T) ?? null;
    } catch {
      return null;
    }
  }

  async put<T>(store: string, key: string, data: T): Promise<void> {
    const userId = getCurrentUser()?.id;
    const servers = usableServers();

    // Manifests are tiny and needed offline — always keep them local.
    if (store !== 'chunks' || !userId || servers.length === 0) {
      await browserProvider.put(store, key, data);
      return;
    }

    let body: ArrayBuffer;
    try {
      const encoded = encoder.encode(JSON.stringify(data));
      const buf = new Uint8Array(encoded.byteLength);
      buf.set(encoded);
      body = buf.buffer;
    } catch {
      await browserProvider.put(store, key, data);
      return;
    }

    for (const server of servers) {
      try {
        await personalServerPut(server.id, userId, key, body);
        return; // stored remotely — no browser copy needed
      } catch {
        /* try the next server */
      }
    }
    await browserProvider.put(store, key, data);
  }

  async remove(store: string, key: string): Promise<void> {
    await browserProvider.remove(store, key);
    const userId = getCurrentUser()?.id;
    if (!userId || store !== 'chunks') return;
    for (const server of usableServers()) {
      try { await personalServerDelete(server.id, userId, key); } catch { /* best effort */ }
    }
  }

  async getAll<T>(store: string): Promise<T[]> {
    return browserProvider.getAll<T>(store);
  }

  async getCapacity(): Promise<StorageCapacity> {
    const servers = usableServers();
    if (servers.length === 0) return browserProvider.getCapacity();
    const total = servers.reduce((sum, s) => sum + s.capBytes, 0);
    const used = servers.reduce((sum, s) => sum + s.usedBytes, 0);
    return { used, total, free: Math.max(0, total - used) };
  }

  async isAvailable(): Promise<boolean> {
    return usableServers().length > 0;
  }

  async getHealthStatus(): Promise<StorageHealthResult> {
    const servers = usableServers();
    const issues: string[] = [];
    if (servers.length === 0) issues.push('No healthy personal server linked.');
    for (const s of servers) {
      if (s.capBytes > 0 && (s.capBytes - s.usedBytes) / s.capBytes < 0.1) {
        issues.push(`${s.name} is nearly full.`);
      }
    }
    return { available: servers.length > 0, issues, lastCheckedAt: Date.now() };
  }
}

let instance: PersonalServerTierProvider | null = null;
let active = false;

/** Describe where new bulk data currently lands. */
export function activeBulkTarget(): { id: string; label: string; used: number; total: number } {
  const servers = usableServers();
  if (active && servers.length > 0) {
    const used = servers.reduce((s, x) => s + x.usedBytes, 0);
    const total = servers.reduce((s, x) => s + x.capBytes, 0);
    return { id: PROVIDER_ID, label: servers.map((s) => s.name).join(', '), used, total };
  }
  return { id: 'browser', label: 'This browser', used: 0, total: 0 };
}

function sync(): void {
  const has = usableServers().length > 0;
  if (has && !active) {
    instance ??= new PersonalServerTierProvider();
    registerProvider(instance);
    setTierOverride('bulk', PROVIDER_ID);
    setTierOverride('replica', PROVIDER_ID);
    active = true;
  } else if (!has && active) {
    clearTierOverride('bulk');
    clearTierOverride('replica');
    unregisterProvider(PROVIDER_ID);
    active = false;
  }
}

/** Boot hook: route bulk data to a linked personal server when one exists. */
export function startPersonalServerTier(): () => void {
  sync();
  return subscribePersonalServers(() => sync());
}
