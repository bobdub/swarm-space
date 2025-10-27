# Imagination Network — Total Source of Truth

This document is the single jump-off point for understanding how the Imagination Network application is put together. It summarizes the vision, maps key documentation, and links each capability to the React, storage, crypto, and peer-to-peer code that powers it.

## Table of Contents
1. [Product & Experience Pillars](#product--experience-pillars)
2. [Frontend Architecture Overview](#frontend-architecture-overview)
3. [Persistence & Domain Data](#persistence--domain-data)
4. [Security & Cryptography Model](#security--cryptography-model)
5. [P2P Networking & Sync](#p2p-networking--sync)
6. [Credits Economy](#credits-economy)
7. [Operations & Tooling](#operations--tooling)
8. [Quick Reference Index](#quick-reference-index)

## Product & Experience Pillars
- **Mission** — Build a decentralized, offline-first collaboration and social network where contributors own their identities, data, and distribution. The narrative and UX guardrails live in [`README.md`](../README.md) with deeper vision dossiers in [`docs/Goals.md`](Goals.md). The achievements concept paper (`docs/Achivement-GoalPost.md`) is aspirational and should be treated as future-facing inspiration until features land.
- **Primary Personas** — Creators, distributed project teams, and communities that need local-first authoring with optional peer sync. Phase targets and status by persona are tracked in [`docs/STATUS.md`](STATUS.md), [`docs/COURSE_OF_ACTION.md`](COURSE_OF_ACTION.md), and [`docs/ROADMAP.md`](ROADMAP.md).
- **Experience Surfaces** — The React router maps feature areas to dedicated pages within [`src/pages/`](../src/pages). Core journeys include:
  - Landing + activity feed (`Index.tsx`, `Explore.tsx`).
  - Secure file locker (`Files.tsx`), planner (`Planner.tsx`), Kanban tasks (`Tasks.tsx`), project detail (`ProjectDetail.tsx`), and profile (`Profile.tsx`).
  - Global create flow (`Create.tsx`) and notifications (`Notifications.tsx`).

## Frontend Architecture Overview
- **Runtime Stack** — Vite + React 18 + TypeScript with Tailwind for styling and the shadcn UI primitives. See [`package.json`](../package.json) for dependency specifics and [`tailwind.config.ts`](../tailwind.config.ts) for design tokens.
- **Boot Sequence** — [`src/main.tsx`](../src/main.tsx) hydrates the root, while [`src/App.tsx`](../src/App.tsx) wires React Router, the `P2PProvider`, Radix tooltip/toast providers, and React Query.
- **State & Data Fetching** — React Query drives async state; reusable hooks in [`src/hooks/`](../src/hooks) expose domains such as authentication (`useAuth`), credit balances (`useCreditBalance`), responsive design (`use-mobile`), toast notifications (`use-toast`), and peer networking (`useP2P`).
- **UI Composition** — Shared UI primitives live in [`src/components/ui`](../src/components/ui); domain widgets for navigation, credits, peer management, and modals are in [`src/components/`](../src/components). Shadcn patterns ensure consistent motion, theming, and form behavior.
- **Domain Services** — Logic modules under [`src/lib/`](../src/lib) encapsulate authentication, crypto, storage, credits, notifications, p2p coordination, search, and task orchestration. Refer to the module exports within each file for consumption patterns.

## Persistence & Domain Data
- **IndexedDB Layer** — [`src/lib/store.ts`](../src/lib/store.ts) exposes the project-wide IndexedDB v6 wrapper. It provisions object stores for chunks, manifests, posts, projects, users, comments, notifications, tasks, milestones, credit balances/transactions, and peer connection records.
- **Domain Types** — [`src/types/index.ts`](../src/types/index.ts) defines canonical interfaces for users, posts, comments, projects, milestones, tasks, and credit records. Treat these types as the schema contract between UI and storage.
- **Posts & Projects** — CRUD utilities for timeline posts live in [`src/lib/interactions.ts`](../src/lib/interactions.ts), while project/task/milestone helpers reside in [`src/lib/projects.ts`](../src/lib/projects.ts), [`src/lib/tasks.ts`](../src/lib/tasks.ts), and [`src/lib/milestones.ts`](../src/lib/milestones.ts).
- **Metadata & Search** — [`src/lib/search.ts`](../src/lib/search.ts) indexes posts and projects for local fuzzy lookup, relying on the same IndexedDB stores. Notifications are orchestrated by [`src/lib/notifications.ts`](../src/lib/notifications.ts).

## Security & Cryptography Model
- **Identity Lifecycle** — [`src/lib/auth.ts`](../src/lib/auth.ts) manages local identity provisioning and persistence. Passphrase handling, key wrapping, and session helpers are consolidated here and surfaced via [`src/hooks/useAuth.ts`](../src/hooks/useAuth.ts).
- **Key Material & Primitives** — [`src/lib/crypto.ts`](../src/lib/crypto.ts) centralizes ECDH key generation, passphrase derivation (PBKDF2-SHA256), and AES-GCM helpers for encrypting secrets prior to storage.
- **File Encryption Pipeline** — [`src/lib/fileEncryption.ts`](../src/lib/fileEncryption.ts) chunk-encrypts files with 64 KB slices, per-chunk IVs, SHA-256 refs, and manifest persistence. UI entry points (`FileUpload.tsx`, `FilePreview.tsx`, `Files.tsx`) orchestrate user flows.
- **Operational Policy** — Conceptual guardrails and procedures are documented in [`docs/ARCHITECTURE.md`](ARCHITECTURE.md), [`docs/Stable-Node.md`](Stable-Node.md), and the key custody guide [`docs/Private-Key.md`](Private-Key.md).

## P2P Networking & Sync
- **Core Manager** — [`src/lib/p2p/manager.ts`](../src/lib/p2p/manager.ts) coordinates PeerJS signaling, WebRTC data channels, rendezvous mesh toggles, and chunk replication statistics. Supporting utilities include `peerjs-adapter.ts`, `chunkProtocol.ts`, `discovery.ts`, and `rendezvousConfig.ts`.
- **React Context** — [`src/contexts/P2PContext.tsx`](../src/contexts/P2PContext.tsx) exposes networking state and control methods to the UI. Hooks like [`src/hooks/useP2P.ts`](../src/hooks/useP2P.ts) bridge the manager and components.
- **Interface Components** — User controls surface through `PeerConnectionManager.tsx`, `ConnectedPeersPanel.tsx`, and the Wi-Fi toggle in `TopNavigationBar.tsx` (all under [`src/components`](../src/components)).
- **Design References** — Strategic plans for swarm stabilization, rendezvous mesh rollout, and peer discovery are in [`docs/P2P_SWARM_STABILIZATION_PLAN.md`](P2P_SWARM_STABILIZATION_PLAN.md) and [`docs/P2P_RENDEZVOUS_MESH_PLAN.md`](P2P_RENDEZVOUS_MESH_PLAN.md).
- **Service Utilities** — A lightweight rendezvous beacon prototype lives in [`services/rendezvous-beacon/`](../services/rendezvous-beacon). Use it as a starting point for custom signaling infrastructure when migrating off the public PeerJS Cloud.

## Credits Economy
- **Business Rules** — [`src/lib/credits.ts`](../src/lib/credits.ts) defines rewards, Zod validation, transfer limits, hype burns, hosting payouts, and balance updates. It depends on `store.ts` for persistence and `auth.ts` for the current user.
- **UI Surfaces** — Credits dashboards appear in `CreditHistory.tsx`, `SendCreditsModal.tsx`, the profile badge stack (`Profile.tsx`), and navigation counters (`TopNavigationBar.tsx`).
- **Status Tracking** — Implementation milestones and outstanding work are maintained in [`docs/CREDITS_PHASE_6.1_STATUS.md`](CREDITS_PHASE_6.1_STATUS.md) with backlog alignment in [`docs/STATUS.md`](STATUS.md) and [`docs/COURSE_OF_ACTION.md`](COURSE_OF_ACTION.md).

## Operations & Tooling
- **Local Development** — Run `npm install` then `npm run dev` (Vite on port 5173). Equivalent Bun commands are documented in [`README.md`](../README.md#quick-start).
- **Deployment Guidance** — [`docs/DEPLOYMENT_PLAN.md`](DEPLOYMENT_PLAN.md) outlines staging → production flows, while [`docs/Stable-Node.md`](Stable-Node.md) covers long-lived peer nodes. Credits for contributors and training updates are tracked in [`docs/TRAINING_UPDATES.md`](TRAINING_UPDATES.md).
- **Configuration & Linting** — Tailwind, TypeScript, and Vite configuration live at the repo root (`tailwind.config.ts`, `tsconfig*.json`, `vite.config.ts`). ESLint rules are consolidated in [`eslint.config.js`](../eslint.config.js).

## Quick Reference Index
| Domain | Primary Documentation | Anchor Code Modules |
| --- | --- | --- |
| Product & Vision | `README.md`, `docs/Goals.md`, `docs/ROADMAP.md` | `src/pages/Index.tsx`, `src/pages/Explore.tsx`, `src/components/FeatureHighlights.tsx` |
| Security & Crypto | `docs/ARCHITECTURE.md`, `docs/Stable-Node.md`, `docs/Private-Key.md` | `src/lib/auth.ts`, `src/lib/crypto.ts`, `src/lib/fileEncryption.ts` |
| P2P Networking | `docs/P2P_SWARM_STABILIZATION_PLAN.md`, `docs/P2P_RENDEZVOUS_MESH_PLAN.md` | `src/lib/p2p/*`, `src/contexts/P2PContext.tsx`, `src/components/PeerConnectionManager.tsx` |
| Credits Economy | `docs/CREDITS_PHASE_6.1_STATUS.md`, `docs/STATUS.md`, `docs/COURSE_OF_ACTION.md` | `src/lib/credits.ts`, `src/components/CreditHistory.tsx`, `src/components/SendCreditsModal.tsx` |
| Projects & Tasks | `docs/STATUS.md`, `docs/Goals.md`, `docs/COURSE_OF_ACTION.md` | `src/lib/projects.ts`, `src/lib/tasks.ts`, `src/lib/milestones.ts`, `src/pages/ProjectDetail.tsx` |
| Operations | `docs/DEPLOYMENT_PLAN.md`, `docs/Stable-Node.md`, `docs/TRAINING_UPDATES.md` | `ops/` scripts, `services/rendezvous-beacon/`, configuration files (`tailwind.config.ts`, `vite.config.ts`) |

> Keep this document synchronized whenever features move directories, new capability pillars are added, or documentation sources shift. It is intended to be the single, accurate map of the system.
