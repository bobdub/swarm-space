

## Bug Fixes: Browser Strain, Live Chat Room Crossing, and Chat Formatting

### 1. Browser Performance — Reduce Feed Strain

**Root cause**: Every `p2p-posts-updated` event triggers `loadRecentPosts` which reads ALL posts from IndexedDB, filters, sorts, and causes PostCard re-renders. Each PostCard also calls `buildMentionCache()` synchronously during render.

**Changes**:
- **`src/pages/Explore.tsx`** — Increase debounce from 2s to 3s for background reloads; add a `loadingRef` guard so concurrent loads are skipped rather than queued
- **`src/components/PostCard.tsx`** — Memoize `renderContentWithLinks` output with `useMemo` keyed on `post.content`; move `buildMentionCache()` call outside the render loop into a module-level cached singleton that refreshes every 30s instead of per-render
- **`src/lib/mentions.ts`** — Add a time-based cache layer to `buildMentionCache()` so it returns the same Map for 30 seconds instead of rebuilding every call
- **`src/components/CommentThread.tsx`** — Same: use the cached mention map instead of calling `buildMentionCache()` per comment render

### 2. Live Chat Rooms Crossing — Proper Room Cleanup

**Root cause**: The `WebRTCManager` singleton joins a new room via `joinRoom(roomId)` but never calls `leaveRoom()` on the previous room first. The signaling bridge's `joinedRooms` map accumulates entries, so signals from old rooms leak into new sessions.

**Changes**:
- **`src/lib/webrtc/manager.ts`** — In `joinRoom()`, if `this.currentRoomId` is already set and differs from the new `roomId`, automatically call `leaveRoom()` first to close all old connections and announce departure
- **`src/lib/streaming/webrtcSignalingBridge.standalone.ts`** — In `announceJoinRoom()`, if the peer is already in other rooms, call `announceLeaveRoom()` for each stale room first (enforce single-room-at-a-time)
- **`src/components/streaming/StreamingRoomTray.tsx`** — In `handleStreamEnd`, after calling `leaveRoom()`, also reset `joinedRoomRef` in LiveStreamControls by dispatching a `stream-room-cleanup` event; LiveStreamControls listens and resets `joinedRoomRef.current = null`
- **`src/components/streaming/LiveStreamControls.tsx`** — Add cleanup listener for `stream-room-cleanup` and `stream-room-ended` events to reset `joinedRoomRef.current = null` so the next room join works cleanly

### 3. Chat Text Limits and Formatting

**Root cause**: Chat input has `maxLength={500}`. Long comments render inline without collapse.

**Changes**:
- **`src/components/streaming/StreamingRoomTray.tsx`** — Change chat input from `<input maxLength={500}>` to `<textarea>` with `maxLength={2000}`, allow multi-line input with Shift+Enter for newlines and Enter to send; render chat messages with `whitespace-pre-wrap` (already present)
- **`src/components/CommentThread.tsx`** — For comments longer than 300 characters, show a truncated preview with a "Show more" / "Show less" toggle button; preserve `whitespace-pre-wrap` formatting for the full text

---

### Files Changed

| File | Change |
|------|--------|
| `src/lib/mentions.ts` | Add 30s cache layer to `buildMentionCache()` |
| `src/pages/Explore.tsx` | Add concurrent-load guard; increase debounce |
| `src/components/PostCard.tsx` | Memoize content rendering |
| `src/components/CommentThread.tsx` | Use cached mentions; add collapsible long comments |
| `src/lib/webrtc/manager.ts` | Auto-leave previous room before joining new one |
| `src/lib/streaming/webrtcSignalingBridge.standalone.ts` | Enforce single-room membership; clean stale rooms on join |
| `src/components/streaming/StreamingRoomTray.tsx` | Bump chat limit to 2000; switch to textarea for multi-line |
| `src/components/streaming/LiveStreamControls.tsx` | Listen for room cleanup events; reset joinedRoomRef |

