# P2P Swarm Stabilization & Resilience Plan

> **Status Update (2025-11-07):** PeerJS removed the public `listAllPeers()` endpoint that powered the original swarm bootstrapper. The swarm now relies on the rendezvous mesh architecture described in [`docs/P2P_RENDEZVOUS_MESH_PLAN.md`](./P2P_RENDEZVOUS_MESH_PLAN.md). This document tracks the production state of the mesh-enabled swarm, highlights completed hardening work, and enumerates remaining gaps.

---

## 1. Current Architecture Snapshot

- **Signaling:** PeerJS cloud with dynamic endpoint failover handled by the P2P manager. 【F:src/lib/p2p/manager.ts†L13-L64】【F:src/components/P2PStatusIndicator.tsx†L13-L76】
- **Rendezvous Mesh:** Presence tickets signed with Ed25519 are announced to edge beacons and harvested from static capsules before falling back to cached peers. 【F:src/lib/p2p/manager.ts†L65-L119】【F:src/lib/p2p/bootstrap.ts†L321-L437】【F:src/lib/p2p/bootstrap.ts†L550-L646】
- **Local Discovery:** Gossip + peer exchange keep the peer registry hydrated and share newly learned peers. 【F:src/lib/p2p/manager.ts†L64-L113】【F:src/lib/p2p/peerExchange.ts†L1-L120】【F:src/lib/p2p/gossip.ts†L1-L146】
- **Content Transport:** Chunk protocol with IndexedDB-backed manifests and on-demand replication orchestrator. 【F:src/lib/p2p/chunkProtocol.ts†L1-L120】【F:src/lib/p2p/manager.ts†L640-L708】【F:src/lib/p2p/replication.ts†L1-L120】
- **Storage & Encryption:** Local-first manifests + encrypted chunks (AES-GCM/ECDH) managed by `store.ts` and `fileEncryption.ts`. 【F:src/lib/store.ts†L1-L160】【F:src/lib/fileEncryption.ts†L1-L160】
- **Observability:** Node metrics, diagnostics feed, and UI health indicators surface rendezvous failures, beacon latency, and connection ratios. 【F:src/lib/p2p/nodeMetrics.ts†L1-L120】【F:src/lib/p2p/diagnostics.ts†L1-L160】【F:src/components/P2PStatusIndicator.tsx†L77-L170】

---

## 2. Implemented Capabilities

| Capability | Status | Evidence |
|------------|--------|----------|
| **Ed25519 presence tickets & mesh toggles** | ✅ Complete | Tickets generated via `rendezvousIdentity.ts` and `presenceTicket.ts`; manager auto-enables rendezvous when supported. 【F:src/lib/p2p/rendezvousIdentity.ts†L1-L80】【F:src/lib/p2p/presenceTicket.ts†L1-L120】【F:src/lib/p2p/manager.ts†L640-L724】 |
| **Beacon announce / fetch pipeline** | ✅ Complete | `fetchBeaconPeers()` with retries, diagnostics, and signature validation; Cloudflare Worker Durable Object stores tickets. 【F:src/lib/p2p/bootstrap.ts†L321-L437】【F:services/rendezvous-beacon/index.ts†L1-L200】 |
| **Static capsule publishing + verification** | ✅ Complete | Capsule script aggregates beacon responses, signs bundles, and client verifies detached signatures. 【F:ops/scripts/publish-capsule.ts†L1-L160】【F:src/lib/p2p/bootstrap.ts†L550-L646】 |
| **Peer Exchange (PEX) + gossip loop** | ✅ Complete | Manager instantiates protocols for epidemic peer sharing and periodic gossip broadcasts. 【F:src/lib/p2p/manager.ts†L65-L113】【F:src/lib/p2p/gossip.ts†L1-L146】 |
| **Replication orchestrator** | ✅ Complete | Replica metadata persisted, redundancy targets enforced, and discovery updated with replica advertisements. 【F:src/lib/p2p/replication.ts†L1-L200】【F:src/lib/p2p/discovery.ts†L360-L404】 |
| **Connection health + sovereignty controls** | ✅ Complete | Health monitor, auto-reconnect, manual peer approval queue, and mesh pause/isolation toggles in context/UI. 【F:src/lib/p2p/connectionHealth.ts†L1-L200】【F:src/contexts/P2PContext.tsx†L80-L214】【F:src/components/P2PStatusIndicator.tsx†L13-L170】 |
| **Diagnostics + telemetry surfaced in UI** | ✅ Complete | Stats expose rendezvous attempts/latency, degradation badges rendered in status indicator and connected peers panel. 【F:src/lib/p2p/manager.ts†L88-L119】【F:src/components/P2PStatusIndicator.tsx†L77-L170】【F:docs/P2P_NETWORK_DIAGNOSTICS.md†L1-L68】 |

---

## 3. Rendezvous Mesh Flow

