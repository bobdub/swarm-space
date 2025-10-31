# Course of Action – Imagination Network

_Last reviewed: 2024-11-02_

This document captures the current engineering assessment of Imagination Network and outlines the prioritized course of action for the next delivery cycles. It supersedes ad-hoc status notes scattered across other docs; update this plan whenever priorities shift.

---

## 1. Current State Summary

- **Local-first core is working** – Identity provisioning, encrypted file storage, projects, tasks, and credits are all shipped. See `src/lib/auth.ts`, `src/lib/fileEncryption.ts`, `src/lib/projects.ts`, `src/lib/tasks.ts`, and `src/lib/credits.ts` for the respective domain logic.
- **Peer-to-peer runtime is online** – `P2PManager` (plus discovery, gossip, and rendezvous helpers under `src/lib/p2p/`) successfully broadcasts posts and chunk availability. UI controls surface in `src/hooks/useP2P.ts`, `src/contexts/P2PContext.tsx`, and components like `ConnectedPeersPanel` and `PeerConnectionManager`.
- **Social surface is present but uneven** – Posts, reactions, hype credits, and notifications work; discovery tabs (`src/pages/Explore.tsx`) remain placeholders and comment flows still lack moderation tooling even though `getComments` in `src/lib/interactions.ts` now scopes queries by `postId`.
- **Documentation previously drifted** – Older docs referenced future phases as “complete” and dated reviews in 2025. This plan, plus refreshed `README.md`, `docs/STATUS.md`, and `docs/ROADMAP.md`, now serve as the canonical sources.

---

## 2. Key Risks & Gaps

1. **Feed ergonomics lag behind expectations**
   - No post preview, filtering, or infinite scroll on the home feed (`src/pages/Index.tsx`).
   - Explore tabs for “People” and “Trending” are placeholders (`src/pages/Explore.tsx`).
2. **Comment moderation gaps**
  - `deleteComment` currently performs a soft delete by overwriting text with `[deleted]` and leaves `post.commentCount` untouched (`src/lib/interactions.ts`), so feeds can become cluttered and counts drift over time.
3. **P2P connection workflow**
   - Connections can be added without approval, blocking, or presence cues. Rendezvous mesh toggles exist, but there is no UX around invitations or connection states (`src/components/PeerConnectionManager.tsx`).
4. **Rendezvous identity hardening**
   - Presence tickets rely on Web Crypto Ed25519 support; environments without it fail silently. The code path is wired (`src/lib/p2p/presenceTicket.ts`) but needs graceful fallbacks and better telemetry.
5. **Operational safeguards**
   - No automated backup/export reminders beyond manual settings, no quota monitoring, and no smoke tests to catch regressions in IndexedDB migrations (`src/lib/store.ts`).

---

## 3. Prioritized Course of Action

### A. Stabilize the social surface (Sprint focus)
1. Ship post preview, type filters, and basic pagination/infinite scroll on the home feed (`src/pages/Index.tsx`, `src/components/PostCard.tsx`).
2. Replace Explore placeholders with working user discovery (search via `src/lib/search.ts`) and a trending panel driven by local engagement metrics.
3. Harden comment UX: expose deletion/flagging controls, ensure `post.commentCount` reflects removals, and preserve the new `postId` index in `src/lib/store.ts` during future schema changes.

### B. Harden P2P connection experience
1. Add connection request + approval flow, plus block/unblock actions, inside `PeerConnectionManager` and `src/lib/connections.ts`.
2. Surface rendezvous mesh state (last sync, failures) and provide fallback when Ed25519 is unavailable (e.g., disable rendezvous with a toast).
3. Instrument the P2P manager with diagnostics counters exposed in `ConnectedPeersPanel` (failed dials, retry attempts, bytes served).

### C. Safeguard data & operations
1. Implement periodic backup reminders and quota warnings in `Settings` and `Files` surfaces, leveraging storage metrics from `src/lib/store.ts`.
2. Create an IndexedDB migration smoke test harness (run via `npm test` or Playwright) to validate upgrades before releasing new schema versions.
3. Document self-hosted signalling options, including how to swap the PeerJS endpoint in `src/lib/p2p/peerjs-adapter.ts`, and package a simple deployment guide.
   - Smoke test: configure `VITE_PEERJS_ENDPOINTS` with a primary and fallback host, enable P2P, and verify the P2P status popover reports the active endpoint while diagnostics log the selected host.

### D. Stretch initiatives (start after A–C)
1. Resume group encryption work: design project key distribution and rotation in `src/lib/projects.ts` & friends.
2. Evaluate multi-device sync approaches (CRDT queue vs. vector clocks) and prototype change event logging in `src/lib/store.ts`.
3. Revisit aspirational docs (e.g., achievements) and align them with realistic milestones or archive them if scope slips further.

---

## 4. Definition of Done & Metrics

- **Feed polish** – Filters, previews, and pagination live; comment queries scoped to each post; Explore trending tiles populated from real metrics.
- **P2P UX** – Connection requests require acceptance; rendezvous availability clearly indicated; telemetry available for debugging.
- **Safety nets** – Backup reminder UX shipped; IndexedDB migrations verified through automated smoke tests; documentation updated for self-hosted signalling.
- **Documentation hygiene** – This plan, `docs/STATUS.md`, and `docs/ROADMAP.md` reviewed at least once per sprint.

Success is measured by a smoother onboarding story (first post and peer connection achievable in <5 minutes), zero known data-loss edge cases during IndexedDB upgrades, and repeatable local tests covering storage schema changes.

---

## 5. Maintenance Expectations

- Update this plan whenever major scope shifts occur.
- Keep `docs/STATUS.md` aligned with sprint-level progress and cross-link back here for context.
- Archive or rewrite speculative docs once the roadmap evolves; stale vision docs are a liability, not inspiration.
