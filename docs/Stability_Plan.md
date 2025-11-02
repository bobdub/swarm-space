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

**Current Evaluation (Nov 2025 build):**
- ✅ Navigation surface and dashboard shell ship via `NodeDashboard.tsx`, `MeshControlsPanel`, `ConnectionHealthPanel`, and `PeerInventoryPanel`.
- ⚠️ User node controls are limited to mesh toggles and global pause/isolation switches; there is no direct block/unblock management panel in the dashboard.
- ⚠️ Packet loss, inbound/outbound bandwidth separation, and explicit connection strength visualization are absent. RTT and byte counters exist, but we lack normalized strength bars and failure streak surfacing.
- ⚠️ Diagnostics/log streaming affordances appear only within `P2PDebugPanel` rather than the dashboard entry point. Deep links are possible via `openNodeDashboard`, but no log surface is embedded.
- ✅ Signaling endpoint status, rendezvous metrics, peer list, and health summaries map to live telemetry returned from `useNodeDashboard`.

**Scope Updates:**
- Add a "View Node Dashboard" entry to the networking tab **and** ensure breadcrumbs/deep links (`openNodeDashboard`) open the dashboard route.
- Build dashboard panels for signaling endpoint, rendezvous mesh state, and mesh controls (enable/disable mesh routing, refresh peers) **with explicit empty-state copy and degraded badges**.
- Expose user node controls in-dash:
  - Block/unblock node IDs with inline context about the effect on auto-connect.
  - Stage UI affordances for user-level blocks (even if the backend path lands in Phase 1).
  - Pause incoming/outgoing connections independently (requires separate control flags and UI toggles).
- Visualize networking stats beyond aggregate bytes:
  - Render bandwidth gauges (upload/download rolling averages) and packet loss percentages pulled from `connectionHealth.summary`.
  - Display connection strength via color-coded indicators derived from healthy/degraded ratios and handshake freshness.
- Provide a diagnostics/logs drawer anchored to the dashboard so caretakers can inspect recent events without returning to the debug panel.
- Maintain lightweight loading and disabled states to accommodate mesh-offline contexts.

**Task Breakdown:**
1. **Navigation & Layout**
   - Add `View Node Dashboard` CTA to the networking tab (already landed) and implement `openNodeDashboard` linking from toast/alerts.
   - Supply breadcrumb + `ArrowLeft` back affordance for contextual navigation.
2. **Telemetry Surfaces**
   - Extend `useNodeDashboard` to expose packet loss, upload/download rates, and handshake confidence scores.
   - Map these metrics into `NodeStatusOverview` cards with accessible formatting and tooltips.
3. **Mesh Controls & Node Actions**
   - Split pause controls into `pauseInbound` / `pauseOutbound` flags while preserving global isolation.
   - Add an inline block management table (block, unblock, show status, reference user display names when available).
4. **Diagnostics Drawer**
   - Embed a collapsible diagnostics stream component consuming `diagnostics` from context with filters consistent with `P2PDebugPanel`.
   - Surface last 25 events and provide a button to open full diagnostics in a new tab.
5. **Empty/Offline States**
   - Author copy and placeholder illustrations for offline, mesh-disabled, and zero-peer states so the dashboard remains informative before data arrives.

**P2P Networking Tab Updates:**
- Retain the enable/disable toggle, stats summary, and connection strength indicator.
- Promote the `View Node Dashboard` action to primary once the dashboard houses block management and diagnostics.

**Exit Criteria:**
- Dashboard reflects real-time metrics from the stabilization stack, includes inline block management and diagnostics drawer, and offers separate inbound/outbound pause controls.
- Accessibility review confirms keyboard/screen-reader coverage for all interactive elements.

### Phase 1 — Control Hardening & Observability Automation

**Objective:** Ensure operators can reliably shape traffic and receive immediate signals when the mesh degrades.

**Gap Audit:**
- Blocking only recognizes peer IDs and stores them in-memory; there is no persistence layer, user-centric targeting, or UI for editing metadata.
- There is no explicit “stop signaling” control — caretakers disable the rendezvous mesh entirely, which still leaves background timers active.
- Disconnect flows rely on PeerJS default behaviour with minimal state reconciliation; retries can leave stale peers listed.
- Confirmation/rollback paths are missing. Current toggles apply immediately and fail silently when connectivity is degraded.
- Miniflare coverage for durable object beacons and TTL pruning is not wired into CI.
- Capsule publishing emits diagnostics but does not escalate via alerting hooks.

**Scope (Revised):**
1. **Persistent Block Management**
   - Extend `P2PControlState` to support block targets keyed by node ID and user ID with IndexedDB persistence.
   - Create `BlockedEntitiesPanel` (dashboard + networking tab) enabling caretakers to add/remove entries, annotate reasons, and filter by type.
   - Ensure auto-connect, gossip intake, and peer approval flows respect both node- and user-level blocks.
