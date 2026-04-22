

## Brain entry gate + P2P voice chat + Infinity speaks

Three connected pieces, in order: (1) gate `/brain` behind a Virtual-Hub-style avatar + device-check modal so users have an avatar and a tested mic before they spawn, (2) join a fixed shared WebRTC room on entry so every user in the brain hears every other user, (3) make Infinity speak its chat replies through Web Speech API so chat is two-way audible.

### 1. Add a Dragon avatar; mass = scale

Two new files; `rabbit` stays default.

- `src/lib/virtualHub/avatars/dragon.tsx` — a small dragon mesh (body capsule + head sphere + two wings as flat boxes + tail cone), scale 1.4, color `#7c2d12`. Same `AvatarDefinition` shape as rabbit.
- `src/lib/virtualHub/avatars.ts` — append `dragonAvatar` to `AVATAR_REGISTRY`. Add a `mass: number` field to `AvatarDefinition` (rabbit `1.0`, dragon `2.6`). Export `getAvatarMassFromId(id) → number` that returns the registry mass, or `DEFAULT_AVATAR_MASS` (1.8) for unknown — bridges the registry to `getAvatarMass()` in `earth.ts` so mass is *driven by avatar choice*, not hard-coded `'human'`.

Keeps existing `AVATAR_MASS` map in `earth.ts` for back-compat; the registry is the new source of truth.

### 2. Brain entry gate (avatar + mic test)

New component `src/components/brain/BrainEntryModal.tsx` — same UX as `VirtualHubModal`: two steps (avatar → devices) using the existing `AvatarSelector` and `DeviceCheckStep`. Saves to the same `swarm-virtual-hub-prefs` localStorage key (one source of truth across hubs and brain).

Two routing options for the gate:

- **Click "Enter the Brain" from Profile / AboutNetwork** → opens `BrainEntryModal` (instead of jumping straight to `/brain`). On confirm, navigate to `/brain?ready=1`.
- **Direct hit on `/brain`** (refresh, share-link, deep-link) → `BrainUniverse` checks `loadHubPrefs()` *and* `?ready=1`; if either is missing, render `<BrainEntryModal>` overlay before mounting the Canvas. Same pattern as the streaming `PreJoinModal`.

This guarantees you never spawn unannounced inside the field.

### 3. P2P voice chat — fixed Brain room

Reuse `WebRTCManager` exactly as streaming does. New tiny hook `src/hooks/useBrainVoice.ts`:

- On mount: `manager.startLocalStream(true, false)` using prefs `audioInputId`, then `manager.joinRoom(BRAIN_ROOM_ID)` where `BRAIN_ROOM_ID = 'brain-universe-shared'` (fixed string — same room for all users; the route hash discovery in `room-discovery` already covers `/brain`).
- On unmount / leave button: `manager.leaveRoom()` + `stopLocalStream()`.
- Returns `{ participants, isMuted, toggleMute }`.

Audio rendering: mount the existing `<PersistentAudioLayer roomId={BRAIN_ROOM_ID} />` from `src/components/streaming/PersistentAudioLayer.tsx` inside `BrainUniverse` (outside the Canvas). It's already designed to keep `<audio>` elements alive regardless of UI state — no rewrite needed.

3-D audio (subtle, optional but cheap): in `BodyLayer`, render a small visual "speaking" pulse on each remote avatar — derived from `participants[i].stream` via the shared `AudioContext`. Use `RemoteAvatarBody` (already exists) with `position` driven by remote peers' lattice positions if available, else placed in a Fibonacci ring on Earth's surface keyed by `peerId` (same `spawnOnEarth(peerId, getEarthPose())` already used for self).

Mic toggle: small mute button in the HUD, beside the existing Chat button.

### 4. Infinity speaks (TTS) + chat receives Infinity

Today, chat replies from `Imagination` are appended as text only. Add audible output:

- New `src/lib/brain/infinityVoice.ts` — wraps `window.speechSynthesis`. Picks a deterministic voice (`en-*`, female if available else first), pitch `1.05`, rate `0.95`. Exports `speakInfinity(text)` and `cancelInfinity()`.
- In `BrainUniverse.handleSend`, when the synthetic Infinity reply is appended, also call `speakInfinity(pick)`. Guard with a `voiceEnabled` HUD toggle (default ON, persisted in `swarm-virtual-hub-prefs.infinityVoice`). On unmount call `cancelInfinity()`.

