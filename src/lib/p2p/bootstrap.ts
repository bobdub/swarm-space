import {
  verifyPresenceTicket,
  verifyDetachedSignature,
  type PresenceTicketEnvelope,
  type PresenceTicketValidationResult,
  type SignatureVerifier
} from './presenceTicket';
import { stableStringify } from '../utils/canonicalJson';
import { recordP2PDiagnostic } from './diagnostics';

/**
 * Bootstrap Peer Registry
 *
 * Manages a persistent list of known peers to enable automatic
 * reconnection and swarm discovery.
 *
 * Includes hardcoded seed peers to bootstrap the network when no
 * local peers are available (like BitTorrent DHT bootstrap nodes).
 */

const BOOTSTRAP_STORAGE_KEY = 'p2p-bootstrap-peers';
const MAX_BOOTSTRAP_PEERS = 100;

/**
 * Hardcoded seed peers for initial network bootstrap
 * These are well-known stable nodes that help new peers join the swarm
 * 
 * NOTE: Add your stable node's Peer ID here once you have a long-running instance
 */
const SEED_PEERS: { peerId: string; userId: string }[] = [
  // Add stable seed peers here as the network grows
  // Example: { peerId: 'peer-id-123', userId: 'stable-node-1' }
];

function createAbortReason(message: string, name: string): Error {
  if (typeof DOMException !== 'undefined') {
    return new DOMException(message, name);
  }
  const error = new Error(message);
  error.name = name;
  return error;
}

function createAbortController(timeoutMs: number, externalSignal?: AbortSignal) {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const onExternalAbort = () => {
    controller.abort(externalSignal?.reason ?? createAbortReason('Aborted', 'AbortError'));
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      onExternalAbort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort);
    }
  }

  if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      controller.abort(createAbortReason(`Request timed out after ${timeoutMs}ms`, 'TimeoutError'));
    }, timeoutMs);
  }

  const cleanup = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (externalSignal) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
  };

  return { controller, cleanup };
}

async function waitWithBackoff(baseDelayMs: number, attempt: number): Promise<void> {
  const delay = Math.max(0, baseDelayMs) * Math.pow(2, Math.max(0, attempt - 1));
  await new Promise<void>(resolve => {
    setTimeout(() => resolve(), delay);
  });
}

export interface BootstrapPeer {
  peerId: string;
  userId: string;
  lastSeen: number;
  successfulConnections: number;
  failedConnections: number;
  reliability: number; // 0-1 score
}

export class BootstrapRegistry {
  private peers: Map<string, BootstrapPeer> = new Map();
  
  constructor() {
    this.load();
    this.addSeedPeers();
  }

  /**
   * Add hardcoded seed peers if not already in registry
   */
  private addSeedPeers(): void {
    let added = 0;
    for (const seed of SEED_PEERS) {
      if (!this.peers.has(seed.peerId)) {
        this.peers.set(seed.peerId, {
          peerId: seed.peerId,
          userId: seed.userId,
          lastSeen: 0, // Never seen yet
          successfulConnections: 0,
          failedConnections: 0,
          reliability: 0.5 // Neutral reliability for seeds
        });
        added++;
      }
    }
    if (added > 0) {
      console.log(`[Bootstrap] Added ${added} seed peers`);
    }
  }

  /**
   * Add or update a peer in the registry
   */
  addPeer(peerId: string, userId: string, successful: boolean = true): void {
    const existing = this.peers.get(peerId);
    
    if (existing) {
      existing.lastSeen = Date.now();
      if (successful) {
        existing.successfulConnections++;
      } else {
        existing.failedConnections++;
      }
      existing.reliability = this.calculateReliability(existing);
    } else {
      this.peers.set(peerId, {
        peerId,
        userId,
        lastSeen: Date.now(),
        successfulConnections: successful ? 1 : 0,
        failedConnections: successful ? 0 : 1,
        reliability: successful ? 1.0 : 0.0
      });
    }
    
    this.pruneAndSave();
  }

  /**
   * Get best peers for bootstrapping (sorted by reliability)
   */
  getBestPeers(count: number = 5): BootstrapPeer[] {
    const peers = Array.from(this.peers.values())
      .sort((a, b) => {
        // Sort by reliability first, then by last seen
        if (b.reliability !== a.reliability) {
          return b.reliability - a.reliability;
        }
        return b.lastSeen - a.lastSeen;
      });
    
    return peers.slice(0, count);
  }