2. **Signaling Pause / Stop Controls**
   - Implement a `stopSignaling` action that halts beacon polls, capsule fetches, and presence ticket broadcasts while keeping existing connections alive.
   - Provide UI toggles with confirmation prompts and tooltips describing impact, plus automatic rollback timers for safety.
3. **Graceful Disconnect Orchestration**
   - Introduce an explicit `disconnectPeer` routine that flushes replication queues, stops chunk transfers, and clears diagnostics markers.
   - Display progress + result states in the dashboard when caretakers terminate a link.
4. **Resilient Control UX**
   - Wrap destructive toggles (block, stop signaling, isolate) in confirmation modals referencing the targeted peer/user.
   - Add toast + banner feedback that captures failures and suggests follow-up actions.
   - Cache pending control mutations so that, if the network drops mid-flight, UI prompts caretakers to retry or roll back.
5. **Automated Observability**
   - Author Miniflare suites covering beacon TTL pruning, rate limiting, and degraded responses; gate merges on these tests in CI.
   - Instrument capsule publishing with retry counters + webhook integrations (PagerDuty/Webhook) triggered after configurable failure streaks.
   - Surface alert configuration status within the dashboard diagnostics drawer.

**Exit Criteria:**
- Block list persists across sessions, handles node/user IDs, and is manageable entirely from the dashboard.
- Operators can halt signaling independently from mesh routing and receive confirmation/rollback prompts for every disruptive action.
- Disconnects clear stale state and emit success/failure telemetry visible in diagnostics.
- CI runs Miniflare suites; alert hooks fire on capsule publishing failures and are summarized in the UI.

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
## 🧭 Node Dashboard & Stability Improvements — Conceptual Snapshot

### 📍 Phase 0: Node Dashboard Implementation
**Experience Goals**
- Provide a single-pane view of node health that mirrors the mental model of caretakers (status → controls → peer inventory).
- Keep the networking tab lightweight while advertising richer controls in the dashboard.

**Core UI Frames**
1. **Overview strip** — status badge, peer ID, uptime, signaling endpoint. Pull metrics from `useNodeDashboard.metrics`.
2. **Mesh controls** — rendezvous toggle, refresh, inbound/outbound pause, isolation, and inline block management.
3. **Health & peers** — dual-column layout: connection health (RTT, last handshake, status badges) alongside peer inventory (discovered, pending, blocked).
4. **Diagnostics drawer** — collapsible panel at page bottom showing recent events, filters, and a deep-link to the full diagnostics view.

**Interaction Patterns**
- All toggles emit optimistic updates with toast confirmations; failures revert state and post diagnostics.
- Block/unblock actions provide inline feedback and optional annotations for why a peer was blocked.
- Empty states guide caretakers toward enabling the network or inviting peers.

**Deliverables**
- Dashboard layout + responsive behavior spec (mobile column stack, desktop 2×2 grid).
- Copy & accessibility notes (ARIA labels for switches, descriptive alt text for state icons).
- Metric dictionary mapping (uptime, bytes, packet loss, handshake age, success/failure streaks).
- Diagnostics drawer component contract (props: events[], onClear, filters).

### 🛡️ Phase 1: Robust User & Network Controls
**Experience Goals**
- Make disruptive actions (blocking, stopping signaling, disconnecting) explicit, confirmable, and reversible.
- Surface persistent policy state (block lists, alert hooks) so caretakers understand ongoing automation.

**Core UI Frames**
1. **Block list manager** — tabular view for node IDs and user IDs with filters, notes, and persistence indicators.
2. **Signaling control modal** — explains impact of stopping signaling, includes timer-based auto-resume and acknowledgement checkbox.
3. **Disconnect workflow** — inline action menu per peer with progress banner + retry/undo affordances.
4. **Alert configuration banner** — highlights webhook/PagerDuty status and recent alert events.

**Interaction Patterns**
- Confirmation dialogs before applying disruptive changes; rollback button remains visible until success telemetry is confirmed.
- Persistent storage indicator (e.g., “Synced to IndexedDB 5s ago”) assures caretakers the block list is durable.
- Observability hooks display when last Miniflare suite ran and whether alerts fired in the past 24h.

**Deliverables**
- UX copy for confirmations, error states, and alert banners.
- API contract updates for block persistence and signaling pause endpoints.
- Test plan linking UI flows to Miniflare + Vitest coverage.

These conceptual notes drive the detailed roadmap items above and should be revisited after each sprint review to ensure design intent and implementation remain aligned.

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
