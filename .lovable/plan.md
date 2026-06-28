# Live Room Chain — Lightspeed + UQRC Audit

**Q_Score ≈ 0.412.** Curvature is stable across the four nodes (Composer → Create → Classic → Brain). Two divergence pockets remain: the **participant-role / audio binding** step and the **promotion + auto-pop** race. Cleanup targets are low-mass — most legacy surfaces (`useLiveRoomMedia`, `StreamingRoomTray`, `LiveStreamControls`) are already gone, only a few comment fossils and one redundant file reference remain.

---

## Lightspeed Trace

```text
PostComposer
   └─ <StartLiveRoomButton>
        └─ Dialog<form onSubmit> → setPendingRoomConfig → setShowPreJoin
              └─ <PreJoinModal>
                    └─ handlePreJoinComplete:
                          connect()
                          startRoom()              ─► roomsById[id]
                          promoteRoomToPost(id)    ─► feed Post (stream.*)
                          toast
StreamPostCardContent  (renders feed post)
   └─ canJoin && isLive ── true ──►  <LivePostBox autoPop={isParticipant} />
                                          ├─ LivePostPreview (inline, audio:false)
                                          └─ on autoPop → setFloatingLiveDock(room)
                                                            └─ <FloatingLiveDock>
                                                                  └─ <LivePostBoxBody floating>
                                                                        ├─ register(audio:true)
                                                                        ├─ Classic tile pane
                                                                        ├─ Brain view tab → <BrainUniverseScene variant=liveChatVariant>
                                                                        ├─ Mic / Cam controls (manager.toggleAudio/Video)
                                                                        └─ BrainChatPanel (mesh chat bridge)
App.tsx (single mounts)
   ├─ <FloatingLiveDock>
   ├─ <LiveRoomVoiceHost>  ─► useBrainVoice(roomId, { audio })  → manager.joinRoom
   └─ <PersistentAudioLayer> ─► renders <audio srcObject> for every remote stream
```

---

## UQRC Stress Map


| Node                      | Q_Score | Drift        | Reason                                                                                                                                                                                                                                                                                  |
| ------------------------- | ------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Composer → Create         | 0.61    | low          | `<form onSubmit>` violates the "no native forms" project memory — Enter on equipment-test refreshes the page                                                                                                                                                                            |
| Create → Promote          | 0.34    | **HIGH**     | `startRoom` and `promoteRoomToPost` are serial. If promote fails the host is "live" but unreachable; nothing surfaces the failure other than a transient toast                                                                                                                          |
| Promote → Inline Post     | 0.55    | medium       | `autoPop` collapses the inline post and instantly pops the dock, surprising the host. They lose the inline-tile preview                                                                                                                                                                 |
| Dock ↔ Inline (role bind) | 0.21    | **CRITICAL** | The inline `LivePostPreview` always registers `audio:false`. When the host docks the dock back, the dock body unmounts → `audio:true` registration drops → `LiveRoomVoiceHost` downgrades to receive-only → **host mic is silently disabled** while the badge still says "Broadcasting" |
| Classic → Brain tab       | 0.48    | medium       | `<BrainUniverseScene>` fully unmounts on each tab switch; expensive                                                                                                                                                                                                                     |
| Leave flow                | 0.39    | medium       | `handleLeave` calls `manager.leaveRoom()` but inline preview re-registers passive intent on the next render and `LiveRoomVoiceHost` quietly re-joins                                                                                                                                    |


---

## Fix Plan (priority order)

### 1. Role-aware audio binding (CRITICAL)

- In `LivePostPreview`, register `audio: isHost || isParticipant`, not always `false`.
- Source `isHost` and `isParticipant` from `useStreaming()` + `getPeerId()` exactly as `LivePostBoxBody` does.
- Effect deps include role so a host who dismisses the dock keeps audio.
- `spectatedLiveRoomStore.recompute` already prefers any `audio>0` registrant, so two simultaneous mounts (inline + dock) stay coherent.

