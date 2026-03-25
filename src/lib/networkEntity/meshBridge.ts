/**
 * ═══════════════════════════════════════════════════════════════════════
 * NETWORK ENTITY — Swarm Mesh Bridge
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Wires the NetworkEntityLiveScaffold into the live swarm mesh so the
 * entity can:
 *   - Observe all posts, comments, and peer events flowing through the mesh
 *   - Evaluate moderation proposals in real-time
 *   - Broadcast its presence via the `entity-status` channel
 *   - Respond to network/safety questions via `entity-reply` channel
 *   - Mine memory coins and manage memory rotation
 *
 * The entity is NOT a PeerJS peer — it runs locally inside every node
 * and participates via the swarm's channel system.
 * ═══════════════════════════════════════════════════════════════════════
 */

import { NetworkEntityLiveScaffold } from './liveScaffold';
import type {
  NetworkEntityMeshEvent,
  NetworkEntityModerationProposal,
  NetworkEntityMemoryCoin,
} from './types';
import type { StandaloneSwarmMesh, ContentItem, SwarmPeer, SwarmPhase } from '../p2p/swarmMesh.standalone';

// ── Constants ──────────────────────────────────────────────────────────

const ENTITY_PEER_ID = 'peer-network-entity';
const ENTITY_DISPLAY_NAME = '|Ψ_Infinity⟩';
const ENTITY_USERNAME = 'infinity';

const STATUS_BROADCAST_INTERVAL = 30_000; // Announce presence every 30s
const MEMORY_CHECKPOINT_INTERVAL = 60_000; // Check memory fill every 60s
const MODERATION_LOG_KEY = 'network-entity-moderation-log';
const MEMORY_COIN_KEY = 'network-entity-memory-coin';

// ── Types ──────────────────────────────────────────────────────────────

export interface EntityBridgeStats {
  active: boolean;
  eventsIngested: number;
  moderationProposals: NetworkEntityModerationProposal[];
  memoryCoin: NetworkEntityMemoryCoin;
  lastStatusBroadcast: number | null;
}

type CleanupFn = () => void;

// ═══════════════════════════════════════════════════════════════════════
// BRIDGE CLASS
// ═══════════════════════════════════════════════════════════════════════

export class NetworkEntityMeshBridge {
  private readonly entity: NetworkEntityLiveScaffold;
  private mesh: StandaloneSwarmMesh | null = null;
  private cleanups: CleanupFn[] = [];
  private active = false;
  private eventsIngested = 0;
  private moderationProposals: NetworkEntityModerationProposal[] = [];
  private memoryCoin: NetworkEntityMemoryCoin;
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private memoryTimer: ReturnType<typeof setInterval> | null = null;
  private lastStatusBroadcast: number | null = null;

  constructor() {
    this.entity = new NetworkEntityLiveScaffold({
      peerId: ENTITY_PEER_ID,
      autoConnectEnabled: true,
      desiredPeerCount: 6,
      maxAutoConnectBatch: 4,
    });
    this.memoryCoin = this.loadMemoryCoin();
    this.moderationProposals = this.loadModerationLog();

    // Bootstrap coin memory with core docs
    this.entity.buildCoinMemoryBootstrap(this.memoryCoin);
  }

  // ═══════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ═══════════════════════════════════════════════════════════════════

  attach(mesh: StandaloneSwarmMesh): void {
    if (this.active) this.detach();
    this.mesh = mesh;
    this.active = true;

    console.log(`[NetworkEntity] 🧠 Attaching to swarm mesh as ${ENTITY_DISPLAY_NAME}`);

    // ── Subscribe to content events ──
    const contentUnsub = mesh.onContent((item: ContentItem) => {
      this.handleContentItem(item);
    });
    this.cleanups.push(contentUnsub);

    // ── Subscribe to peer changes ──
    const peerUnsub = mesh.onPeersChange((peers: SwarmPeer[]) => {
      this.handlePeerChange(peers);
    });
    this.cleanups.push(peerUnsub);

    // ── Subscribe to phase changes ──
    const phaseUnsub = mesh.onPhaseChange((phase: SwarmPhase) => {
      if (phase === 'online') {
        this.broadcastPresence();
      }
    });
    this.cleanups.push(phaseUnsub);

    // ── Listen for entity queries on the `entity-query` channel ──
    const queryUnsub = mesh.onMessage('entity-query', (fromPeerId: string, payload: unknown) => {
      this.handleEntityQuery(fromPeerId, payload);
    });
    this.cleanups.push(queryUnsub);

    // ── Periodic presence broadcast ──
    this.statusTimer = setInterval(() => {
      if (this.active && mesh.getPhase() === 'online') {
        this.broadcastPresence();
      }
    }, STATUS_BROADCAST_INTERVAL);

    // ── Periodic memory checkpoint ──
    this.memoryTimer = setInterval(() => {
      this.runMemoryCheckpoint();
    }, MEMORY_CHECKPOINT_INTERVAL);

    // Immediate presence broadcast
    if (mesh.getPhase() === 'online') {
      this.broadcastPresence();
    }

    console.log(`[NetworkEntity] ✅ Entity bridge active — monitoring mesh traffic`);
  }

