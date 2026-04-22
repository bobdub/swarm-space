

## Replace Live Chat tray with the Brain experience

The fixed-position **StreamingRoomTray** ("Live Chat" widget) is replaced by an upgraded **BrainChatPanel** that lives inside the Brain universe. Voice/video stay the same; chat moves into the Brain HUD with bigger area, formatting, presence list, and a Promote-to-Feed button.

### 1. Retire the legacy chat tray

- `src/App.tsx` — remove the `<StreamingRoomTray />` render and its `StreamingErrorBoundary` wrapper. The tray + its big floating chat panel disappear from every page.
- Voice/video for live rooms continues via the existing `PersistentAudioLayer` (added inside `BrainUniverseScene`) and the streaming context — only the **chat UI surface** is replaced.
- Keep `StreamingRoomTray.tsx` on disk for now (moderation + recording finalization logic is reused) but stop importing it. Move its still-needed side effects (`stream-recording-finalized` listener, `convertChatToComments`, `wrapChatIntoCoin`, `handleStreamEnd` recorder) into a new headless component `src/components/streaming/StreamingBackgroundService.tsx` mounted in `App.tsx` so end-of-stream archival keeps working without UI.

### 2. Upgrade `BrainChatPanel` into the new "Live Chat"

Rewrite `src/components/brain/BrainChatPanel.tsx`:

- **Bigger area.** Default size `min(560px, calc(100vw - 2rem))` wide, `min(60vh, 520px)` tall. Add a maximize toggle that goes fullscreen-modal on desktop and full-sheet on mobile.
- **Resizable.** Use the existing `ResizablePanelGroup` so users can drag the chat width and the messages-vs-composer split (matches today's tray UX).
- **Longer messages with formatting.** Replace the single-line `Input` with a `Textarea` (auto-grow up to 8 rows, Shift+Enter newline, Enter sends). Raise `MAX_LEN` to 8000 chars. Render messages with a lightweight Markdown subset:
  - `**bold**`, `*italic*`, `` `code` ``, fenced ```` ``` ```` blocks, `> quote`, `- list`, links auto-linked, `@mention` styled via existing `MentionPopover` / `mentions.ts` utilities.
  - Long messages auto-collapse over `LONG_MESSAGE_THRESHOLD` (2400 chars) with "Show more" — same pattern as today's tray.
  - Reply-to a message (mirrors `replyTo` UX from the tray, including jump-to scroll).
- **Persisted history.** Brain chat already uses `sendChatLine` / `onChatLine` per-room; extend `BrainUniverseScene` to also `getRoomChatMessages(roomId)` from `webrtcSignalingBridge.standalone` so history loads on open and survives panel close/reopen.

### 3. Users-in-chat (presence panel)

Add a left "Users" rail inside the chat panel:

- Source list = union of `voicePeers` (from `useBrainVoice`) and `rtcParticipants` (video grid) already available in `BrainUniverseScene`. Dedupe by `peerId`/`userId`.
- Each row: avatar (`<Avatar/>`), username, mic state (`Mic`/`MicOff`), camera state (`Video`/`VideoOff`), active-speaker ring (re-use the analyser pattern from the legacy tray, lifted into a small `useActiveSpeaker(participants)` hook in `src/hooks/useActiveSpeaker.ts`).
- Click a user → `@mention` them in the composer; long-press / kebab → host moderation actions when `canModerate` (only inside live rooms tied to `useStreaming().activeRoom`).
- Show a header count `Users · N` and a "Voice on" pill when local mic is unmuted.

### 4. Promote-to-Feed button

Top-right of the new chat panel header:

- Visible when `useStreaming().activeRoom` exists AND the active room id matches the current Brain `roomId` (global `brain-universe-shared` or `brain-project-${id}`). For pure project Brain sessions with no live broadcast, the button is hidden.
- Reuses the existing `promoteRoomToPost` flow plus `convertChatToComments` and `wrapChatIntoCoin` from the legacy tray (now living in `StreamingBackgroundService`).
- States: `Promote to feed` → loading spinner → `Promoted ✓` (disabled, links to the new post). Toast on success/error matches today's UX.

### 5. Surface the chat globally

Today the panel only opens inside `/brain` and `/projects/:id/hub`. To replace the always-on Live Chat tray, mount a small floating **"Brain Chat"** launcher (`src/components/brain/BrainChatLauncher.tsx`) in `App.tsx`:

- Shows on every route except `/brain` and `/projects/:id/hub` (where the in-scene panel already exists).
- Opens a portal-rendered `BrainChatPanel` bound to whichever room is contextually active:
  - If `useStreaming().activeRoom` exists → bind to `activeRoom.id` (live room chat).
  - Else → bind to the global `brain-universe-shared` room (Infinity + general chatter).
- Same component, same upgrades; no scene canvas behind it. Mic/camera toggles remain in the Brain scene only.

### 6. Misc cleanup

- Delete the `swarm-live-chat-tray` BroadcastChannel sync from `StreamingRoomTray` references in memory; the new launcher uses one channel `swarm-brain-chat` to sync open/closed and unread counts across tabs (mirrors `mem://features/live-chat-ui-sync`).
- Update memory: rewrite `mem://features/live-chat-ui-sync` to describe the Brain launcher channel, and add a one-liner in core that the live chat surface is now the Brain panel.

### Files touched

- `src/App.tsx` — drop StreamingRoomTray, mount `StreamingBackgroundService` and `BrainChatLauncher`.
- `src/components/streaming/StreamingBackgroundService.tsx` — **new**, headless extract of recording/promotion/end-of-stream logic.
- `src/components/brain/BrainChatPanel.tsx` — rewrite: bigger, Markdown, Textarea, reply, users rail, promote button, history load, maximize.
- `src/components/brain/BrainChatLauncher.tsx` — **new**, global launcher + portal.
- `src/components/brain/BrainUniverseScene.tsx` — pass `roomActive`, `voicePeers`, `rtcParticipants`, history seed into the upgraded panel; remove duplicate chat header.
- `src/hooks/useActiveSpeaker.ts` — **new**, lifted from the old tray.
- `mem://features/live-chat-ui-sync` — updated description.

### Acceptance

```text
1. The old fixed-position Live Chat tray no longer renders on any route.
2. A "Brain Chat" launcher button is visible on every page (except /brain and /projects/:id/hub) and opens the new Brain chat panel.
3. The new panel is significantly larger than today's BrainChatPanel, resizable, and maximizable to fullscreen.
4. Composer is a multi-line Textarea: Shift+Enter inserts a newline, Enter sends, up to 8000 chars.
5. Messages render Markdown (bold, italic, code, fenced blocks, quotes, lists, links, @mentions); messages over 2400 chars collapse with "Show more".
6. A users rail shows everyone in the room with avatar, mic and camera state, and an active-speaker ring; clicking a user inserts an @mention.
7. When a live room is active and tied to the current Brain room, a "Promote to feed" button appears in the header and creates the same feed post + comment archive + coin wrap as the old tray.
8. End-of-stream recording attachment, chat→comments conversion, and chat→coin wrapping all still work via StreamingBackgroundService.
9. Inside /brain and /projects/:id/hub, the same upgraded panel is used inline (no duplicate launcher).
10. Cross-tab open/closed state syncs via the swarm-brain-chat BroadcastChannel.
```