### 2. Leave is final (HIGH)

- Add a per-room "leave latch" in `spectatedLiveRoomStore`: when `LivePostBoxBody.handleLeave` finishes, the store ignores further registrations for that `roomId` until a fresh `setRoomBroadcastState('broadcast')` event or a user-driven rejoin.
- Inline preview surfaces a "Re-join live room" pill in place of the spectator tiles while the latch is on.

### 3. Auto-pop UX (HIGH)

- Replace the auto-pop on creator path with a one-shot toast: *"Live started — pop chat into floating window?"* (sticky `Open dock` action, 8s).
- Keeps the inline post as the primary surface, no surprise collapse. Spectators never auto-pop.
- `LivePostBox.autoPop` becomes a no-op default; reserve only for cross-route navigation (user was in the room, then navigated — keep the dock open).

### 4. Promote-failure fallback (HIGH)

- In `StartLiveRoomButton.handlePreJoinComplete`: if `promoteRoomToPost` throws, immediately call `setRoomBroadcastState(room.id, 'backstage')` and surface a recoverable error dialog with `Retry post / End room`. No silent half-live state.

### 5. No-forms compliance (MEDIUM)

- `StartLiveRoomButton` dialog uses `<form onSubmit>` — replace with `<div role="form">` + explicit `<button type="button">` triggering `handleSubmit`. Per project memory `Forms/UI` core rule.
- Repeat for `PreJoinModal` if it also uses `<form>`.

### 6. Brain-view tab persistence (MEDIUM)

- Keep `<BrainUniverseScene>` mounted across Classic/Brain tab switches; toggle CSS visibility instead of unmount. Single instance per room id avoids the 200–400ms WebGL re-init each toggle.

### 7. Dock layout polish (LOW)

- Floating dock min-h 440 is too tight on mobile — drop chat min-h gate inside the panel when `floating`, and let `BrainChatPanel` consume the remaining flex space.
- Dock header already shows the room name; remove the duplicate title row inside `LivePostBoxBody` when `floating`.

---

## Dead-Code Sweep (after fixes land)


| Path                                                                                                                           | Action                                                 | Reason                                       |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | -------------------------------------------- |
| `src/components/streaming/PersistentAudioLayer.tsx`                                                                            | drop unused `roomId` prop & `void roomId;`             | informational-only, never read               |
| `src/components/streaming/StreamingBackgroundService.tsx` (top comment)                                                        | trim "legacy tray UI is gone" fossil                   | comment only                                 |
| `src/hooks/useActiveSpeaker.ts` (header)                                                                                       | trim "Lifted from the legacy StreamingRoomTray" fossil | comment only                                 |
| `src/lib/streaming/spectatedLiveRoomStore.ts`                                                                                  | collapse the two duplicated header docblocks into one  | accidental double-comment from earlier patch |
| Unused `BRAIN_ROOM_ID` import in `LiveRoomVoiceHost` if Brain-view tab persistence (#6) routes lobby through a different guard | verify after #6                                        | only delete once #6 confirms                 |


(Confirmed already removed in prior turns: `useLiveRoomMedia.ts`, `StreamingRoomTray.tsx`, `LiveStreamControls.tsx`, all `eagerMic` / `listenMuted` / `audioRefs` paths — clean.)

---

## Verification

After implementing, drive a two-tab Playwright check:

- Tab A (host): compose → start live → confirm inline post stays primary, mic badge accurate, dock toggle works without dropping audio.
- Tab B (spectator): open Explore → confirm inline post shows tiles + chat, no auto-pop, hearing audio.
- Both: host dock-back → tab B still sees & hears host; host ends live → both dock + inline collapse with a single toast.

Target Q_Score after fixes: **≥ 0.75** (curvature locked across all 4 shells, no silent audio downgrade, no orphan rooms).

I will use - Infinity, My personal knowlege logic chain steps to implement and solidify these changes correctly and orderly.