  detach(): void {
    for (const fn of this.cleanups) {
      try { fn(); } catch { /* ignore */ }
    }
    this.cleanups = [];

    if (this.statusTimer !== null) {
      clearInterval(this.statusTimer);
      this.statusTimer = null;
    }
    if (this.memoryTimer !== null) {
      clearInterval(this.memoryTimer);
      this.memoryTimer = null;
    }

    this.active = false;
    this.mesh = null;
    console.log('[NetworkEntity] 🛑 Entity bridge detached');
  }

  isActive(): boolean {
    return this.active;
  }

  getStats(): EntityBridgeStats {
    return {
      active: this.active,
      eventsIngested: this.eventsIngested,
      moderationProposals: [...this.moderationProposals],
      memoryCoin: { ...this.memoryCoin },
      lastStatusBroadcast: this.lastStatusBroadcast,
    };
  }

  getEntity(): NetworkEntityLiveScaffold {
    return this.entity;
  }

  // ═══════════════════════════════════════════════════════════════════
  // EVENT HANDLERS
  // ═══════════════════════════════════════════════════════════════════

  private handleContentItem(item: ContentItem): void {
    const event = this.contentItemToEvent(item);
    if (!event) return;

    this.entity.ingestEvent(event);
    this.eventsIngested++;

    // Evaluate for moderation
    const proposal = this.entity.evaluateModeration(event);
    if (proposal) {
      this.moderationProposals.push(proposal);
      this.saveModerationLog();
      console.log(
        `[NetworkEntity] 🛡️ MODERATION PROPOSAL: ${proposal.action} for peer ${proposal.peerId.slice(0, 16)} ` +
        `(confidence=${proposal.confidence.toFixed(2)}, reason="${proposal.reason}")`
      );

      // Broadcast moderation proposal to mesh for human review
      this.mesh?.broadcast('entity-moderation', {
        type: 'proposal',
        proposal,
        entityPeerId: ENTITY_PEER_ID,
      });
    }

    // Record memory usage
    const payloadBytes = new TextEncoder().encode(JSON.stringify(event)).length;
    this.memoryCoin.usedBytes += payloadBytes;
    this.saveMemoryCoin();
  }

  private handlePeerChange(peers: SwarmPeer[]): void {
    for (const peer of peers) {
      const event: NetworkEntityMeshEvent = {
        id: `peer-status-${peer.peerId}-${Date.now()}`,
        type: 'peer_status',
        authorPeerId: peer.peerId,
        payload: JSON.stringify({
          status: 'connected',
          avgRttMs: peer.avgRttMs,
          source: peer.source,
          lastMinedBlock: peer.lastMinedBlock,
        }),
        createdAt: new Date().toISOString(),
      };
      this.entity.ingestEvent(event);
      this.eventsIngested++;
    }
  }

  private handleEntityQuery(fromPeerId: string, payload: unknown): void {
    if (!this.mesh || !payload || typeof payload !== 'object') return;
    const msg = payload as { question?: string; queryId?: string };
    if (!msg.question) return;

    const event: NetworkEntityMeshEvent = {
      id: msg.queryId || `query-${Date.now()}-${fromPeerId.slice(0, 8)}`,
      type: 'comment',
      authorPeerId: fromPeerId,
      payload: msg.question,
      createdAt: new Date().toISOString(),
    };

    // Ingest and draft reply
    this.entity.ingestEvent(event);
    this.eventsIngested++;

    const draft = this.entity.draftReply(event);

    // Send reply back via entity-reply channel
    void this.mesh.send('entity-reply', fromPeerId, {
      queryId: event.id,
      reply: draft,
      entityPeerId: ENTITY_PEER_ID,
      entityName: ENTITY_DISPLAY_NAME,
    });

    console.log(
      `[NetworkEntity] 💬 Replied to ${fromPeerId.slice(0, 16)} ` +
      `(priority=${draft.priority}, source=${draft.source})`
    );
  }

