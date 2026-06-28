## Why the app feels slow

A scan of the live-chat path found three big CPU/GPU costs stacking on top of each other:

1. The neural predictor is firing the `[Neural:Predict] flow:gossip correction needed` log up to **~300 times per second** because it runs from the Three.js 60fps render loop with no log throttle. You can see the flood in the console right now.
2. The Brain scene and floating dock stack **~20 `backdrop-blur` panels directly over the live WebGL canvas**, forcing the GPU to re-blur the whole 3D framebuffer every frame.
3. The streaming context re-renders **every consumer in the app every 15 seconds** (heartbeat → new `roomsById` ref → memoised `value` changes). The floating dock, every feed post card, and the live chat panel all redraw on the same tick.

Plus a few smaller cuts (drag without RAF throttle, 1.5s audio poller, double `getUserMedia` on video join).

## Plan — ordered by impact, smallest-first wins at top

### 1. Kill the neural-predictor log flood (5-minute win, ~300 logs/s → ~1/s)
- `src/lib/p2p/neuralStateEngine.ts` around the `observe()` log: add a per-track `lastLogAt` guard so each metric logs at most once per 5s.
- `src/lib/brain/infinityBinding.ts` + its caller in `BrainUniverseScene.tsx`: move `feedFieldIntoNeural()` out of `useFrame` (60fps) onto the existing 4 Hz `fieldEngine` tick.

### 2. Strip `backdrop-blur` off the Brain canvas + Floating Dock
Replace every `backdrop-blur` / `backdrop-blur-md` that sits over the WebGL scene with a solid/semi-opaque dark fill (the scene is already dark, the visual delta is tiny but the GPU cost drops massively).
- `src/components/brain/BrainUniverseScene.tsx` (~15 occurrences)
- `src/components/brain/BrainChatPanel.tsx` (4)
- `src/components/brain/BrainVideoGrid.tsx`, `CompassHUD.tsx`, `MiniMapHUD.tsx`, `builder/BrainBuilderBar.tsx`
- `src/components/streaming/FloatingLiveDock.tsx` (always-on overlay)

### 3. Stop the StreamingContext heartbeat re-render storm
- `src/contexts/StreamingContext.tsx`: keep the host-stale sweep `useEffect` but swap `state.roomsById` out of its dep array — store rooms in a `roomsByIdRef` so the interval is registered **once** instead of re-registered on every dispatch.
- Split the context into a stable `StreamingActionsContext` (functions, never changes identity) and `StreamingStateContext` (state). `FloatingLiveDock`, post cards, and `BrainChatLauncher` then only re-render when state they actually use changes.

### 4. Shrink the periodic mesh broadcast
- `src/lib/streaming/streamSync.standalone.ts`: the 15s `sendInventory` currently broadcasts the **full room snapshot** for every room. There is already a compact `room-inventory` message type — switch periodic broadcasts to it, and only send the full snapshot in reply to an explicit `room-request`. Removes 90%+ of the `upsert-room` dispatches.

### 5. Make the Floating Dock drag cheap
- `src/components/streaming/FloatingLiveDock.tsx`: throttle `setRect` through `requestAnimationFrame` — buffer the latest pointer position in a ref, flush in one RAF callback. Drops drag updates from ~120/s to ~60/s and avoids tearing the LivePostBoxBody subtree on every mousemove.

### 6. Calm the persistent audio poller
- `src/components/streaming/PersistentAudioLayer.tsx`: the 1.5s `setInterval` is mostly redundant — the WebRTC manager already fires events on stream changes. Raise to 5s as a safety net or replace with a direct event subscription.

### 7. Fix double getUserMedia on video upgrade
- `src/lib/webrtc/manager.ts`: the join path calls `getUserMedia` twice when upgrading to video (audio first, then audio+video). Either keep one stream and add a video track from a cached `getUserMedia({video:true})`, or clone an existing video stream. Removes ~200–800ms of join latency and one extra device-open.

## What you'll feel after each step
- After 1: console quiets, idle CPU drops noticeably.
- After 2: scrolling in `/brain`, opening the floating dock, and the live chat panel stop dropping frames.
- After 3+4: switching tabs / scrolling the feed while a live room is open stops stuttering.
- After 5–7: dragging the dock is smooth and the "Participate Live" → joined transition feels near-instant.

## Notes
- All changes are presentation- and event-frequency-only — no business logic, no schema, no API surface changes.
- I'll verify each step with the in-app console (Neural log rate) and a Playwright run that opens `/brain`, joins a live room, drags the dock, and screenshots frame timings.

Want me to proceed straight through 1 → 7, or stop after a checkpoint (e.g. after step 3) so you can feel the improvement before I continue?