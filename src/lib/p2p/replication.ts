import { get, getAll, put, remove, type Manifest, type Chunk } from '../store';
import { recordP2PDiagnostic } from './diagnostics';
import type { ChunkProtocol } from './chunkProtocol';
import type { PeerDiscovery } from './discovery';

export interface ReplicaRecord {
  manifestId: string;
  storedAt: number;
  redundancyTarget: number;
  sourcePeers: string[];
  size?: number;
  totalChunks?: number;
  lastVerifiedAt?: number;
}

export interface ReplicaAdvertisement {
  count: number;
  manifests: string[];
  target?: number;
}

export type ReplicationReason = 'shortfall' | 'rebalance' | 'manual';

interface ReplicationDependencies {
  chunkProtocol: ChunkProtocol;
  discovery: PeerDiscovery;
  ensureManifest: (manifestId: string, sourcePeerId?: string) => Promise<Manifest | null>;
  getPeersWithContent: (manifestId: string) => string[];
  hasLocalContent: (manifestId: string) => boolean;
  getLocalPeerId: () => string | null;
}

interface ReplicationConfig {
  defaultRedundancy: number;
  minFreeBytes: number;
  maxConcurrentReplications: number;
}

const DEFAULT_CONFIG: ReplicationConfig = {
  defaultRedundancy: 3,
  minFreeBytes: 25 * 1024 * 1024,
  maxConcurrentReplications: 2,
};

export class ReplicationOrchestrator {
  private readonly config: ReplicationConfig;
  private readonly deps: ReplicationDependencies;
  private activeReplications: Set<string> = new Set();
  private replicaRecords: Map<string, ReplicaRecord> = new Map();

