# Imagination Network — Unified Source of Truth (Flux v0.005)

_Last updated: 2025-11-02_

> **⚠️ Important**: This document is now **complemented** by [`PROJECT_OVERVIEW.md`](PROJECT_OVERVIEW.md), which provides a more accessible current-state snapshot. Use this doc for **deep technical reference**, PROJECT_OVERVIEW for **quick orientation**.

This document is the canonical reference for developers, contributors, and AI agents maintaining the Imagination Network. It fuses the strategic platform overview with the mesh-network whitepaper to provide a single, cohesive guide to product vision, technical architecture, cryptography, and operational practice.

## Table of Contents
1. [Mission & Experience Pillars](#mission--experience-pillars)
2. [Mesh Architecture & Flux Principles](#mesh-architecture--flux-principles)
3. [Frontend Application Architecture](#frontend-application-architecture)
4. [Persistence & Domain Data](#persistence--domain-data)
5. [Security, Keys, & Privacy](#security-keys--privacy)
6. [P2P Networking & Sync](#p2p-networking--sync)
7. [Credits, Achievements & Economy](#credits-achievements--economy)
8. [User Journey Summary](#user-journey-summary)
9. [Operations & Tooling](#operations--tooling)
10. [Quick Reference Index](#quick-reference-index)
11. [Guiding Principles & Conclusion](#guiding-principles--conclusion)

## Mission & Experience Pillars
- **Mission** — Build a decentralized, offline-first collaboration and social network where contributors own their identities, data, and distribution. Narrative guardrails live in [`README.md`](../README.md) with deeper vision dossiers in [`docs/Goals.md`](Goals.md).
- **Primary Personas** — Creators, distributed project teams, and communities needing local-first authoring with optional peer sync. Persona targets and status are tracked in [`docs/STATUS.md`](STATUS.md), [`docs/COURSE_OF_ACTION.md`](COURSE_OF_ACTION.md), and [`docs/ROADMAP.md`](ROADMAP.md).
- **Experience Surfaces** — The React router maps feature areas to dedicated pages within [`src/pages/`](../src/pages). Core journeys include the landing feed (`Index.tsx`, `Explore.tsx`), collaboration utilities (`Files.tsx`, `Planner.tsx`, `Tasks.tsx`, `ProjectDetail.tsx`), profiles (`Profile.tsx`), global creation flows (`Create.tsx`), and notifications (`Notifications.tsx`).

## Mesh Architecture & Flux Principles
The Source of Truth for mesh operations emphasizes Creative Flux values: adaptability, resilience, and user-first design.

### Node Mesh & Deterministic Phonebooks
- **Bootstrap Requirements** — At least two peers must be online for mesh formation.
- **Deterministic Phonebooks** — Store hashed peer IDs, public keys, connection hints, project memberships, and last-seen timestamps to enable privacy-preserving discovery.
- **Sync & Validation** — Gossip protocols with cryptographic validation ensure canonical state. Versioned snapshots support large-scale recovery and offline peers.

### Project & Group Nodes
- **Project Nodes** — Maintain membership, project state, encrypted data chunks, and deterministic phonebooks.
- **Group Nodes** — Emergent redundancy clusters that resolve conflicts deterministically to maintain mesh integrity.
- **Lifecycle** — create → join → sync → evolve/archive.

### Deterministic Merges & Flux Behavior
- Conflicts resolve via lexicographic ordering plus timestamps, with optional contributor weighting.
- Partial data reconstruction supports offline-first recovery and queued syncs.
- Flux-aware operations respect node sovereignty: toggles such as Project-Only, Pause, or I Accept influence participation.

### Auto-Connect (Peer-Triggered v3)
1. **Peer-Triggered Phonebooks** — When two users connect via unrestricted peer IDs, a deterministic phonebook is generated, enabling broader auto-connect without sharing IDs directly.
2. **Precondition** — Auto-connect activates only when ≥2 eligible peers are online.
3. **Connection Logic** — Nodes scan phonebooks, queue chunks for offline peers, and rely on deterministic merges to preserve canonical state.
4. **Toggle Integration** — Auto-Connect honors user toggles. Manual restrictions (Project-Only, Pause, I Accept) suspend auto-join automatically.
5. **Security & Privacy** — Hashed phonebooks plus cryptographic handshakes protect identity while enabling optional participation.

## Frontend Application Architecture
- **Runtime Stack** — Vite + React 18 + TypeScript with Tailwind and shadcn UI primitives. Dependencies: [`package.json`](../package.json); design tokens: [`tailwind.config.ts`](../tailwind.config.ts).
- **Boot Sequence** — [`src/main.tsx`](../src/main.tsx) hydrates the root. [`src/App.tsx`](../src/App.tsx) wires React Router, `P2PProvider`, Radix providers, and React Query.
- **State & Data Fetching** — React Query orchestrates async state; hooks in [`src/hooks/`](../src/hooks) cover authentication (`useAuth`), credit balances (`useCreditBalance`), responsive layout (`use-mobile`), toast notifications (`use-toast`), and peer networking (`useP2P`).
- **UI Composition** — Shared primitives reside in [`src/components/ui`](../src/components/ui), while domain widgets for navigation, credits, peer management, and modals live in [`src/components`](../src/components). Shadcn patterns ensure consistent motion, theming, and form behavior.
- **Domain Services** — Modules under [`src/lib/`](../src/lib) encapsulate authentication, crypto, storage, credits, notifications, P2P coordination, search, and task orchestration.

## Persistence & Domain Data
- **IndexedDB Layer** — [`src/lib/store.ts`](../src/lib/store.ts) exposes the v6 IndexedDB wrapper that provisions stores for chunks, manifests, posts, projects, users, comments, notifications, tasks, milestones, credit balances/transactions, and peer connection records.
- **Domain Types** — [`src/types/index.ts`](../src/types/index.ts) defines canonical interfaces for users, posts, comments, projects, milestones, tasks, and credit records.
- **Posts & Projects** — CRUD utilities: [`src/lib/interactions.ts`](../src/lib/interactions.ts) for posts; [`src/lib/projects.ts`](../src/lib/projects.ts), [`src/lib/tasks.ts`](../src/lib/tasks.ts), and [`src/lib/milestones.ts`](../src/lib/milestones.ts) for project and task flows.
- **Metadata & Search** — [`src/lib/search.ts`](../src/lib/search.ts) indexes posts/projects; [`src/lib/notifications.ts`](../src/lib/notifications.ts) coordinates alerts and sync messaging.

## Security, Keys, & Privacy
- **Identity Lifecycle** — [`src/lib/auth.ts`](../src/lib/auth.ts) manages local identity provisioning, passphrase handling, key wrapping, and persistence; surfaced through [`src/hooks/useAuth.ts`](../src/hooks/useAuth.ts).
- **Key Material & Primitives** — [`src/lib/crypto.ts`](../src/lib/crypto.ts) centralizes ECDH key generation, PBKDF2-SHA256 derivation, and AES-GCM helpers.
- **File Encryption Pipeline** — [`src/lib/fileEncryption.ts`](../src/lib/fileEncryption.ts) chunk-encrypts files with 64 KB slices, per-chunk IVs, SHA-256 references, and manifest persistence. UI flows include `FileUpload.tsx`, `FilePreview.tsx`, and `Files.tsx`.
- **Private Key Stewardship** — Users control private keys; they are never stored raw. Keys enable multi-device transfer, recovery, and account verification. Handshakes leverage public keys with temporary bootstrap tokens for offline-first transfers.
- **Recovery & Delegation** — Mesh recovery requires active peers retaining hashed private key records. Deterministic merges reconstruct data and resync credits, achievements, and project states. Optional ephemeral delegation supports secure recovery without compromising sovereignty.
- **Operational Guardrails** — Procedural guidance is expanded in [`docs/ARCHITECTURE.md`](ARCHITECTURE.md), [`docs/Stable-Node.md`](Stable-Node.md), and [`docs/Private-Key.md`](Private-Key.md).

## P2P Networking & Sync
- **Core Manager** — [`src/lib/p2p/manager.ts`](../src/lib/p2p/manager.ts) coordinates PeerJS signaling, WebRTC data channels, rendezvous mesh toggles, and chunk replication metrics. Companion utilities include `peerjs-adapter.ts`, `chunkProtocol.ts`, `discovery.ts`, and `rendezvousConfig.ts`.
- **React Context Layer** — [`src/contexts/P2PContext.tsx`](../src/contexts/P2PContext.tsx) exposes networking state and controls to the UI. [`src/hooks/useP2P.ts`](../src/hooks/useP2P.ts) bridges the manager and interface components.
- **User Controls** — Components such as `PeerConnectionManager.tsx`, `ConnectedPeersPanel.tsx`, and the Wi-Fi toggle in `TopNavigationBar.tsx` expose mesh control surfaces.
- **Service Utilities** — A rendezvous beacon prototype operates from [`services/rendezvous-beacon/`](../services/rendezvous-beacon) for custom signaling migration off public PeerJS infrastructure.
- **Strategic Plans** — Deep design references live in [`docs/P2P_SWARM_STABILIZATION_PLAN.md`](P2P_SWARM_STABILIZATION_PLAN.md) and [`docs/P2P_RENDEZVOUS_MESH_PLAN.md`](P2P_RENDEZVOUS_MESH_PLAN.md).
- **Security Layers** — Hashing peer IDs and memberships, chunk-level encryption, and salting defend against replay attacks while sustaining deterministic merges.
- **User Toggles & Sovereignty** —
  - **I Accept** — Manual peer approval; incoming requests queue until explicit approval.
  - **Pause** — Temporarily halts gossip/sync; resumes on reactivation.
  - **Isolate** — Restricts sync to project members, forming sub-meshes.
  - **Auto-Connect** — Automatically joins the mesh when conditions permit, disabled by manual restrictions.

## Credits, Achievements & Economy
- **Credits Engine** — [`src/lib/credits.ts`](../src/lib/credits.ts) defines rewards, Zod validation, transfer limits, hype burns, hosting payouts, and balance updates, using `store.ts` for persistence and `auth.ts` for identity.
- **UI Surfaces** — Credits dashboards and interactions appear in `CreditHistory.tsx`, `SendCreditsModal.tsx`, profile badge stacks (`Profile.tsx`), and navigation counters (`TopNavigationBar.tsx`).
- **Earning & Verification** — Credits accrue for uptime, hosting, contributions, and peer support. They remain verifiable across peers with optional decay for inactive periods while preserving sovereignty.
- **Achievements** — Linked to milestones, contribution thresholds, and credit activity. Flux-aware tracking adapts to peer availability and sync cadence. The currently shipped badge roster and QCM wiring live in [`docs/Achievement-Goalpost.md`](Achievement-Goalpost.md).
- **Status Tracking** — Implementation milestones and outstanding work are cataloged in [`docs/CREDITS_PHASE_6.1_STATUS.md`](CREDITS_PHASE_6.1_STATUS.md) plus broader planning documents (`STATUS.md`, `COURSE_OF_ACTION.md`).
- **Phase 6.1 QA Focus** — Manual testing uncovered regressions (genesis reward tuning, cross-profile balance visibility, self-transfer guard). Follow the remediation plan in [`docs/CREDITS_PHASE_6.1_STATUS.md`](CREDITS_PHASE_6.1_STATUS.md#-plan-of-action-unified-alignment) and update this section once those items ship.

## User Journey Summary
| Step | Action | Key/Tooling | Mesh Requirement | Flux Notes |
| --- | --- | --- | --- | --- |
| Account Creation | Generate profile | Private key | — | User retains full key custody |
| Project Creation | Spawn project node | — | ≥2 peers | Forms collaborative sub-mesh |
| Multi-Device Transfer | Move `localData` | Public + Private keys | First local node online | Temporary mesh bootstrap with queued chunks |
| Data Recovery | Restore from mesh | Public + Private keys | Active nodes with hashed key records | Partial consensus allowed; deterministic merges reconstruct state |
| Mesh Security | Approvals / pause / isolate | User toggles | N/A | Node sovereignty; adaptive behavior |
| Credits & Achievements | Earn & verify | — | Active peers sync | Flux-aware validation and distribution |
| Auto-Connect | Join mesh automatically | User toggles | ≥2 peers, Auto-Connect ON | Peer-triggered phonebooks respect manual restrictions |

## Operations & Tooling
- **Local Development** — Run `npm install` then `npm run dev` (Vite default port 5173). Equivalent Bun commands are documented in [`README.md`](../README.md#quick-start).
- **Deployment Guidance** — [`docs/DEPLOYMENT_PLAN.md`](DEPLOYMENT_PLAN.md) outlines staging→production flows; [`docs/Stable-Node.md`](Stable-Node.md) covers long-lived peer nodes. Contributor credits and training updates are in [`docs/TRAINING_UPDATES.md`](TRAINING_UPDATES.md).
- **Configuration & Linting** — Tailwind, TypeScript, and Vite configuration live at the repo root (`tailwind.config.ts`, `tsconfig*.json`, `vite.config.ts`). ESLint rules consolidate in [`eslint.config.js`](../eslint.config.js).

## Quick Reference Index
| Domain | Primary Documentation | Anchor Code Modules |
| --- | --- | --- |
| Product & Vision | `README.md`, `docs/Goals.md`, `docs/ROADMAP.md` | `src/pages/Index.tsx`, `src/pages/Explore.tsx`, `src/components/FeatureHighlights.tsx` |
| Security & Crypto | `docs/ARCHITECTURE.md`, `docs/Stable-Node.md`, `docs/Private-Key.md` | `src/lib/auth.ts`, `src/lib/crypto.ts`, `src/lib/fileEncryption.ts` |
| P2P Networking | `docs/P2P_SWARM_STABILIZATION_PLAN.md`, `docs/P2P_RENDEZVOUS_MESH_PLAN.md` | `src/lib/p2p/*`, `src/contexts/P2PContext.tsx`, `src/components/PeerConnectionManager.tsx` |
| Credits Economy | `docs/CREDITS_PHASE_6.1_STATUS.md`, `docs/STATUS.md`, `docs/COURSE_OF_ACTION.md` | `src/lib/credits.ts`, `src/components/CreditHistory.tsx`, `src/components/SendCreditsModal.tsx` |
| Projects & Tasks | `docs/STATUS.md`, `docs/Goals.md`, `docs/COURSE_OF_ACTION.md` | `src/lib/projects.ts`, `src/lib/tasks.ts`, `src/lib/milestones.ts`, `src/pages/ProjectDetail.tsx` |
| Operations | `docs/DEPLOYMENT_PLAN.md`, `docs/Stable-Node.md`, `docs/TRAINING_UPDATES.md` | `ops/` scripts, `services/rendezvous-beacon/`, configuration files (`tailwind.config.ts`, `vite.config.ts`) |

## Guiding Principles & Conclusion
- **Decentralization-first** — The network evolves without centralized servers or databases.
- **User Sovereignty** — Private keys, toggles, and project participation remain entirely under user control.
- **Creative Flux** — Operations are adaptive, resilient, and iterative; failures inform evolution.
- **Deterministic yet Flexible** — Merges and peer validation maintain canonical state while respecting variability.
- **Human + AI Collaboration** — Collective stewardship keeps the mesh living and evolving.
- **Conflict Resolution** — When ambiguity remains, default to the most user-forward, decentralized path.

> Maintain this unified document whenever features move directories, new capability pillars are added, or mesh procedures evolve. It is intended to be the single, accurate map of the system.
