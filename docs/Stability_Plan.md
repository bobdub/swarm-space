# P2P Swarm Stability & Node Dashboard Master Plan

> **Status Update (2025-11-07):** The swarm now operates on the rendezvous mesh bootstrap pipeline described in [`P2P_SWARM_STABILIZATION_PLAN.md`](./P2P_SWARM_STABILIZATION_PLAN.md). PeerJS public peer discovery has been deprecated, so stability work must assume mesh-first discovery and local-first storage.

---

## 1. Current State & Architecture Snapshot

- **Signaling & Failover:** PeerJS cloud endpoints with automatic failover controlled by the P2P manager.
- **Rendezvous Mesh:** Ed25519-signed presence tickets broadcast to edge beacons, harvested via static capsules, and cached for warm starts.
- **Peer Hydration:** Gossip and peer exchange protocols continually refresh the registry and surface newly observed peers.
- **Content Transport:** Chunk protocol with IndexedDB manifests plus AES-GCM/ECDH encrypted blobs coordinated by the replication orchestrator.
- **Observability:** Diagnostics feed, node metrics, and UI status components expose rendezvous health, beacon latency, and connection quality.

These capabilities are live in production per the stabilization report and form the baseline for the roadmap below.

---

## 2. Delivered Foundations

| Capability | Status | Notes |
|------------|--------|-------|
| Ed25519 presence tickets & automatic mesh toggles | ✅ Complete | `rendezvousIdentity.ts`, `presenceTicket.ts`, and `manager.ts` handle key management and mesh activation. |
| Beacon announce / fetch pipeline | ✅ Complete | `bootstrap.ts` integrates with the Cloudflare Durable Object beacon for signed ticket exchange. |
| Static capsule publishing + verification | ✅ Complete | Capsules aggregate beacon responses and ship detached signatures validated by the client. |
| Peer exchange (PEX) + gossip loop | ✅ Complete | Epidemic peer sharing keeps the mesh hydrated between rendezvous refreshes. |
| Replication orchestrator | ✅ Complete | Redundancy targets enforced with replica advertisements and chunk backfill. |
| Connection health & sovereignty controls | ✅ Complete | Auto-reconnect, manual peer approval queue, and mesh pause/isolation toggles wired into context + UI. |
| Diagnostics surfaced in UI | ✅ Complete | Status indicator and connected peers panel show rendezvous failures, latency, and degradation badges. |

---

## 3. Gaps & Risks

1. **Beacon integration coverage** – Miniflare tests for TTL pruning, rate limiting, and failure handling remain outstanding.
2. **Content authenticity** – Posts and file manifests still need Ed25519-backed signing/verification to prevent tampering.
3. **Identity recovery** – Distributed key backup (e.g., Shamir secret sharing) has not been implemented, leaving a single point of failure.
4. **Observability automation** – Capsule publishing lacks alerting for repeated failures, slowing incident response.
5. **Advanced topology research** – Supernode election, DHT routing, offline sync queues, and alternative transports (WebTorrent, GUN.js) are unproven.
6. **UI control debt** – Dashboard experience, persistent block lists, and graceful disconnect flows need to catch up with backend resilience.

---

## 4. Roadmap & Phased Delivery

### Phase 0 — Node Dashboard Launch

**Objective:** Deliver a comprehensive dashboard surfaced from the P2P networking tab.

**Scope:**
- Add a "View Node Dashboard" entry to the networking.
- Build dashboard panels for signaling endpoint, rendezvous mesh state, and mesh controls (enable/disable mesh routing, refresh peers).
- Expose user node controls (block node/user, pause inbound/outbound connections) and network toggles (enable/disable P2P network).
- Visualize bandwidth, latency, packet loss, connection strength, last handshake time, and active peer list.
- Provide affordances for diagnostics/log streams and node health indicators when available.

**Tasks:**
- Add “View Node Dashboard” button to the P2P networking tab.
- Design the Node Dashboard UI to include:
  - **Signaling Endpoint**: Display current signaling server details.
  - **Rendezvous Mesh**: Show mesh topology and peer discovery status.
  - **Mesh Controls**: Enable/disable mesh routing, refresh peers.
  - **User Node Controls**:
    - Block node/user
    - Pause incoming/outgoing connections
  - **Networking Stats**: Bandwidth usage, latency, packet loss.
  - **Connection Lists**: Active peers, connection strength, last handshake.
  - **Enable/Disable P2P Network**: Toggle full P2P functionality.
  - *(Optional)* Add diagnostics, logs, and node health indicators.