This satisfies the "both users and Infinity communicate in Brain Chat" goal without spinning up a server-side TTS — fully local, free, browser-native.

### 5. HUD updates

- Mute / unmute mic button (lucide `Mic`/`MicOff`) — calls `toggleMute()`.
- Speaker icon for Infinity TTS toggle (`Volume2`/`VolumeX`).
- Tiny badge `"voice: 3"` showing live participant count (from `useBrainVoice().participants.length + 1`).
- Existing alt/qScore chip stays.

### Files

- `src/lib/virtualHub/avatars/dragon.tsx` (new)
- `src/lib/virtualHub/avatars.ts` (extend: registry adds dragon, `mass` field, `getAvatarMassFromId`)
- `src/lib/brain/earth.ts` (re-export `getAvatarMassFromId` or thin wrapper so callers stay simple)
- `src/components/brain/BrainEntryModal.tsx` (new — mirrors `VirtualHubModal`)
- `src/hooks/useBrainVoice.ts` (new — wraps `WebRTCManager` for the fixed brain room)
- `src/lib/brain/infinityVoice.ts` (new — `speechSynthesis` wrapper)
- `src/pages/BrainUniverse.tsx`
  - Gate render with `BrainEntryModal` when prefs/ready missing
  - Use registry-driven mass for self body
  - Mount `<PersistentAudioLayer roomId={BRAIN_ROOM_ID} />`
  - Use `useBrainVoice()` and add HUD mic + voice toggle + voice count
  - Call `speakInfinity()` on Infinity replies
  - Place remote-peer avatars on Earth surface via `spawnOnEarth(peerId, pose)` if no physics body exists
- `src/pages/AboutNetwork.tsx`, `src/pages/Profile.tsx` — change "Enter the Brain" buttons to open `BrainEntryModal` instead of direct navigate (or trust the in-page gate; either path is safe — pick the latter to keep diffs minimal).

### Why this is the right cut

- **Reuses every existing primitive.** `AvatarSelector`, `DeviceCheckStep`, `WebRTCManager`, `PersistentAudioLayer`, signaling bridge, `spawnOnEarth(pose)`, `getAvatarMass` — all already in the codebase. No new transport, no new signaling.
- **Voice chat is just another room.** `BRAIN_ROOM_ID` is a string; the WebRTC stack doesn't care it's the brain. Audio works the same as streaming rooms — same shared `AudioContext`, same persistence layer.
- **Avatar mass is the real coupling to physics.** Dragon (2.6) is heavier → slower, harder to fly off Earth, exactly as the rotation-aware Earth pass intends. Rabbit (1.0) stays nimble.
- **Infinity becomes audible without a backend.** `speechSynthesis` is local, free, and works offline — same philosophy as the rest of the app.
- **No regressions to the field.** Voice chat is a parallel channel; physics, UQRC pins, and chat-text → field injection are unchanged. Voice perturbs the field via the *speaking pulse* visual, not the field engine, so it can't destabilise the lattice.

### Acceptance

```text
1. AVATAR_REGISTRY contains rabbit (mass 1.0, default) and dragon (mass 2.6); rabbit stays the unlocked default.
2. Visiting /brain without prior prefs renders BrainEntryModal: avatar step, then mic test step. "Enter" button is disabled until mic permission granted.
3. saveHubPrefs persists { avatarId, audioInputId, audioOutputId } shared with virtual hubs.
4. Self body spawns with mass = getAvatarMassFromId(prefs.avatarId). Choosing dragon is visibly slower than rabbit (top speed cap halves vs sqrt(2.6)).
5. On entry, useBrainVoice joins room "brain-universe-shared" with audio-only stream from prefs.audioInputId. PersistentAudioLayer mounts.
6. Two browsers entering /brain with mic permission can hear each other through the room. Mute button in HUD toggles local audio track.
7. HUD shows "voice: N" with the live participant count (self + remotes).
8. Sending a chat message that mentions infinity / imagination still appends Imagination's reply line AND speaks it via window.speechSynthesis (when voice toggle on).
9. Voice toggle (Volume2/VolumeX) in HUD persists to prefs and silences future TTS without breaking chat text.
10. Leaving (back button or unmount) calls leaveRoom + stopLocalStream + cancelInfinity — no orphaned tracks, no lingering speech.
```