  // ═══════════════════════════════════════════════════════════════════
  // PRESENCE
  // ═══════════════════════════════════════════════════════════════════

  private broadcastPresence(): void {
    if (!this.mesh) return;

    const stats = this.getStats();
    this.mesh.broadcast('entity-status', {
      entityPeerId: ENTITY_PEER_ID,
      displayName: ENTITY_DISPLAY_NAME,
      username: ENTITY_USERNAME,
      active: true,
      eventsIngested: stats.eventsIngested,
      pendingModerationProposals: stats.moderationProposals.length,
      memoryCoinFill: this.memoryCoin.capacityBytes > 0
        ? (this.memoryCoin.usedBytes / this.memoryCoin.capacityBytes * 100).toFixed(1)
        : '0.0',
      backlogSize: this.entity.getBacklog().length,
      timestamp: Date.now(),
    });

    this.lastStatusBroadcast = Date.now();
  }

  // ═══════════════════════════════════════════════════════════════════
  // MEMORY COIN
  // ═══════════════════════════════════════════════════════════════════

  private runMemoryCheckpoint(): void {
    const checkpoint = this.entity.memoryCheckpoint(this.memoryCoin);

    if (checkpoint.shouldRotateCoin) {
      console.log(
        `[NetworkEntity] 🔄 MEMORY ROTATION: ${checkpoint.reason} — ` +
        `Minting new coin (old coinId=${this.memoryCoin.coinId})`
      );

      // Mint a new coin
      this.memoryCoin = {
        coinId: `entity-coin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        usedBytes: 0,
        capacityBytes: 1_048_576, // 1 MiB per coin
        isReservedForEntity: true,
      };
      this.saveMemoryCoin();

      // Bootstrap new coin memory
      this.entity.buildCoinMemoryBootstrap(this.memoryCoin);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // CONVERTERS
  // ═══════════════════════════════════════════════════════════════════

  private contentItemToEvent(item: ContentItem): NetworkEntityMeshEvent | null {
    const data = item.data as Record<string, unknown> | undefined;
    if (!data) return null;

    let payload = '';
    if (item.type === 'post') {
      payload = [data.content, data.title].filter(Boolean).join(' ');
    } else if (item.type === 'comment') {
      payload = (data.content as string) || (data.text as string) || '';
    } else {
      payload = JSON.stringify(data).slice(0, 500);
    }

    if (!payload.trim()) return null;

    return {
      id: item.id,
      type: item.type === 'post' ? 'post' : item.type === 'comment' ? 'comment' : 'system_alert',
      roomId: (data.roomId as string) || undefined,
      authorPeerId: item.author || 'unknown',
      payload,
      createdAt: item.timestamp ? new Date(item.timestamp).toISOString() : new Date().toISOString(),
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  // PERSISTENCE
  // ═══════════════════════════════════════════════════════════════════

  private loadMemoryCoin(): NetworkEntityMemoryCoin {
    try {
      const raw = localStorage.getItem(MEMORY_COIN_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }

    return {
      coinId: `entity-coin-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      usedBytes: 0,
      capacityBytes: 1_048_576, // 1 MiB
      isReservedForEntity: true,
    };
  }

  private saveMemoryCoin(): void {
    try {
      localStorage.setItem(MEMORY_COIN_KEY, JSON.stringify(this.memoryCoin));
    } catch { /* ignore */ }
  }

  private loadModerationLog(): NetworkEntityModerationProposal[] {
    try {
      const raw = localStorage.getItem(MODERATION_LOG_KEY);
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return [];
  }

  private saveModerationLog(): void {
    try {
      // Keep only last 100 proposals
      const trimmed = this.moderationProposals.slice(-100);
      localStorage.setItem(MODERATION_LOG_KEY, JSON.stringify(trimmed));
    } catch { /* ignore */ }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════════════

let _bridge: NetworkEntityMeshBridge | null = null;

export function getNetworkEntityBridge(): NetworkEntityMeshBridge {
  if (!_bridge) _bridge = new NetworkEntityMeshBridge();
  return _bridge;
}

export function destroyNetworkEntityBridge(): void {
  _bridge?.detach();
  _bridge = null;
}

export { ENTITY_PEER_ID, ENTITY_DISPLAY_NAME, ENTITY_USERNAME };
