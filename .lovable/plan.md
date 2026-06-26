## Problem

Viewers of a freshly created live post see "Processing recording…" with no Join CTA, even while the host is actively live in the floating dock.

## Root causes (confirmed by code read)

1. **Promotion never marks the post as "broadcast".**
   `promoteRoomToPost` stores `broadcastState: promotedRoom.broadcast?.state ?? "backstage"`. The composer-driven live flow promotes the room but does not subsequently call `setRoomBroadcastState(roomId, "broadcast")`. The mesh therefore propagates a post whose `stream.broadcastState === "backstage"`.

2. **`StreamPostCardContent` treats anything that isn't "broadcast" as ended.**
   `const broadcastState = endedLocked ? "ended" : stream?.broadcastState ?? "ended";` — the `?? "ended"` fallback, plus `isLive = … broadcastState === "broadcast"`, means a "backstage" post is rendered as ended.

3. **`StreamingBackgroundService` flips live posts to "ended" on any recording-finalized event.**
   `attachRecordingToStreamPosts` unconditionally sets `broadcastState: "ended"` and `endedAt`, then `broadcastPost`. If the host briefly toggles recording (or remounts during the dock pop-out), this prematurely "ends" the post for every viewer — producing the "Processing recording…" state.

4. **`recordingProcessing` UI shows even when no replay is realistically coming.**
   Already partly guarded, but still triggered because (3) sets `recordingId` on the post, which makes `hasRecording` true → loading spinner, and when blob fetch fails on remote viewers it falls back to "Processing recording…".

## Fix

### A. Make promotion produce a truly "live" post
- In `StreamingContext.promoteRoomToPost`, when the caller is the host starting a live (room has active participants / hostPeerId === local), immediately persist the post with `broadcastState: "broadcast"` and update `promotedRoom.broadcast.state` to `"broadcast"` before broadcasting to the mesh.
- In `LivePostBox` auto-pop effect (or in `BrainChatPanel`/`LivePostComposer` start-live flow), call `setRoomBroadcastState(roomId, "broadcast", { autoPromote: true })` after promotion so state + post are coherent on every code path.

### B. Stop the background service from ending live rooms
- In `StreamingBackgroundService.attachRecordingToStreamPosts`:
  - Only set `broadcastState: "ended"` / `endedAt` if the room snapshot is already ended (`room.state === "ended"` or `room.broadcast.state === "ended"`).
  - Otherwise just attach `recordingId` to the post and re-broadcast, leaving `broadcastState` untouched.

### C. Harden `StreamPostCardContent` against missing state
- Change the fallback: `const effectiveBroadcastState = stream?.broadcastState ?? "backstage";` and compute `isEnded` strictly from `endedLocked` (which already requires explicit ended signals).
- Treat `isLive` as `!isEnded && (room?.state === "live" || effectiveBroadcastState === "broadcast" || effectiveBroadcastState === "backstage")` so unhydrated viewers still see the Join CTA when the post is promoted but room snapshot hasn't arrived.
- Skip the `recordingProcessing` pulse unless `room?.state === "ended"` or `room?.broadcast?.state === "ended"` is observed (not just `endedLocked` inferred from stale local metadata).

### D. Verify
- Manual: create live → confirm second tab on the same mesh shows "Live" badge + "Join live room" button while host is in floating dock.
- Confirm host's own post still renders the popped-out stub ("Chat is open in the floating window").
- Confirm ending the live from the dock flips both host and viewer cards to the ended state correctly.

## Files touched

- `src/contexts/StreamingContext.tsx` — promote → broadcast coherence.
- `src/components/streaming/StreamingBackgroundService.tsx` — don't auto-end live posts.
- `src/components/streaming/StreamPostCardContent.tsx` — fallback state + processing guard.
- `src/components/streaming/LivePostBox.tsx` (small) — ensure `setRoomBroadcastState("broadcast")` is called on auto-pop if not yet broadcast.

No UI redesign — only logic/state correctness so the Join button actually appears.
