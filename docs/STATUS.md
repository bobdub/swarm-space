# Imagination Network Status

_Last reviewed: 2024-11-02 • Source: docs/COURSE_OF_ACTION.md, docs/ROADMAP.md, README.md_

## Snapshot
- **Current focus:** Feed polish + discovery upgrades (Sprint 18) and P2P connection UX hardening.
- **Overall maturity:** Core local-first platform, planning tools, credits, and baseline P2P sync are in production; discovery, moderation, and rendezvous telemetry are actively in development.
- **Next milestone:** Deliver the "Social Surface Stabilization" bundle (feed filters, Explore upgrades, comment fixes) before starting connection approvals.

## Phase Overview
| Phase | Status | Highlights |
| --- | --- | --- |
| Phase 0 – Foundation | ✅ Complete | React + Vite stack, design system, IndexedDB schema, crypto helpers, navigation shell. |
| Phase 1 – Content Creation & Management | 🚧 In Progress | File encryption, manifest storage, Create flow, Files locker shipped; feed preview/filtering and trending backlog remain. |
| Phase 2 – Planner & Task System | ✅ Complete | Calendar, milestones, kanban board, IndexedDB persistence, credits integration. |
| Phase 3 – Profiles & Social | 🚀 In Progress | Profiles, reactions, hype credits, notifications live; discovery tabs, follow graph, and comment storage fix outstanding. |
| Phase 4 – Group Encryption | 🔐 Planned | Project key distribution and shared encryption not started. |
| Phase 5 – P2P Networking | ✅ Core online | PeerJS integration, chunk protocol, rendezvous mesh toggle, connection manager shipped; approvals, blocking, and telemetry queued. |
| Phase 6 – Advanced Features | 🌅 Planned | Performance tuning, multi-device sync, desktop/mobile wrappers follow after social + P2P polish. |

## Immediate Objectives
### Sprint 18 – Social Surface Stabilization
1. Add post preview, filtering, and pagination to the home feed (`src/pages/Index.tsx`).
2. Replace Explore placeholders with user discovery + trending cards driven by local metrics.
3. Fix `getComments` to index/filter by `postId` and add moderation affordances.

### Sprint 19 – Connection Hardening
1. Implement connection request/approval flow with block controls in `PeerConnectionManager`.
2. Surface rendezvous mesh health (last sync, failures) and Ed25519 fallbacks in the UI.
3. Add diagnostics counters to `ConnectedPeersPanel` (failed dials, retries, bytes served).

### Sprint 20 – Data Safety & Ops
1. Ship backup/quota reminders leveraging `src/lib/store.ts` metrics.
2. Build IndexedDB migration smoke tests and wire them into CI.
3. Publish self-hosted signalling guide and configuration instructions.

## References
- Priorities & rationale: [`docs/COURSE_OF_ACTION.md`](./COURSE_OF_ACTION.md)
- Detailed backlog & acceptance criteria: [`docs/ROADMAP.md`](./ROADMAP.md)
- Feature breakdown and platform overview: [`README.md`](../README.md)

## Ownership & Update Cadence
- **Document owner:** Product & documentation maintainers (default: release captain for the current milestone).
- **When to update:** Refresh after each sprint review or any time priorities change. Keep the review date current and ensure alignment with the course-of-action document.
- **How to update:**
  1. Review the latest commits, backlog, and course-of-action plan.
  2. Update the Snapshot, Phase Overview, and Immediate Objectives to mirror the active sprint.
  3. Submit the documentation change with a short summary in the PR description.