  /**
   * Get all known peers
   */
  getAllPeers(): BootstrapPeer[] {
    return Array.from(this.peers.values());
  }

  /**
   * Get a peer by ID
   */
  getPeer(peerId: string): BootstrapPeer | undefined {
    return this.peers.get(peerId);
  }

  /**
   * Remove a peer from registry
   */
  removePeer(peerId: string): void {
    this.peers.delete(peerId);
    this.save();
  }

  /**
   * Clear all peers
   */
  clear(): void {
    this.peers.clear();
    this.save();
  }

  /**
   * Get registry stats
   */
  getStats() {
    const peers = Array.from(this.peers.values());
    const avgReliability = peers.length > 0
      ? peers.reduce((sum, p) => sum + p.reliability, 0) / peers.length
      : 0;
    
    return {
      totalPeers: peers.length,
      avgReliability: avgReliability.toFixed(2),
      recentPeers: peers.filter(p => Date.now() - p.lastSeen < 3600000).length // last hour
    };
  }

  // Private methods

  private calculateReliability(peer: BootstrapPeer): number {
    const total = peer.successfulConnections + peer.failedConnections;
    if (total === 0) return 0;
    
    const successRate = peer.successfulConnections / total;
    
    // Factor in recency - peers seen recently are more reliable
    const recencyScore = Math.max(0, 1 - (Date.now() - peer.lastSeen) / (7 * 24 * 3600000)); // 7 days decay
    
    return (successRate * 0.7) + (recencyScore * 0.3);
  }

  private pruneAndSave(): void {
    // Keep only the best peers if we exceed the limit
    if (this.peers.size > MAX_BOOTSTRAP_PEERS) {
      const sorted = Array.from(this.peers.values())
        .sort((a, b) => b.reliability - a.reliability);
      
      this.peers.clear();
      sorted.slice(0, MAX_BOOTSTRAP_PEERS).forEach(peer => {
        this.peers.set(peer.peerId, peer);
      });
    }
    
    this.save();
  }