**P2P Networking Tab Updates:**
- Retain:
  - Enable/Disable toggle
  - Network Stats summary
  - Connection Strength indicator
  - View Node Dashboard button


**Exit Criteria:** Dashboard reflects real-time metrics from the stabilization stack and mirrors manual controls already available in context.

### Phase 1 — Control Hardening & Observability Automation

**Objective:** Ensure operators can reliably shape traffic and receive immediate signals when the mesh degrades.

**Scope:**
- Upgrade blocking to support node ID and user ID targeting with a persistent, manageable block list UI.
- Implement a "Stop Signaling" control for temporarily halting rendezvous participation during incidents.
- Guarantee a robust disconnect flow with graceful teardown, state cleanup, and automatic recovery for unstable links.
- Add confirmation prompts/rollback paths so controls succeed even under degraded connectivity.
- Ship Miniflare-based beacon integration tests and wire them into CI.
- Instrument capsule publishing with alert hooks (e.g., PagerDuty/Webhook) to notify on repeated failure streaks.

**Exit Criteria:** Operators can isolate or restore nodes confidently, and observability stack raises actionable alerts without manual polling.

### Phase 2 — Trust, Security & Resilience Enhancements

**Objective:** Protect data integrity and user identity while strengthening recovery paths.

**Scope:**
- Implement Ed25519 content signing for posts/files with verification hooks that fail closed on invalid payloads.
- Introduce Shamir secret-sharing backups for identity keys with secure shard exchange over existing channels.
- Extend dashboard to surface signing status, backup health, and replication redundancy levels.
- Evaluate and draft implementation plans for WebTorrent and GUN.js integrations, defining compatibility layers, data flow, performance benchmarks, and security guardrails.

**Exit Criteria:** Content authenticity and identity recovery meet resilience goals, and future transport enhancements have actionable designs.

### Phase 3 — Advanced Swarm Intelligence & Offline Continuity

**Objective:** Expand network robustness for large-scale growth and intermittent connectivity.

**Scope:**
- Prototype supernode election and DHT-style routing strategies once telemetry validates mesh stability.
- Build offline-first authoring with background reconciliation queues so contributors can work without connectivity.
- Pilot alternative transport backends (WebTorrent, GUN.js) in controlled environments based on Phase 2 findings.
- Reassess rendezvous parameters (ticket TTL, beacon scaling) using insights from metrics and dashboard usage.

**Exit Criteria:** Network maintains resilience under scale tests, and offline/alternative-path capabilities are validated for future rollout.

---

## 5. Success Metrics & Checkpoints

- **Dashboard Adoption:** Percentage of active caretakers using the Node Dashboard weekly and average time-to-diagnose incidents.
- **Control Reliability:** Mean time to isolate a misbehaving node; rate of successful disconnect/rollback operations.
- **Mesh Health:** Rendezvous success rate, beacon latency percentiles, capsule publishing success streaks.
- **Data Integrity:** Percentage of content served with valid signatures; recovery success rate for secret-sharing restores.
- **Resilience Experiments:** Completion of WebTorrent/GUN.js proofs, DHT prototype benchmarks, and offline sync pilot participation.

Regularly review these metrics during release readiness reviews and update this plan as capabilities graduate from backlog to production.

---

## 6. Phase 0 Implementation Kickoff

Execution for the Node Dashboard is now in motion. The first implementation sprint focuses on surfacing reliable telemetry from the existing P2P stack and delivering the dashboard shell so operators can start exercising controls while deeper automation lands.

### 6.1 Sprint 0A — Telemetry Plumbing & Shell UI (target: 2025-11-21)

- [x] **Expose consolidated node metrics for UI consumption.**
  - [x] Extend `src/contexts/P2PContext.tsx` with selectors that aggregate data from `src/lib/p2p/nodeMetrics.ts`, `connectionHealth.ts`, and `manager.ts`.
  - [x] Publish a dedicated hook (`src/hooks/useNodeDashboard.ts`) that returns the metrics bundle required by the dashboard (signaling endpoints, rendezvous state, peer counts, packet statistics, and recent handshake timestamps).
  - [x] Add Vitest coverage around the hook to validate fallback behaviour when mesh routing is paused or the diagnostics feed is unavailable.
