## Scope (clarified)

This affects **only live-stream posts** created via *Create post → Live stream*. It does **not** touch:
- The `/brain` lobby
- Project hubs (`/projects/:id/hub`)
- Regular feed posts, blogs, walled posts
- The Brain tab / EnterBrainButton / BrainChatLauncher behavior for non-live contexts

## Goal

When a user starts a live stream from the composer, the live experience renders as a **post-card stream of the brain scene**, with a clear two-step entry into immersive VR. Leaving VR returns to the post, not the lobby. A/V smoothness is prioritized over rendering fidelity.

## Flow

```text
Create Post ▸ Live Stream
        │
        ▼
Feed post (LIVE badge)
        │  Join Live (post CTA)
        ▼
Pre-Join modal (cam/mic device pick)
        │
        ▼
LIVE POST BOX  ──────────────────────────────────────────
  • Brain scene preview (embedded, spectator, no HUD)    
  • Classic chat tab (no Infinity entity)                
  • Classic controls: mic / cam / leave / close         
  • Primary button: [Join Live Brain]                   
─────────────────────────────────────────────────────────
        │ Join Live Brain                ▲ Leave
        ▼                                │
Immersive VR overlay (full mics/cams/avatars, portals off)
        │ Leave ─────────────────────────┘
        ▼
Back to LIVE POST BOX (media tracks preserved)

Exit Live:
  Host  → ends room
  Viewer → leaves room, post reverts to non-live / recording
```

## Plan

### 1. Tag live-stream posts as a distinct post kind
- In the composer's "Live Stream" path (`src/components/streaming/StartLiveRoomButton.tsx` + post-creation flow), mark the created post with `postKind: 'live-stream'` in its manifest.
- Feed renderers route `live-stream` posts to the new `LivePostBox` instead of the standard post card body. All other post kinds are unchanged.

### 2. New `LivePostBox` component
- File: `src/components/streaming/LivePostBox.tsx`
- Layout (inside the existing post card chrome):
  - **Stream pane** — embedded `BrainUniverseScene` for this room only (spectator camera, no portals/HUD/builder/NPC interaction).
  - **Classic chat tab** — reuses message list/composer; Infinity persona suppressed (`infinityAlwaysReplies=false`, Infinity avatar/triggers hidden).
  - **Controls row** — mic toggle, cam toggle, Leave, Close/Exit Live (host vs viewer), and primary **Join Live Brain** button.
- All buttons `type="button"` and the controls wrapper is `<div role="form">` (per project rule).

### 3. Embedded vs Immersive presentation for live rooms only
- Add `presentation: 'embedded' | 'immersive'` prop to `BrainUniverseScene`.
- `embedded` mode (used **only** by LivePostBox):
  - Renders into parent box, fixed aspect ratio, capped DPR.
  - Disables HUD: portals, compass, minimap, builder bar.
  - Camera locked to spectator orbit around the room's avatar cluster.
  - Read-only — no movement, portal authoring, NPC interaction.
- `immersive` mode used by:
  - "Join Live Brain" overlay (new, see #4) — same `liveChatVariant`, portals off.
  - Existing `/brain` and `/projects/:id/hub` flows — **unchanged**.

### 4. Join Live Brain = overlay, not route change
- "Join Live Brain" opens a full-screen React portal overlay above the post box; does **not** navigate to `/brain`.
- Keying the scene by `roomId` keeps the same `RTCPeerConnection`s alive across embedded ↔ immersive transitions (no track teardown, no rejoin).
- "Leave" in the overlay closes the overlay; user remains in the LivePostBox.
- "Close / Exit Live":
  - Host → `endRoom` (existing in `StreamingContext`).
  - Viewer → `leaveRoom`; post card collapses back to a standard non-live post (or recording if archived).

### 5. Classic chat tab (no entity) — live-stream only
- New `chatMode: 'classic' | 'brain'` prop on `BrainChatPanel`.
- `classic` (used only by LivePostBox):
  - Hides Infinity avatar/header chip.
  - Skips Infinity reply pipeline.
  - Removes scene-context chips (portal targets, NPC hints).
- All other consumers default to `brain` — unchanged.

### 6. Live Stream Smoothness (A/V first) — live rooms only
- New helper `src/lib/streaming/avPriority.ts` applied when `variant.kind === 'liveChat'`:
  - `embedded`: DPR 1, no shadows, NPC tick paused for that scene, StarField/Galaxy off, reduced Earth shell detail, UQRC field updates throttled to ~5 Hz.
  - `immersive` (Join Live Brain overlay): DPR ≤ 1.25, same NPC pause, same throttling; portal/builder still off.
- WebRTC manager (`src/lib/webrtc/manager.ts`) gets a `mode: 'live' | 'world'` hint:
  - `live`: audio `contentHint='speech'` (never throttled), video `'motion'` with adaptive bitrate, presence pings + NPC sync data-channel chatter paused for the call.
  - `world` (default everywhere else) — unchanged.
- Continue using the single shared `AudioContext` from `PersistentAudioLayer` (per project rule).

### 7. Wiring & cleanup (scoped to live-stream posts)
- `StreamPostCardContent.tsx`: for `postKind === 'live-stream'` render `<LivePostBox>`; legacy "Join Live → navigate" path retired only for this kind.
- `AppContent.handlePreJoinComplete`: when joining a `live-stream` post, resolve back to that post URL instead of `navigate('/')`.
- `BrainChatLauncher`: when `activeRoom` corresponds to a live-stream post, hide the floating launcher (the post box owns the return path). All other `activeRoom` cases unchanged.
- `/brain`, `VirtualHub`, EnterBrainButton, project Brain variants — **no changes**.

## Technical notes

- WebRTC continuity guaranteed by mounting embedded + immersive views off the same `StreamingContext` room and keying by `roomId`; the overlay sits above the post box rather than replacing it.
- No new routes. The immersive overlay is a portal; URL stays on the post/feed.
- All new UI follows the no-`<form>` / `type="button"` rule.
- Live-stream post recording / promote-to-feed path is untouched.

## Out of scope

- Project hub live behavior — unchanged for now; can adopt the same pattern in a follow-up if desired.
- Non-live post types.
- `/brain` lobby, EnterBrainButton, BrainChatPanel default behavior outside live-stream posts.