  constructor(deps: ReplicationDependencies, config: Partial<ReplicationConfig> = {}) {
    this.deps = deps;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async initialize(): Promise<void> {
    try {
      const existing = await getAll<ReplicaRecord>('replicas');
      for (const record of existing) {
        this.replicaRecords.set(record.manifestId, record);
      }
      if (existing.length > 0) {
        this.deps.discovery.applyReplicaRecords(existing);
      }
    } catch (error) {
      console.warn('[Replication] Failed to load replica metadata', error);
    }
  }

  getRecords(): ReplicaRecord[] {
    return Array.from(this.replicaRecords.values());
  }

  getRecord(manifestId: string): ReplicaRecord | undefined {
    return this.replicaRecords.get(manifestId);
  }

  async ensureRedundancy(
    manifestId: string,
    target: number = this.config.defaultRedundancy,
    reason: ReplicationReason = 'shortfall'
  ): Promise<void> {
    if (this.activeReplications.has(manifestId)) {
      return;
    }

    const currentProviders = new Set(this.deps.getPeersWithContent(manifestId));
    const localPeerId = this.deps.getLocalPeerId();
    const hasPrimaryContent = this.deps.hasLocalContent(manifestId);

    if (hasPrimaryContent) {
      const existingReplica = this.replicaRecords.get(manifestId);
      if (existingReplica) {
        this.replicaRecords.delete(manifestId);
        await remove('replicas', manifestId);
        this.deps.discovery.removeLocalReplica(manifestId);
      }
    }

    if (hasPrimaryContent || this.replicaRecords.has(manifestId)) {
      if (localPeerId) {
        currentProviders.add(localPeerId);
      }
    }

    if (currentProviders.size >= target) {
      const existing = this.replicaRecords.get(manifestId);
      if (existing && existing.redundancyTarget !== target) {
        existing.redundancyTarget = target;
        await put('replicas', existing);
      }
      return;
    }

    if (this.activeReplications.size >= this.config.maxConcurrentReplications) {
      return;
    }

    if (!(await this.ensureStorageBudget())) {
      recordP2PDiagnostic({
        level: 'warn',
        source: 'replication',
        code: 'storage-low',
        message: 'Replication skipped due to low free storage',
        context: { manifestId }
      });
      return;
    }

    this.activeReplications.add(manifestId);

    try {
      const manifest = await this.deps.ensureManifest(manifestId);
      if (!manifest) {
        recordP2PDiagnostic({
          level: 'warn',
          source: 'replication',
          code: 'manifest-missing',
          message: 'Unable to fetch manifest for replication',
          context: { manifestId }
        });
        return;
      }

      const remoteProviders = Array.from(currentProviders).filter((provider) => provider !== localPeerId && provider !== '');

      if (Array.isArray(manifest.chunks) && manifest.chunks.length > 0 && remoteProviders.length > 0) {
        for (const chunkRef of manifest.chunks) {
          const existingChunk = await get<Chunk>('chunks', chunkRef);
          if (existingChunk) {
            continue;
          }

          for (const provider of remoteProviders) {
            try {
              const chunkData = await this.deps.chunkProtocol.requestChunk(provider, chunkRef);
              if (chunkData) {
                break;
              }
            } catch (error) {
              console.warn('[Replication] Failed to fetch chunk during replication', chunkRef, error);
            }
          }
        }
      }

      if (Array.isArray(manifest.chunks) && manifest.chunks.length > 0) {
        const missingChunks: string[] = [];
        for (const chunkRef of manifest.chunks) {
          const chunk = await get<Chunk>('chunks', chunkRef);
          if (!chunk) {
            missingChunks.push(chunkRef);
          }
        }

        if (missingChunks.length > 0) {
          recordP2PDiagnostic({
            level: 'warn',
            source: 'replication',
            code: 'replica-incomplete',
            message: 'Replica download incomplete; skipping registration',
            context: {
              manifestId,
              missingChunks: missingChunks.length
            }
          });
          return;
        }
      }

      if (hasPrimaryContent) {
        return;
      }

      const record: ReplicaRecord = {
        manifestId,
        storedAt: Date.now(),
        redundancyTarget: target,
        sourcePeers: Array.from(currentProviders),
        size: typeof manifest.size === 'number' ? manifest.size : undefined,
        totalChunks: Array.isArray(manifest.chunks) ? manifest.chunks.length : undefined,
        lastVerifiedAt: Date.now()
      };

      await put('replicas', record);
      this.replicaRecords.set(manifestId, record);
      this.deps.discovery.addLocalReplica(record);

      recordP2PDiagnostic({
        level: 'info',
        source: 'replication',
        code: 'replica-created',
        message: 'Replica stored locally',
        context: {
          manifestId,
          target,
          reason,
          chunks: record.totalChunks,
          size: record.size
        }
      });
    } catch (error) {
      recordP2PDiagnostic({
        level: 'error',
        source: 'replication',
        code: 'replica-failed',
        message: error instanceof Error ? error.message : 'Unknown replication failure',
        context: { manifestId }
      });
      console.error('[Replication] Failed to replicate manifest', manifestId, error);
    } finally {
      this.activeReplications.delete(manifestId);
    }
  }

  async ensureStorageBudget(): Promise<boolean> {
    const estimate = await this.estimateStorage();
    if (!estimate) {
      return true;
    }

    const remaining = estimate.quota - estimate.usage;
    if (remaining >= this.config.minFreeBytes) {
      return true;
    }

    const released = await this.releaseOldestReplica();
    return released ?? false;
  }

  async releaseReplica(manifestId: string): Promise<boolean> {
    const record = this.replicaRecords.get(manifestId);
    if (!record) {
      return false;
    }

    if (this.deps.hasLocalContent(manifestId)) {
      await remove('replicas', manifestId);
      this.replicaRecords.delete(manifestId);
      this.deps.discovery.removeLocalReplica(manifestId);

      recordP2PDiagnostic({
        level: 'warn',
        source: 'replication',
        code: 'replica-release-skipped',
        message: 'Skipping replica release for primary content',
        context: { manifestId }
      });
      return false;
    }

    await this.deleteReplicaData(manifestId);
    await remove('replicas', manifestId);
    this.replicaRecords.delete(manifestId);
    this.deps.discovery.removeLocalReplica(manifestId);

    recordP2PDiagnostic({
      level: 'info',
      source: 'replication',
      code: 'replica-released',
      message: 'Replica removed to reclaim storage',
      context: { manifestId }
    });
    return true;
  }

  async releaseOldestReplica(): Promise<boolean | undefined> {
    if (this.replicaRecords.size === 0) {
      return undefined;
    }

    const oldest = Array.from(this.replicaRecords.values())
      .sort((a, b) => a.storedAt - b.storedAt)[0];

    if (!oldest) {
      return undefined;
    }

    return this.releaseReplica(oldest.manifestId);
  }

  private async deleteReplicaData(manifestId: string): Promise<void> {
    const manifest = await get<Manifest>('manifests', manifestId);
    if (manifest && Array.isArray(manifest.chunks)) {
      for (const chunkRef of manifest.chunks) {
        try {
          await remove('chunks', chunkRef);
        } catch (error) {
          console.warn('[Replication] Failed to remove chunk', chunkRef, error);
        }
      }
    }

    try {
      await remove('manifests', manifestId);
    } catch (error) {
      console.warn('[Replication] Failed to remove manifest', manifestId, error);
    }
  }

  private async estimateStorage(): Promise<{ quota: number; usage: number } | null> {
    if (typeof navigator === 'undefined' || !navigator.storage || !navigator.storage.estimate) {
      return null;
    }

    try {
      const { quota, usage } = await navigator.storage.estimate();
      if (typeof quota === 'number' && typeof usage === 'number') {
        return { quota, usage };
      }
      return null;
    } catch (error) {
      console.warn('[Replication] Storage estimate unavailable', error);
      return null;
    }
  }
}