- [x] **Scaffold the Node Dashboard route and layout.**
  - [x] Create `src/pages/NodeDashboard.tsx` with a responsive grid housing signaling, mesh state, connection health, and peer inventory panels.
  - [x] Reuse existing components where possible (`P2PStatusIndicator`, `ConnectedPeersPanel`, `PeerConnectionManager`) and wrap new visualizations under `src/components/p2p/dashboard/` to keep separation clear.
  - [x] Include placeholder empty states so the dashboard renders safely before all metrics land.
- [x] **Add navigation and entry points.**
  - [x] Update the networking tab UI (primarily `src/components/p2p/P2PDebugPanel.tsx` and related menu triggers) with a "View Node Dashboard" link that routes to the new page without removing existing toggles.
  - [x] Expose a context action on `P2PContext` to open the dashboard programmatically, enabling future toasts/alerts to deep link caretakers directly.
- [x] **Document operator runbook scenarios.**
  - [x] Draft a quick-start QA checklist in `docs/manual-qa/p2p-node-dashboard.md` covering dashboard load, mesh toggle, block list mutation, and diagnostics viewing.
  - [x] Capture log streaming expectations (e.g., expected events in the diagnostics feed when the mesh toggles) so the control team can validate behaviour while the automation hooks are still pending.

### 6.2 Dependencies & Coordination Notes

- **Design alignment:** Validate dashboard layout with the design system before component implementation to ensure consistency with existing admin surfaces.
- **Security review:** Schedule a review of the new navigation surfaces to confirm block/pause controls do not bypass existing confirmation flows defined in `src/components/moderation`.
- **Data contract:** Track any changes to `nodeMetrics.ts` or `diagnostics.ts` in the implementation log below so API consumers stay aware of shape adjustments.

### 6.3 Implementation Log

- **2025-11-07:** Sprint 0A initiated. Documentation updated with task breakdown, new hook contract, and navigation strategy to unblock engineering kickoff.

** All plans must aliagn with base UI and conceptual idea


## Base UI / Conceptual
## 🧭 Node Dashboard & Stability Improvements — Project Plan

### 📍 Phase 0: Node Dashboard Implementation
**Objective:** Create a comprehensive Node Dashboard accessible from the P2P networking tab.
**Tasks:**
- Add “View Node Dashboard” button to the P2P networking tab.
- Design the Node Dashboard UI to include:
  - **Signaling Endpoint**: Display current signaling server details.
  - **Rendezvous Mesh**: Show mesh topology and peer discovery status.
  - **Mesh Controls**: Enable/disable mesh routing, refresh peers.
  - **User Node Controls**:
    - Block node/user
    - Pause incoming/outgoing connections
  - **Networking Stats**: Bandwidth usage, latency, packet loss.
  - **Connection Lists**: Active peers, connection strength, last handshake.
  - **Enable/Disable P2P Network**: Toggle full P2P functionality.
  - *(Optional)* Add diagnostics, logs, and node health indicators.

**P2P Networking Tab Updates:**
- Retain:
  - Enable/Disable toggle
  - Network Stats summary
  - Connection Strength indicator
  - View Node Dashboard button


### 🛡️ Phase 1: Robust User & Network Controls
**Objective:** Strengthen control mechanisms for users and network stability.

**Tasks:**
- Enhance blocking functionality:
  - Block by node ID or user ID
  - Persistent block list with UI management
- Add “Stop Signaling” feature:
  - Temporarily halt signaling to reduce noise or isolate issues
- Prioritize control responsiveness and fail-safes:
  - Ensure controls work even under degraded network conditions
  - Add confirmation prompts and rollback options

---

### 🔗 Phase 2: Resilience Enhancements via WebTorrent & GUN.js
**Objective:** Evaluate and integrate decentralized technologies to improve connectivity and fault tolerance.

**Tasks:**
- Review `Resilience.md` for current architecture and failure modes.
- Create a technical proposal to integrate:
  - **WebTorrent**: For peer-to-peer file sharing and fallback transport.
  - **GUN.js**: For decentralized data sync and mesh resilience.
- Define integration boundaries:
  - These tools will **enhance**, not replace, existing systems.
- Draft implementation roadmap:
  - Compatibility layer
  - Data flow mapping
  - Performance benchmarks
  - Security considerations

---
