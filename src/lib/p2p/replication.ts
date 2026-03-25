import { get, getAll, put, remove, type Manifest, type Chunk } from '../store';
import type { Post } from '@/types';
import { canonicalJsonBytes } from '../utils/canonicalJson';
import { arrayBufferToBase64 } from '../crypto';
import { recordP2PDiagnostic } from './diagnostics';
import type { ChunkProtocol } from './chunkProtocol';
import type { PeerDiscovery } from './discovery';
import {
  verifyDetachedSignature,
  type PresenceTicketSigner,
  type SignatureBytes
} from './presenceTicket';
import { getRendezvousSigner } from './rendezvousIdentity';

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

const SIGNATURE_ALGORITHM = 'ed25519' as const;

let contentSignerPromise: Promise<PresenceTicketSigner> | null = null;

function toArrayBuffer(bytes: SignatureBytes): ArrayBuffer {
  if (bytes instanceof ArrayBuffer) {
    return bytes;
  }
  if (bytes instanceof Uint8Array) {
    const buffer = bytes.buffer;
    if (buffer instanceof ArrayBuffer) {
      return buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
    // SharedArrayBuffer case - copy to ArrayBuffer
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer as ArrayBuffer;
  }
  const view = new Uint8Array(bytes);
  // Always copy to ensure we have an ArrayBuffer
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer as ArrayBuffer;
}

function manifestSigningPayload(manifest: Manifest): Record<string, unknown> {
  return {
    fileId: manifest.fileId,
    chunks: Array.isArray(manifest.chunks) ? [...manifest.chunks] : [],
    mime: manifest.mime ?? null,
    size: typeof manifest.size === 'number' ? manifest.size : null,
    originalName: manifest.originalName ?? null,
    createdAt: manifest.createdAt,
    owner: manifest.owner ?? null,
    fileKey: manifest.fileKey ?? null
  };
}

function postSigningPayload(post: Post): Record<string, unknown> {
  const manifestIds = Array.isArray(post.manifestIds) ? [...post.manifestIds] : [];
  manifestIds.sort();
  const tags = Array.isArray(post.tags) ? [...post.tags] : [];
  tags.sort();

  return {
    id: post.id,
    author: post.author,
    projectId: post.projectId ?? null,
    type: post.type,
    content: post.content,
    manifestIds,
    createdAt: post.createdAt,
    editedAt: post.editedAt ?? null,
    nsfw: post.nsfw ?? false,
    tags,
    stream: post.stream ?? null
  };
}

async function getContentSigner(): Promise<PresenceTicketSigner> {
  if (!contentSignerPromise) {
    contentSignerPromise = getRendezvousSigner();
  }
  return contentSignerPromise;
}

export async function signManifest(manifest: Manifest, options: { signedAt?: string } = {}): Promise<Manifest> {
  const signer = await getContentSigner();
  const signedAt = options.signedAt ?? new Date().toISOString();
  const payload = canonicalJsonBytes(manifestSigningPayload(manifest));
  const signatureBytes = await signer.sign(payload);
  const arrayBuffer = toArrayBuffer(signatureBytes);

  return {
    ...manifest,
    signature: arrayBufferToBase64(arrayBuffer),
    signatureAlgorithm: SIGNATURE_ALGORITHM,
    signerPublicKey: signer.publicKey,
    signedAt
  };
}

export async function verifyManifestSignature(manifest: Manifest): Promise<boolean> {
  if (!manifest || !manifest.signature || !manifest.signerPublicKey) {
    return false;
  }

  if (manifest.signatureAlgorithm && manifest.signatureAlgorithm !== SIGNATURE_ALGORITHM) {
    return false;
  }

  try {
    return await verifyDetachedSignature(
      canonicalJsonBytes(manifestSigningPayload(manifest)),
      manifest.signature,
      SIGNATURE_ALGORITHM,
      manifest.signerPublicKey
    );
  } catch (error) {
    console.warn('[Replication] Manifest signature verification failed:', error);
    return false;
  }
}

export async function signPost(post: Post, options: { signedAt?: string } = {}): Promise<Post> {
  const signer = await getContentSigner();
  const signedAt = options.signedAt ?? new Date().toISOString();
  const payload = canonicalJsonBytes(postSigningPayload(post));
  const signatureBytes = await signer.sign(payload);
  const arrayBuffer = toArrayBuffer(signatureBytes);

  return {
    ...post,
    signature: arrayBufferToBase64(arrayBuffer),
    signatureAlgorithm: SIGNATURE_ALGORITHM,
    signerPublicKey: signer.publicKey,
    signedAt
  };
}

export async function verifyPostSignature(post: Post): Promise<boolean> {
  if (!post || !post.signature || !post.signerPublicKey) {
    return false;
  }

  if (post.signatureAlgorithm && post.signatureAlgorithm !== SIGNATURE_ALGORITHM) {
    return false;
  }

  try {
    return await verifyDetachedSignature(
      canonicalJsonBytes(postSigningPayload(post)),
      post.signature,
      SIGNATURE_ALGORITHM,
      post.signerPublicKey
    );
  } catch (error) {
    console.warn('[Replication] Post signature verification failed:', error);
    return false;
  }
}

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
      let manifest = await this.deps.ensureManifest(manifestId);
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

      const manifestValid = await verifyManifestSignature(manifest);
      if (!manifestValid) {
        if (hasPrimaryContent) {
          manifest = await signManifest(manifest);
          await put('manifests', manifest);
          recordP2PDiagnostic({
            level: 'info',
            source: 'replication',
            code: 'manifest-signature-local-refresh',
            message: 'Local manifest re-signed before replication',
            context: { manifestId }
          });
        } else {
          recordP2PDiagnostic({
            level: 'warn',
            source: 'replication',
            code: 'manifest-signature-invalid',
            message: 'Skipping replica with invalid manifest signature',
            context: { manifestId }
          });
          return;
        }
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

