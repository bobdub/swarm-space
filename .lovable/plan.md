

## Show the device setup screen when *joining* a live chat too

Right now the **PreJoinModal** (camera preview, mic level meter, mic/camera/speaker selectors, Test Mic, Test Audio) only appears when you **start** a live room from `StartLiveRoomButton`. When you tap **"Join live room"** on a stream post (or arrive via an invite link), the app calls `connect()` + `joinRoom()` immediately and drops you straight into the room — no chance to pick a device or test it first.

This plan reuses the existing `PreJoinModal` for the join flow so creators and joiners get the same setup experience.

### Changes

**1. `src/components/streaming/StreamPostCardContent.tsx`**
- Add local state: `showPreJoin`, `pendingJoinRoomId`.
- Replace the current `handleJoin` body so that, after the eligibility checks (signed in, not ended, invite ok), it:
  - Calls `injectRoom(knownRoom)` if needed (kept) — but does **not** yet call `connect()` / `joinRoom()`.
  - Sets `pendingJoinRoomId = stream.roomId` and opens the PreJoinModal.
- Add a `handlePreJoinComplete({ audio, video, audioDeviceId, videoDeviceId })` callback that:
  - Persists the chosen devices (PreJoinModal already saves to `localStorage` via `swarm-preferred-devices`).
  - Calls `await connect()` then `await joinRoom(pendingJoinRoomId)`.
  - Dispatches a `window` event `stream-prejoin-selection` carrying `{ roomId, audio, video, audioDeviceId, videoDeviceId }` so `LiveStreamControls` / `useWebRTC` can honor the user's mute and device choices when acquiring `getUserMedia`.
  - Closes the modal and clears `pendingJoinRoomId`.
- Render `<PreJoinModal open={showPreJoin} roomTitle={title} onJoin={handlePreJoinComplete} onCancel={…} />` at the bottom of the component.

**2. `src/App.tsx`** (invite-link / deep-link join via `handleJoinStream`)
- Mirror the same pattern: instead of joining immediately, open a single shared `PreJoinModal` for the pending room id, then call `connect()` + `joinRoom(roomId)` from the modal's `onJoin` and `navigate("/")`.
- Keep behavior identical when streaming is disabled.

**3. `src/components/streaming/LiveStreamControls.tsx`** (light touch)
- On mount, read the most recent `stream-prejoin-selection` event for the current `roomId` (cache it briefly on `window.__swarmPreJoin`) and:
  - If `audio === false`, start the local stream muted.
  - If `video === false`, skip requesting camera (audio-only join).
  - Pass `audioDeviceId` / `videoDeviceId` to the existing `getUserMedia` constraints (the PreJoinModal already wrote them into `swarm-preferred-devices`, so this is mostly fallback wiring).
- No protocol or signaling changes.

**4. No changes** to `PreJoinModal.tsx`, `StreamingContext`, or `StartLiveRoomButton` — the modal is already generic enough (`roomTitle` prop, `onJoin({ audio, video, audioDeviceId, videoDeviceId })`).

### What the user sees

```text
Before:  Tap "Join live room" → instantly in the room with default mic/cam
After:   Tap "Join live room" → PreJoinModal opens
           • camera preview + mic level meter
           • Mic / Camera / Speaker dropdowns
           • Test Mic, Test Audio buttons
           • Join Muted | Join Room
         → only then connect() + joinRoom()
```

### Files touched

- `src/components/streaming/StreamPostCardContent.tsx` — gate `handleJoin` behind PreJoinModal
- `src/App.tsx` — gate `handleJoinStream` (invite-link path) behind PreJoinModal
- `src/components/streaming/LiveStreamControls.tsx` — honor PreJoin audio/video/device selection when acquiring local stream
- `MemoryGarden.md` — caretaker reflection on giving every guest the same threshold ritual as the host

No new dependencies. Backwards-compatible: cancelling the modal simply doesn't join.

