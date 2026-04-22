

## Make Promote-to-Feed always visible for the host of any active live room

The Promote button is wired correctly but its visibility gate is too strict. Today it only appears when `activeRoom.id === roomId`, but `/brain` is bound to the constant room `brain-universe-shared` while a Live Chat post creates a streaming room with a unique UUID — they never match, so the button never shows. Same for project hubs (`brain-project-<id>` ≠ live-room UUID). Result: the user sees the Brain world but no Promote button, exactly as reported.

### 1. Loosen the gate in `BrainChatPanel.tsx`

Replace the equality check with: "show Promote whenever a live room is active **and** the current user is its host **and** it isn't already promoted."

```ts
const isHost = Boolean(
  activeRoom && user && activeRoom.hostUserId === user.id
);
const promoteVisible = Boolean(activeRoom) && isHost;
```

(Field name: confirm against `useStreaming()`'s `activeRoom` shape — likely `hostUserId` / `hostPeerId`. If host info isn't on `activeRoom`, fall back to `Boolean(activeRoom)` so any participant who created the room can promote; promote endpoint already enforces auth server-side.)

Also clear the misleading `roomId` prop dependency from the gate so promotion works whether the user is in `/brain`, `/projects/:id/hub`, or the floating launcher panel.

### 2. Bind the Brain chat to the live room when one is active

So that chat history, voice peers, and the Promote button all reference the **same room** as the user's live broadcast:

- In `BrainUniverseScene.tsx`, accept an optional `liveRoomBinding` prop. When present, pass `activeRoom.id` down to `BrainChatPanel` as `roomId` and use it for `getRoomChatMessages` history seed.
- In `BrainUniverse.tsx` (and `VirtualHub.tsx`), read `useStreaming().activeRoom`. If it exists, pass `roomId={activeRoom.id}` instead of the static `BRAIN_ROOM_ID` / `brain-project-<id>`. Otherwise keep the universe-shared id so casual visitors still hear each other.

This means: the moment a host starts a Live Chat post, their Brain world's chat panel becomes the chat for that live room — and the Promote button lights up in its header.

### 3. Add a Promote shortcut to the launcher (defense in depth)

Inside `BrainChatLauncher.tsx`, when an `activeRoom` exists and the user is the host, render a secondary small "Promote" pill next to the Live launcher so they can publish without entering the world first. Reuses `promoteRoomToPost(activeRoom.id)` from `useStreaming()` with the same toast UX.

### 4. Confirm the auto-promote path

`StartLiveRoomButton` already auto-promotes **public** rooms on creation. Add a post-creation toast that explicitly says "Posted to feed" with a link to the new post, so the user sees confirmation. For private/invite-only rooms, the manual Promote button (now reachable) covers them.

### Files touched

- `src/components/brain/BrainChatPanel.tsx` — relax `promoteVisible` gate to host-of-active-room.
- `src/components/brain/BrainUniverseScene.tsx` — accept active live-room id, forward as `roomId`.
- `src/pages/BrainUniverse.tsx` — when `activeRoom` exists, bind scene to its id.
- `src/pages/VirtualHub.tsx` — same binding inside project hubs.
- `src/components/brain/BrainChatLauncher.tsx` — add inline Promote pill when host has an active room.
- `src/components/streaming/StartLiveRoomButton.tsx` — surface clearer toast + link after auto-promote.

### Acceptance

```text
1. Creating a Live Chat post (public OR private) results in a Brain Chat panel whose header shows a "Promote to feed" button for the host.
2. The button works from /brain, /projects/:id/hub, and the floating launcher panel — not only when room ids match.
3. Public Live Chat rooms continue to auto-publish to the feed on creation, with a confirmation toast.
4. After a successful promote, the button switches to "Promoted ✓" and stays disabled.
5. The launcher exposes a quick "Promote" action when the local user is the host of an active room.
6. Non-hosts (joiners) do not see the Promote button.
7. Desktop and mobile (≥360 px) both show the button — icon-only on mobile per existing rules.
```