1. **Warm start from cache** – Bootstrap registry seeds candidate peers stored in IndexedDB, including optional hard-coded seeds. 【F:src/lib/p2p/bootstrap.ts†L33-L120】
2. **Ticket creation** – Browser checks for Ed25519 support, loads/generates a signing key, and emits a presence ticket envelope. 【F:src/lib/p2p/rendezvousIdentity.ts†L1-L80】【F:src/lib/p2p/presenceTicket.ts†L1-L120】
3. **Beacon announce + fetch** – Manager posts signed tickets to each beacon, aggregates verified responses, and records latency/failures for diagnostics. 【F:src/lib/p2p/bootstrap.ts†L321-L437】【F:src/lib/p2p/manager.ts†L1000-L1040】
4. **Capsule sync** – Static capsules are fetched, signatures verified, and peers merged into the rendezvous cache. 【F:src/lib/p2p/bootstrap.ts†L550-L646】
5. **Mesh hydration** – Peer exchange, gossip, and room discovery spread fresh peer IDs across the swarm; replication adverts ride alongside presence announcements. 【F:src/lib/p2p/manager.ts†L724-L812】【F:src/lib/p2p/gossip.ts†L1-L146】【F:src/lib/p2p/discovery.ts†L360-L404】
6. **Self-healing cadence** – Rendezvous refresh timers auto-retry until failure streak thresholds trigger a controlled fallback to bootstrap-only mode. 【F:src/lib/p2p/manager.ts†L1000-L1120】

---

## 4. Resilience & Observability Enhancements

- **Redundant content storage:** `ReplicationOrchestrator` backfills missing chunks, tracks redundancy targets, and flags incomplete replicas via diagnostics. 【F:src/lib/p2p/replication.ts†L120-L240】【F:src/lib/p2p/diagnostics.ts†L1-L120】
- **Node health metrics:** `NodeMetricsTracker` persists uptime, connection ratios, and rendezvous success counters for dashboards and incident response. 【F:src/lib/p2p/nodeMetrics.ts†L1-L160】
- **UI feedback loops:** Status indicator, connected peers panel, and debug panel expose degradation reasons (failure streaks, beacon latency, manual blocks). 【F:src/components/P2PStatusIndicator.tsx†L77-L170】【F:docs/P2P_NETWORK_DIAGNOSTICS.md†L35-L68】
- **Edge infrastructure:** Cloudflare Durable Object beacon retains ~200 signed tickets per community with TTL pruning, keeping capsules lightweight. 【F:services/rendezvous-beacon/index.ts†L1-L200】

---

## 5. Gap Analysis vs Current Specs

1. **Beacon integration tests pending** – Rendezvous plan still calls for Miniflare integration coverage to validate TTL pruning and rate limiting before GA. 【F:docs/P2P_RENDEZVOUS_MESH_PLAN.md†L63-L67】
2. **Identity-backed content signatures** – Original resilience roadmap still expects signed posts/files and verification hooks; implementation has not landed (`signing.ts`, post/chunk verification remain placeholders in the backlog). 【F:docs/Goals.md†L42-L64】【F:docs/ARCHITECTURE.md†L423-L446】
3. **Account recovery via secret sharing** – Distributed key backup remains unimplemented, leaving private-key loss a single point of failure. 【F:docs/Goals.md†L61-L64】
4. **Advanced topology work** – Supernode election, DHT-style routing, and offline sync queue are still tracked as long-term backlog items. 【F:docs/Resilience.md†L18-L116】
5. **Observability automation** – Rendezvous plan prescribes alerting when capsule publishing fails twice consecutively; automation wiring is pending. 【F:docs/P2P_RENDEZVOUS_MESH_PLAN.md†L83-L88】

---

## 6. Updated Roadmap

### Immediate Hardening
- Ship beacon integration tests (Miniflare) and add them to CI before enabling additional beacons. 【F:docs/P2P_RENDEZVOUS_MESH_PLAN.md†L63-L67】
- Instrument capsule publishing workflow with alerting hooks so on-call responders are notified when KPIs slip. 【F:docs/P2P_RENDEZVOUS_MESH_PLAN.md†L83-L88】

### Near-Term Resilience
- Implement Ed25519-backed content signing & verification for posts and file manifests, failing closed on invalid payloads. 【F:docs/Goals.md†L42-L64】【F:docs/ARCHITECTURE.md†L423-L446】
- Deliver Shamir secret-sharing backups for identity keys with shard exchange protocol over existing P2P channels. 【F:docs/Goals.md†L61-L64】

### Long-Term Swarm Intelligence
- Revisit supernode + DHT routing experiments after telemetry shows stable rendezvous performance. 【F:docs/Resilience.md†L18-L116】
- Build offline sync queues and background reconciliation so authors can create content without connectivity and merge later. 【F:docs/Goals.md†L55-L59】

This plan now reflects the rendezvous mesh-first discovery stack while keeping legacy backlog items visible for future resilience work.
