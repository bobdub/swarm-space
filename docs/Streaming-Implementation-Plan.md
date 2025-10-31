# Swarm Space Streaming Implementation Plan

This plan translates the architecture defined in [`docs/Streaming.md`](./Streaming.md) into actionable engineering work. It focuses on delivering live audio/video rooms that can be created from profile and project feeds, optionally promoted to live posts, and extended with recording and moderation controls.

## Objectives

1. Enable members to start WebRTC audio/video rooms from profile and project surfaces.
2. Provide signaling, invitation, and moderation flows consistent with the decentralized mesh model.
3. Surface live streams and replays as channel posts with clear lifecycle transitions.
4. Lay the groundwork for optional recording, summaries, and retention controls.

## Guiding Principles

- Preserve the pure peer-to-peer topology described in the streaming spec—no server-side mixing.
- Reuse existing rendezvous mesh and identity primitives for authentication and trust.
- Keep UX consistent with current post creation and project collaboration patterns.
- Ship incrementally with observable checkpoints, enabling feedback after each milestone.

## Milestone Breakdown

### Milestone 1 – Client Foundations & Context Wiring

- [x] Create a `StreamingContext` that manages room state, signaling connectivity, invites, and moderation flags.
- [x] Define shared types (`StreamRoom`, `StreamParticipant`, `StreamInvite`, etc.) under `src/types/streaming.ts` aligned with the spec message schemas.
- [x] Implement a `useStreaming` hook that wraps the context, handling REST calls (`/api/signaling/rooms*`) and WebSocket session lifecycle.
- [x] Add feature flags and P2P dependency checks so streaming can be enabled/disabled per environment.
- [x] Provide basic provider wiring in `App.tsx` to supply the context across the application.

### Milestone 2 – UI Entry Points & Room Surfaces

- [x] Extend post creation components on profile and project pages with “Start live room” actions that call `StreamingContext.startRoom`.
- [x] Build a room tray UI to display active participants, mute/ban controls, and streaming status (invite-only, live, recording).
- [ ] Integrate WebRTC track rendering via existing media components or new lightweight viewers.
- [ ] Ensure moderation actions propagate via context (e.g., call REST `PATCH /participants/{peerId}`) and update UI optimistically.

### Milestone 3 – Posting & Feed Integration

- [x] When a host promotes a live room, publish a post referencing `roomId` and toggle the room state to “broadcast”.
  - Persist broadcast metadata on the room, write a `type: "stream"` post with `stream` payload, and sync ended states back into stored posts when WebSocket closures arrive.
- [x] Update feed card components to display live rooms with join CTA and, once archived, replay/summaries.
  - Render a dedicated stream card that highlights live status, participant counts, summary readiness, and replay availability messaging.
- [x] Handle invitation-only states by gating join buttons and surfacing pending approvals.
  - Disable the join CTA until an invite or active participation is detected and communicate invite-only requirements inline.

### Milestone 4 – Recording & Replay Hooks

- [ ] Implement optional recording toggles that trigger chunk manifest creation as defined in the spec.
- [ ] Surface recording progress and retention controls in the room tray.
- [ ] Extend post cards to poll `GET /api/streams/{roomId}/recording` until ready, then replace CTA with replay viewer.
- [ ] Wire auto-generated summary retrieval using `summaryId` metadata.

### Milestone 5 – Observability & Resilience

- [ ] Emit diagnostics into existing telemetry/logging for signaling connection state, heartbeat health, and TURN utilization alerts.
- [ ] Add reconnection handling UI cues for heartbeat loss and automatic room closure after inactivity.
- [ ] Document operational runbooks for TURN relay provisioning and invitation revocation flows.

## Dependencies & Integration Points

- **P2P layer:** `src/lib/p2p` rendezvous manager for mesh tickets, identity verification, and chunk dissemination.
- **Auth/session:** reuse JWT session workflow powering current authenticated APIs.
- **UI primitives:** modal, button, and tray components in `src/components` for consistent presentation.
- **Routing:** ensure deep links to live/replay posts hydrate the necessary streaming context data.

## Testing Strategy

- Unit tests for context reducers, invitation state changes, and reconnection logic.
- Integration tests that mock REST + WebSocket interactions to validate join, update, and end flows.
- Manual QA checklist covering host creation, invite join, moderation actions, live post publishing, and replay retrieval.

## Rollout Considerations

- Launch behind an environment flag with staged enablement (internal → beta creators → general).
- Monitor TURN relay load and adjust recommended participant counts accordingly.
- Provide community documentation summarizing room creation, moderation, and replay behavior.

---

**Status:** Milestones 1–3 implemented; proceed to recording and replay hooks in Milestone 4.
