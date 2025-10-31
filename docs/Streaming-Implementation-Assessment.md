# Streaming Implementation Assessment

## Summary
- Confirmed the Milestone 1 foundations remain stable: the streaming context, typed message schema, and REST/WebSocket helpers continue to align with the approved plan and provide the primitives consumed by follow-on UI work.【F:src/contexts/StreamingContext.tsx†L1-L408】【F:src/lib/streaming/api.ts†L1-L143】【F:src/types/streaming.ts†L1-L107】
- Added profile and project entry points that surface a `Start live room` action, connecting existing creation flows to `StreamingContext.startRoom` through a reusable launch dialog.【F:src/components/streaming/StartLiveRoomButton.tsx†L1-L197】【F:src/components/PostComposer.tsx†L1-L238】【F:src/pages/ProjectDetail.tsx†L1-L260】
- Introduced a global streaming tray that renders active rooms, participant rosters, moderation toggles, recording controls, and join affordances across the app shell.【F:src/components/streaming/StreamingRoomTray.tsx†L1-L317】【F:src/App.tsx†L1-L74】

## Current Scaffolding Snapshot
- **Context provider:** `src/contexts/StreamingContext.tsx` handles lifecycle management, socket hydration, moderation helpers, and exposes both `createRoom` and the plan-aligned `startRoom` alias for UI callers.【F:src/contexts/StreamingContext.tsx†L1-L408】
- **API utilities:** `src/lib/streaming/api.ts` centralises fetch helpers for create/join/leave/promote/moderate/record operations referenced by the context and tray actions.【F:src/lib/streaming/api.ts†L1-L143】
- **Launch dialog:** `src/components/streaming/StartLiveRoomButton.tsx` presents context/visibility selection and calls `startRoom`, resetting state on open/close and surfacing connection status feedback.【F:src/components/streaming/StartLiveRoomButton.tsx†L1-L197】
- **Profile & project entry points:** `PostComposer` and `ProjectDetail` embed the launch dialog so caretakers can initiate rooms from personal or project feeds without leaving existing workflows.【F:src/components/PostComposer.tsx†L1-L238】【F:src/pages/ProjectDetail.tsx†L1-L260】
- **Room tray:** `src/components/streaming/StreamingRoomTray.tsx` displays the active room, exposes moderation/recording buttons when authorised, and lists other rooms with join controls; it is mounted globally from `App.tsx`.【F:src/components/streaming/StreamingRoomTray.tsx†L1-L317】【F:src/App.tsx†L1-L74】

## Alignment with Streaming-Implementation-Plan
| Milestone Item | Status | Notes |
| --- | --- | --- |
| Milestone 1: streaming context, shared types, hook, and provider wiring.【F:docs/Streaming-Implementation-Plan.md†L24-L37】 | ✅ Completed via reducer-driven provider, exported types, and global wiring in `App.tsx`.【F:src/contexts/StreamingContext.tsx†L1-L408】【F:src/types/streaming.ts†L1-L107】【F:src/App.tsx†L1-L74】 |
| Milestone 2: add `Start live room` actions to profile/project surfaces.【F:docs/Streaming-Implementation-Plan.md†L39-L44】 | ✅ `StartLiveRoomButton` is embedded in `PostComposer` and `ProjectDetail`, enabling caretakers to choose context/visibility before starting rooms.【F:src/components/streaming/StartLiveRoomButton.tsx†L1-L197】【F:src/components/PostComposer.tsx†L1-L238】【F:src/pages/ProjectDetail.tsx†L1-L260】 |
| Milestone 2: provide room tray with participant controls and status chips.【F:docs/Streaming-Implementation-Plan.md†L40-L43】 | ✅ `StreamingRoomTray` surfaces active room metadata, participant list, mute/ban actions, recording toggles, and join buttons for other rooms.【F:src/components/streaming/StreamingRoomTray.tsx†L1-L317】 |
| Milestone 2: integrate WebRTC track rendering inside the tray.【F:docs/Streaming-Implementation-Plan.md†L41-L42】 | 🚧 Placeholder layout exists, but media track attachment still relies on forthcoming WebRTC hooks. |
| Milestone 2: optimistic moderation feedback after context updates.【F:docs/Streaming-Implementation-Plan.md†L42-L44】 | 🚧 Tray actions call `sendModerationAction`, yet state changes wait on server responses; optimistic UI will be layered once track/state sync is finalised.【F:src/components/streaming/StreamingRoomTray.tsx†L70-L153】 |

## Outstanding Gaps vs. Plan
- **Media rendering:** Attach local/remote WebRTC tracks to the tray layout so caretakers can see live video tiles (Milestone 2).【F:docs/Streaming-Implementation-Plan.md†L41-L42】
- **Moderation optimism:** Mirror context updates immediately when muting/banning participants before server confirmation (Milestone 2).【F:docs/Streaming-Implementation-Plan.md†L42-L44】
- **Feed integration:** Publish live room posts and render live/replay cards after promotion flows (Milestone 3).【F:docs/Streaming-Implementation-Plan.md†L46-L55】
- **Recording UI:** Surface replay assets and retention controls once `toggleRecording` returns manifests (Milestone 4).【F:docs/Streaming-Implementation-Plan.md†L57-L64】
- **Observability:** Add telemetry and reconnection cues for heartbeat failures and TURN usage (Milestone 5).【F:docs/Streaming-Implementation-Plan.md†L66-L72】

## Next Steps
1. Wire WebRTC media components into `StreamingRoomTray`, ensuring layout slots for self and remote participants respond to track availability.
2. Introduce optimistic state updates for moderation actions while retaining server reconciliation to cover error cases.
3. Implement feed promotion outputs: live post creation, timeline cards, and replay handling backed by `promoteRoomToPost` and `toggleRecording`.
4. Layer telemetry hooks, heartbeat indicators, and runbook documentation once UX behaviours stabilise.
