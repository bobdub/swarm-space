# Live chat rooms = a Brain rolldown with two views

The lobby Brain already does everything you listed — voice, video, text chat, presence, virtual scene — via `useBrainVoice(enabled, roomId)` + `<PersistentAudioLayer roomId>` + `<BrainUniverseScene variant>`. A live chat room is just that same pipeline with `room.id` as the `roomId` and `liveChatVariant` as the scene variant. "Classic" and "Brain view" are two presentations of the **same joined room**.

The instability and bloat came from `useLiveRoomMedia` running a second, divergent join/leave loop on the same `WebRTCManager`, mounted twice (feed card + floating dock), with stacked `helloRoom` timers and a duplicate `<audio>` rail competing with `PersistentAudioLayer`.

## Goal-by-goal mapping

| Goal | How it lands |
| --- | --- |
| Post composer publishes a live stream to the feed | `StartLiveRoomButton` already creates the room + promotes to a feed post. After creation, `setActiveRoom(room.id)` and `setFloatingLiveDock(room)`. No change to creation path. |
| Passive users view + listen from the feed post | Feed card renders tiles + scene from the **active** room's participants (read-only). They auto-join the room receive-only (no mic/cam prompt) because mesh WebRTC has no SFU — receiving requires being in the mesh, just like lobby spectators today. Audio plays from the single `PersistentAudioLayer`. |
| Users participate (contribute audio/video) | One button in the feed card / dock: "Participate Live" → calls `manager.startLocalStream(true, false)` (mic) and optionally `toggleVideo(true)` (cam). No re-join, no second hook. |
| Text chat in the room | `useBrainVoice(...).sendChatLine / onChatLine` already work on any `roomId`. The dock's chat panel binds to `room.id`. |
| Tab between Classic ↔ Brain view of the same live room | Pure UI toggle. Classic = tiles built from `useWebRTC().participants` filtered to `room.id`. Brain view = `<BrainUniverseScene variant={liveChatVariant({room})}/>`. Same join, same audio, no teardown when switching tabs. |

## Single source of truth

```text
StreamingContext.activeRoomId  ──►  <LiveRoomVoiceHost/> (mounted once at app root)
                                         │
                                         ├─ useBrainVoice(true, activeRoomId)  ◄── the only joinRoom for live rooms
                                         └─ <PersistentAudioLayer roomId={activeRoomId}/>  ◄── the only <audio> sink

Feed card / Floating dock / inline post  ──►  read participants from useWebRTC() filtered to roomId
                                              render Classic tiles OR <BrainUniverseScene variant={liveChatVariant}/>
                                              "Participate Live" = manager.startLocalStream / toggleVideo only
```

## Changes (small, surgical)

1. **Add `src/components/streaming/LiveRoomVoiceHost.tsx`** — app-level singleton. Subscribes to `activeRoomId`; runs `useBrainVoice(true, activeRoomId)` and renders `<PersistentAudioLayer roomId={activeRoomId}/>`. Mounted once next to existing brain mounts.
2. **Delete `src/hooks/useLiveRoomMedia.ts`** and every import of it.
3. **`LivePostBoxBody.tsx`** — swap to `useBrainVoice(true, room.id)` for participants + chat + mute. Remove the local `<audio>` rail, `listenMuted` state, `eagerMic`, stacked `helloRoom` timers, and `audioRefs`. Camera tile (the only place a `<video>` is meaningful) calls `manager.startLocalStream(true, true)` / `toggleVideo(false)` directly. Brain view tab unchanged.
4. **`LivePostPreview.tsx`** (feed post) — drop its `useLiveRoomMedia` join. Read `useWebRTC().participants` filtered to `room.id`. Render small tiles + a single "Participate Live" button that opens the dock.
5. **`FloatingLiveDock.tsx`** — no WebRTC calls; just renders `LivePostBoxBody` in `floating` mode. Remove any join/leave side-effects.
6. **`StreamingContext.tsx`** — confirm `setActiveRoom(roomId)` is the only join trigger for live rooms (via `LiveRoomVoiceHost`); strip stray `manager.joinRoom` calls in streaming UI files.
7. **Dead-code sweep** — `rg "useLiveRoomMedia|eagerMic|listenMuted|audioRefs" src/` must return zero after edits.

## What this does NOT touch

- `WebRTCManager` signaling logic — the lobby proves it works; the bug is duplicated callers.
- Room creation, promotion-to-post, recording, moderation.
- Bar / builder / plots.

## Verification (two browsers on `/index`)

1. Host creates live room from composer → dock pops, mic on, "Broadcasting" badge.
2. Viewer's feed shows live post; audio plays and host's camera tile appears with **no clicks**.
3. Viewer toggles Classic ↔ Brain view — audio uninterrupted, participants list stable.
4. Viewer clicks "Participate Live" → mic activates, host hears them, no flicker.
5. Dock → undock → re-dock 3× — room stays joined, no "room ended" toast.
6. Text messages flow both ways in the room's chat.
7. `rg useLiveRoomMedia src/` returns zero matches.
