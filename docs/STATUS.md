# Imagination Network Status

_Last reviewed: 2025-11-02_

> **Note**: This doc is now a **lightweight pointer** to the comprehensive project overview. For full details, see [`PROJECT_OVERVIEW.md`](PROJECT_OVERVIEW.md).

## Quick Snapshot
- **Current sprint:** Feed polish + GUN signaling hardening (Sprint 18)
- **Production-ready:** Local-first storage, P2P networking (PeerJS mode), credits, tasks, rendezvous mesh
- **Active development:** Integrated transport (WebTorrent + GUN), feed UX, discovery
- **Planned:** Connection approvals, group encryption, multi-device sync

## Phase Overview
| Phase | Status | Highlights |
| --- | --- | --- |
| Phase 0 – Foundation | ✅ Complete | React + Vite stack, design system, IndexedDB schema, crypto helpers, navigation shell. |
| Phase 1 – Content Creation & Management | 🚧 In Progress | File encryption, manifest storage, Create flow, Files locker shipped; feed preview/filtering and trending backlog remain. |
| Phase 2 – Planner & Task System | ✅ Complete | Calendar, milestones, kanban board, IndexedDB persistence, credits integration. |
| Phase 3 – Profiles & Social | 🚀 In Progress | Profiles, reactions, hype credits, notifications live; discovery tabs, follow graph, and comment moderation tooling outstanding. |
| Phase 4 – Group Encryption | 🔐 Planned | Project key distribution and shared encryption not started. |
| Phase 5 – P2P Networking | ✅ Core online | PeerJS integration, chunk protocol, rendezvous mesh toggle, connection manager shipped; approvals, blocking, and telemetry queued. |
| Phase 6 – Advanced Features | 🌅 Planned | Performance tuning, multi-device sync, desktop/mobile wrappers follow after social + P2P polish. |

## Immediate Objectives
### Sprint 18 – Social Surface Stabilization
1. Add post preview, filtering, and pagination to the home feed (`src/pages/Index.tsx`).
2. Replace Explore placeholders with user discovery + trending cards driven by local metrics.
3. Ship comment moderation affordances: expose deletion/flagging UI, align `post.commentCount` with removals, and keep the IndexedDB `postId` index intact.

### Sprint 19 – Connection Hardening
1. Implement connection request/approval flow with block controls in `PeerConnectionManager`.
2. Surface rendezvous mesh health (last sync, failures) and Ed25519 fallbacks in the UI.
3. Add diagnostics counters to `ConnectedPeersPanel` (failed dials, retries, bytes served).

### Sprint 20 – Data Safety & Ops
1. Ship backup/quota reminders leveraging `src/lib/store.ts` metrics.
2. Build IndexedDB migration smoke tests and wire them into CI.
3. Publish self-hosted signalling guide and configuration instructions.

## Full Documentation
- **Comprehensive overview**: [`PROJECT_OVERVIEW.md`](PROJECT_OVERVIEW.md) — Current state, architecture, known issues
- **Action items**: [`NEXT_STEPS.md`](NEXT_STEPS.md) — Sprint tasks and long-term roadmap
- **Strategic planning**: [`COURSE_OF_ACTION.md`](COURSE_OF_ACTION.md) — Sprint priorities and rationale
- **Feature roadmap**: [`ROADMAP.md`](ROADMAP.md) — Phase-based delivery plan

## Ownership & Update Cadence
- **Document owner:** Product & documentation maintainers (default: release captain for the current milestone).
- **When to update:** Refresh after each sprint review or any time priorities change. Keep the review date current and ensure alignment with the course-of-action document.
- **How to update:**
  1. Review the latest commits, backlog, and course-of-action plan.
  2. Update the Snapshot, Phase Overview, and Immediate Objectives to mirror the active sprint.
  3. Submit the documentation change with a short summary in the PR description.