  private save(): void {
    try {
      const data = Array.from(this.peers.values());
      localStorage.setItem(BOOTSTRAP_STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('[Bootstrap] Failed to save registry:', error);
    }
  }

  private load(): void {
    try {
      const data = localStorage.getItem(BOOTSTRAP_STORAGE_KEY);
      if (data) {
        const peers = JSON.parse(data) as BootstrapPeer[];
        peers.forEach(peer => {
          this.peers.set(peer.peerId, peer);
        });
        console.log(`[Bootstrap] Loaded ${peers.length} peers from storage`);
      }
    } catch (error) {
      console.error('[Bootstrap] Failed to load registry:', error);
    }
  }
}

export type RendezvousPeerSource = 'beacon' | 'capsule';

export interface RendezvousPeerRecord {
  peerId: string;
  userId: string;
  expiresAt: number;
  source: RendezvousPeerSource;
  origin: string;
  ticket: PresenceTicketEnvelope;
  validation: PresenceTicketValidationResult;
  receivedAt: number;
}

export interface RendezvousRequestPolicy {
  timeoutMs?: number;
  retryLimit?: number;
  retryBackoffMs?: number;
}

export interface BeaconEndpoint extends RendezvousRequestPolicy {
  url: string;
  community?: string;
  authToken?: string;
}

export interface FetchBeaconPeersOptions {
  signal?: AbortSignal;
  now?: number;
  allowClockSkewMs?: number;
  trustedPublicKeys?: string[];
  verifier?: SignatureVerifier;
  defaultTimeoutMs?: number;
  defaultRetryLimit?: number;
  defaultRetryBackoffMs?: number;
}

export interface RendezvousFetchResult {
  records: RendezvousPeerRecord[];
  attempts: number;
  successes: number;
  failures: number;
  aborted: number;
}

interface BeaconAnnounceResponse {
  peers?: PresenceTicketEnvelope[];
  serverTime?: number;
}

export async function fetchBeaconPeers(
  endpoints: BeaconEndpoint[],
  announcement?: PresenceTicketEnvelope,
  options: FetchBeaconPeersOptions = {}
): Promise<RendezvousFetchResult> {
  if (endpoints.length === 0) {
    return { records: [], attempts: 0, successes: 0, failures: 0, aborted: 0 };
  }

  const now = options.now ?? Date.now();
  const records = new Map<string, RendezvousPeerRecord>();
  let attempts = 0;
  let successes = 0;
  let failures = 0;
  let aborted = 0;

  await Promise.allSettled(
    endpoints.map(async endpoint => {
      const hasAnnouncement = Boolean(announcement);
      const path = hasAnnouncement ? 'announce' : 'peers';
      const operation = hasAnnouncement ? 'announce' : 'peers';
      const url = buildEndpointUrl(endpoint.url, path, endpoint.community);

      const timeoutMs = endpoint.timeoutMs ?? options.defaultTimeoutMs ?? 8000;
      const retryLimit = Math.max(0, endpoint.retryLimit ?? options.defaultRetryLimit ?? 2);
      const retryBackoffMs = endpoint.retryBackoffMs ?? options.defaultRetryBackoffMs ?? 1000;

      let attempt = 0;
      while (attempt <= retryLimit) {
        attempt++;
        attempts++;

        const { controller, cleanup } = createAbortController(timeoutMs, options.signal);
        const startedAt = Date.now();

        try {
          const response = await fetch(url, {
            method: hasAnnouncement ? 'POST' : 'GET',
            headers: {
              'Accept': 'application/json',
              ...(hasAnnouncement ? { 'Content-Type': 'application/json' } : {}),
              ...(endpoint.authToken ? { Authorization: `Bearer ${endpoint.authToken}` } : {})
            },
            signal: controller.signal,
            body: hasAnnouncement
              ? JSON.stringify({
                  ticket: announcement,
                  community: endpoint.community
                })
              : undefined
          });

          cleanup();

          if (!response.ok) {
            failures++;
            recordP2PDiagnostic({
              level: 'warn',
              source: 'rendezvous',
              code: 'beacon-fetch-failed',
              message: `Beacon ${operation} failed with status ${response.status}`,
              context: {
                url,
                attempt,
                status: response.status,
                durationMs: Date.now() - startedAt,
              },
            });

            if (attempt <= retryLimit) {
              await waitWithBackoff(retryBackoffMs, attempt);
              continue;
            }
            break;
          }

          const payload = (await response.json()) as BeaconAnnounceResponse;
          if (!payload.peers || !Array.isArray(payload.peers)) {
            failures++;
            recordP2PDiagnostic({
              level: 'warn',
              source: 'rendezvous',
              code: 'beacon-fetch-invalid',
              message: 'Beacon response missing peers array',
              context: { url, attempt },
            });

            if (attempt <= retryLimit) {
              await waitWithBackoff(retryBackoffMs, attempt);
              continue;
            }
            break;
          }

          await collectVerifiedPeers(records, payload.peers, 'beacon', endpoint.url, {
            now,
            allowClockSkewMs: options.allowClockSkewMs,
            trustedPublicKeys: options.trustedPublicKeys,
            verifier: options.verifier
          });

          successes++;
          recordP2PDiagnostic({
            level: 'info',
            source: 'rendezvous',
            code: 'beacon-fetch-success',
            message: 'Beacon rendezvous fetch succeeded',
            context: {
              url,
              attempt,
              peers: records.size,
              durationMs: Date.now() - startedAt,
            },
          });
          break;
        } catch (error) {
          cleanup();
          const abortError = error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError');
          if (abortError || controller.signal.aborted) {
            aborted++;
            recordP2PDiagnostic({
              level: 'warn',
              source: 'rendezvous',
              code: 'beacon-fetch-timeout',
              message: 'Beacon rendezvous fetch aborted or timed out',
              context: {
                url,
                attempt,
                timeoutMs,
              },
            });
          } else {
            failures++;
            recordP2PDiagnostic({
              level: 'error',
              source: 'rendezvous',
              code: 'beacon-fetch-error',
              message: 'Beacon rendezvous fetch errored',
              context: {
                url,
                attempt,
                reason: error instanceof Error ? error.message : String(error),
              },
            });
          }

          if (attempt <= retryLimit) {
            await waitWithBackoff(retryBackoffMs, attempt);
          }
        }
      }
    })
  );

  const collected = Array.from(records.values());
  const summary: RendezvousFetchResult = {
    records: collected,
    attempts,
    successes,
    failures,
    aborted,
  };

  recordP2PDiagnostic({
    level: successes > 0 ? 'info' : 'warn',
    source: 'rendezvous',
    code: 'beacon-fetch-summary',
    message: 'Beacon rendezvous fetch cycle complete',
    context: {
      attempts,
      successes,
      failures,
      aborted,
      peers: collected.length,
    },
  });

  return summary;
}

export interface CapsuleSource extends RendezvousRequestPolicy {
  url: string;
  publicKey: string;
  community?: string;
  algorithm?: 'ed25519';
}

export interface FetchCapsulePeersOptions {
  signal?: AbortSignal;
  now?: number;
  allowClockSkewMs?: number;
  trustedPublicKeys?: string[];
  verifier?: SignatureVerifier;
  defaultTimeoutMs?: number;
  defaultRetryLimit?: number;
  defaultRetryBackoffMs?: number;
}

interface CapsuleFile {
  version: number;
  community?: string;
  issuedAt: number;
  expiresAt: number;
  peers: PresenceTicketEnvelope[];
  signature: string;
  algorithm?: 'ed25519';
}

export async function fetchCapsulePeers(
  sources: CapsuleSource[],
  options: FetchCapsulePeersOptions = {}
): Promise<RendezvousFetchResult> {
  if (sources.length === 0) {
    return { records: [], attempts: 0, successes: 0, failures: 0, aborted: 0 };
  }

  const now = options.now ?? Date.now();
  const records = new Map<string, RendezvousPeerRecord>();
  let attempts = 0;
  let successes = 0;
  let failures = 0;
  let aborted = 0;

  await Promise.allSettled(
    sources.map(async source => {
      const url = normalizeUrl(source.url);
      const timeoutMs = source.timeoutMs ?? options.defaultTimeoutMs ?? 8000;
      const retryLimit = Math.max(0, source.retryLimit ?? options.defaultRetryLimit ?? 1);
      const retryBackoffMs = source.retryBackoffMs ?? options.defaultRetryBackoffMs ?? 1000;

      let attempt = 0;
      while (attempt <= retryLimit) {
        attempt++;
        attempts++;

        const { controller, cleanup } = createAbortController(timeoutMs, options.signal);
        const startedAt = Date.now();

        try {
          const response = await fetch(url, {
            method: 'GET',
            signal: controller.signal,
            headers: { 'Accept': 'application/json' }
          });

          cleanup();

          if (!response.ok) {
            failures++;
            recordP2PDiagnostic({
              level: 'warn',
              source: 'rendezvous',
              code: 'capsule-fetch-failed',
              message: `Capsule fetch failed with status ${response.status}`,
              context: {
                url,
                attempt,
                status: response.status,
                durationMs: Date.now() - startedAt,
              },
            });
            if (attempt <= retryLimit) {
              await waitWithBackoff(retryBackoffMs, attempt);
              continue;
            }
            break;
          }

          const capsule = (await response.json()) as CapsuleFile;

          if (!isValidCapsule(capsule)) {
            failures++;
            recordP2PDiagnostic({
              level: 'warn',
              source: 'rendezvous',
              code: 'capsule-fetch-invalid',
              message: 'Capsule payload invalid',
              context: { url, attempt },
            });
            if (attempt <= retryLimit) {
              await waitWithBackoff(retryBackoffMs, attempt);
              continue;
            }
            break;
          }

          if (capsule.expiresAt < now) {
            failures++;
            recordP2PDiagnostic({
              level: 'warn',
              source: 'rendezvous',
              code: 'capsule-fetch-expired',
              message: 'Capsule expired before processing',
              context: { url, attempt, expiresAt: capsule.expiresAt, now },
            });
            if (attempt <= retryLimit) {
              await waitWithBackoff(retryBackoffMs, attempt);
              continue;
            }
            break;
          }

          const algorithm = capsule.algorithm ?? 'ed25519';
          const canonicalPayload = stableStringify({
            version: capsule.version,
            community: capsule.community ?? null,
            issuedAt: capsule.issuedAt,
            expiresAt: capsule.expiresAt,
            peers: capsule.peers
          });

          const signatureValid = await verifyDetachedSignature(
            canonicalPayload,
            capsule.signature,
            algorithm,
            source.publicKey
          );

          if (!signatureValid) {
            failures++;
            recordP2PDiagnostic({
              level: 'warn',
              source: 'rendezvous',
              code: 'capsule-fetch-signature-invalid',
              message: 'Capsule signature invalid',
              context: { url, attempt },
            });
            if (attempt <= retryLimit) {
              await waitWithBackoff(retryBackoffMs, attempt);
              continue;
            }
            break;
          }

          await collectVerifiedPeers(records, capsule.peers, 'capsule', source.url, {
            now,
            allowClockSkewMs: options.allowClockSkewMs,
            trustedPublicKeys: options.trustedPublicKeys,
            verifier: options.verifier
          });

          successes++;
          recordP2PDiagnostic({
            level: 'info',
            source: 'rendezvous',
            code: 'capsule-fetch-success',
            message: 'Capsule rendezvous fetch succeeded',
            context: {
              url,
              attempt,
              peers: records.size,
              durationMs: Date.now() - startedAt,
            },
          });
          break;
        } catch (error) {
          cleanup();
          const abortError = error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError');
          if (abortError || controller.signal.aborted) {
            aborted++;
            recordP2PDiagnostic({
              level: 'warn',
              source: 'rendezvous',
              code: 'capsule-fetch-timeout',
              message: 'Capsule rendezvous fetch aborted or timed out',
              context: {
                url,
                attempt,
                timeoutMs,
              },
            });
          } else {
            failures++;
            recordP2PDiagnostic({
              level: 'error',
              source: 'rendezvous',
              code: 'capsule-fetch-error',
              message: 'Capsule rendezvous fetch errored',
              context: {
                url,
                attempt,
                reason: error instanceof Error ? error.message : String(error),
              },
            });
          }

          if (attempt <= retryLimit) {
            await waitWithBackoff(retryBackoffMs, attempt);
          }
        }
      }
    })
  );

  const collected = Array.from(records.values());
  const summary: RendezvousFetchResult = {
    records: collected,
    attempts,
    successes,
    failures,
    aborted,
  };

  recordP2PDiagnostic({
    level: successes > 0 ? 'info' : 'warn',
    source: 'rendezvous',
    code: 'capsule-fetch-summary',
    message: 'Capsule rendezvous fetch cycle complete',
    context: {
      attempts,
      successes,
      failures,
      aborted,
      peers: collected.length,
    },
  });

  return summary;
}

async function collectVerifiedPeers(
  bucket: Map<string, RendezvousPeerRecord>,
  peers: PresenceTicketEnvelope[],
  source: RendezvousPeerSource,
  origin: string,
  options: {
    now: number;
    allowClockSkewMs?: number;
    trustedPublicKeys?: string[];
    verifier?: SignatureVerifier;
  }
): Promise<void> {
  for (const ticket of peers) {
    const validation = await verifyPresenceTicket(ticket, {
      now: options.now,
      allowClockSkewMs: options.allowClockSkewMs,
      trustedPublicKeys: options.trustedPublicKeys,
      verifier: options.verifier
    });

    if (!validation.ok) {
      console.warn('[Bootstrap] Ignoring peer with invalid ticket:', validation.reason);
      continue;
    }

    const key = `${ticket.payload.peerId}:${ticket.payload.userId}`;
    const record: RendezvousPeerRecord = {
      peerId: ticket.payload.peerId,
      userId: ticket.payload.userId,
      expiresAt: ticket.payload.expiresAt,
      source,
      origin,
      ticket,
      validation,
      receivedAt: options.now
    };

    const existing = bucket.get(key);
    if (!existing || existing.expiresAt < record.expiresAt) {
      bucket.set(key, record);
    }
  }
}

function buildEndpointUrl(base: string, path: 'announce' | 'peers', community?: string): string {
  const normalized = normalizeUrl(base).replace(/\/$/, '');
  try {
    const url = new URL(`${normalized}/${path}`);
    if (community) {
      url.searchParams.set('community', community);
    }
    return url.toString();
  } catch {
    // Fallback for relative URLs – preserve previous behaviour
    const suffix = community ? `?community=${encodeURIComponent(community)}` : '';
    return `${normalized}/${path}${suffix}`;
  }
}

function normalizeUrl(url: string): string {
  return url.trim();
}

function isValidCapsule(candidate: CapsuleFile): candidate is CapsuleFile {
  return (
    typeof candidate === 'object' &&
    candidate !== null &&
    candidate.version === 1 &&
    typeof candidate.issuedAt === 'number' &&
    typeof candidate.expiresAt === 'number' &&
    Array.isArray(candidate.peers) &&
    typeof candidate.signature === 'string'
  );
}

// stableStringify moved to shared canonical JSON util
