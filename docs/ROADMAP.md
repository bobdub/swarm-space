# Imagination Network – Roadmap

_Last reviewed: 2024-11-02_

This roadmap tracks major delivery themes by phase. Consult `docs/COURSE_OF_ACTION.md` for sprint-level detail.

---

## Phase 0 – Foundation ✅ Complete
- React 18 + Vite + Tailwind scaffold with shadcn primitives.
- IndexedDB v6 wrapper (`src/lib/store.ts`) and domain schemas for posts, projects, users, tasks, milestones, credits, and connections.
- Crypto utilities (`src/lib/crypto.ts`) for ECDH key generation, AES-GCM wrapping, and SHA-256 hashing.
- Navigation shell, theme, layout primitives, and Toast/Tooltip providers.

---

## Phase 1 – Content Creation & Management 🚧 Active
**Goal:** Deliver a rich offline-first authoring experience.

### Shipped
- File chunking + encryption pipeline (`src/lib/fileEncryption.ts`).
- Create flow with manifest attachments (`src/pages/Create.tsx`).
- Files locker with preview/download (`src/pages/Files.tsx`).
- Project-scoped posting and asset storage hooks (`src/lib/projects.ts`).

### Remaining
- Post preview before publish and edit surface.
- Feed filtering (All / Images / Videos / Links) + pagination (`src/pages/Index.tsx`).
- Local trending signal (credits + reactions) feeding Explore + feed sort order.

---

## Phase 2 – Planner & Task System ✅ Complete
**Goal:** Provide collaborative planning tools that work fully offline.

- Calendar + milestone management (`src/pages/Planner.tsx`, `src/lib/milestones.ts`).
- Kanban board with drag-and-drop (`src/components/TaskBoard.tsx`).
- Task CRUD, assignment, and due dates (`src/lib/tasks.ts`).
- Credits and notifications integration for task updates.
- Deferred: change queue + conflict detection (will ride with Phase 5 revisits).

---

## Phase 3 – Profiles & Social 🚀 Active
**Goal:** Make it easy to discover people and interact with their work.

### Shipped
- Profile pages + editor (`src/pages/Profile.tsx`, `src/components/ProfileEditor.tsx`).
- Commenting, reactions, hype credits, and notifications (`src/components/PostCard.tsx`, `src/lib/interactions.ts`, `src/lib/credits.ts`).
- Credit balances, transfers, and history modals.
- Peer connection manager (manual connect/disconnect).

### Remaining
- Fix comment query/indexing bug (scope to post ID) before scaling content.
- Build user discovery + trending tiles in Explore (`src/pages/Explore.tsx`).
- Follow graph, recommendations, and moderation primitives (block/report).

---

## Phase 4 – Group Encryption 🔐 Planned
**Goal:** Secure project collaboration beyond single-user storage.

- Project key generation and rotation.
- Member invitation flow with per-user key wrapping.
- Shared manifest encryption + access control policies.
- Project audit log for key events.

---

## Phase 5 – Peer-to-Peer Networking ✅ Core Delivered / Enhancements Planned
**Goal:** Seamless peer discovery, synchronization, and bandwidth sharing.

### Shipped
- PeerJS adapter + connection lifecycle (`src/lib/p2p/peerjs-adapter.ts`).
- Chunk distribution protocol + post broadcast (`src/lib/p2p/chunkProtocol.ts`, `src/lib/p2p/postSync.ts`).
- Rendezvous mesh toggle, room discovery, and gossip (`src/lib/p2p/manager.ts`).
- Peer connection manager UI (`src/components/PeerConnectionManager.tsx`).

### In Progress
- Connection requests/approvals, blocking, and presence states.
- Rendezvous health telemetry + Ed25519 fallback messaging.
- Diagnostics counters (failed dials, retries, bytes served) surfaced in UI.
- Self-hosted signalling documentation and configuration.

---

## Phase 6 – Advanced Features 🌅 Planned
**Goal:** Polish, scale, and extend the experience across devices.

- Performance: virtualized feeds, workerized crypto, query caching.
- Multi-device sync (CRDT or vector clock change log) + optional relay service.
- Desktop (Tauri/Electron) and mobile PWA optimization.
- Accessibility audit and improvements.
- Achievement/QCM systems revisited once moderation + telemetry are stable.

---

## Cross-Cutting Initiatives
- **Data safety:** Backup reminders, quota warnings, IndexedDB migration tests.
- **Documentation hygiene:** Keep `README.md`, `docs/STATUS.md`, and this roadmap aligned with `docs/COURSE_OF_ACTION.md`.
- **Observability:** Expand logging/toast coverage for crypto, storage, and P2P failures.

