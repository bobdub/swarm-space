

# Plan: Streaming Fixes (4 Items)

## 1. HIGH PRIORITY — Mic/Video Permission Conflict

**Root cause**: `startLocalStream()` in `WebRTCManager` calls `getUserMedia()` each time, which *replaces* the entire `localStream`. When the user toggles camera on (no video track yet), `toggleCamera` calls `startLocalStream(includeAudio, true)` — this creates a brand new `MediaStream`, replacing the old one. The old audio track gets stopped and removed from all peer connections, killing audio for everyone.

**Fix** (`src/lib/webrtc/manager.ts` — `startLocalStream`):
- Instead of replacing the whole stream, **add only the missing track type** to the existing stream.
- If `this.localStream` already exists: call `getUserMedia` for only the missing kind (e.g., `{audio: false, video: true}`), then add the new track to the existing `MediaStream` via `addTrack()`.
- Replace senders on existing peer connections for just the new track kind, preserving existing tracks.
- Only create a fresh `MediaStream` if none exists yet.

**Fix** (`src/components/streaming/LiveStreamControls.tsx` — `toggleCamera` / `toggleMic`):
- When the stream already has the other track type, request only the missing kind. No changes needed here if the manager handles it correctly, but verify the `includeAudio`/`includeVideo` flags passed to `startLocalStream` are not causing a full replacement.

## 2. Recording Not Appearing in Content Distribution

**Root cause**: Recordings are saved to IndexedDB via `saveRecordingBlob()` in `recordingStore.ts` but never announced as a torrent manifest to the swarm mesh. The Content Distribution panel reads from the torrent/swarm manifest store, not the recording store.

**Fix** (`src/components/streaming/StreamingRoomTray.tsx` — `persistRecordingBlobForRoom`):
- After `saveRecordingBlob()`, also create a torrent-style manifest for the recording blob and seed it into the swarm mesh via `announceContent`.
- Import and call the swarm mesh's `seedFile` (or equivalent) with the recording blob, so it appears in Content Distribution for both host and peers.
- This ensures the recording blob is chunked at 1 MiB and enters the torrent distribution pipeline.

## 3. "Promote to Feed" Toggle — Prevent Re-promote

**Fix** (`src/components/streaming/StreamingRoomTray.tsx`):
- Track whether the room has already been promoted by checking `activeRoom.broadcast?.postId` or maintaining local state `isPromoted`.
- After successful promotion, set `isPromoted = true`.
- Change the button text from "Promote to feed" to "PROMOTED" and disable it.
- Also initialize `isPromoted` from `activeRoom.broadcast?.postId` on mount so it persists across re-renders.

```text
Before:  [Upload icon] Promote to feed    (clickable)
After:   [Check icon]  PROMOTED            (disabled, muted style)
```

## 4. LOW PRIORITY — "Start Broadcasting" Framework

**Current state**: The "Start Broadcasting" button in `LiveStreamControls` currently just sets `isStreaming = true` and calls `onStreamStart`. It doesn't gate new joiners or serve media to the feed.

**Preparation** (framework only, no full implementation):
- Add a `broadcastMode` flag to the room metadata (`VideoRoom` type) to distinguish "private room" from "broadcasting to feed".
- When "Start Broadcasting" is clicked, set `broadcastMode = true` on the room, which signals to the mesh that new users can discover and join.
- Add a comment/TODO block for the feed-serving pipeline (projecting mic/video to feed viewers who aren't in the WebRTC room).
- No actual media-to-feed relay implementation — just the state and signaling scaffolding.

## Files Modified

| File | Changes |
|------|---------|
| `src/lib/webrtc/manager.ts` | Fix `startLocalStream` to add tracks incrementally |
| `src/components/streaming/LiveStreamControls.tsx` | Minor: align with new incremental track API |
| `src/components/streaming/StreamingRoomTray.tsx` | Seed recording to swarm mesh; promote toggle state |
| `src/lib/webrtc/types.ts` | Add `broadcastMode` to `VideoRoom` type |

