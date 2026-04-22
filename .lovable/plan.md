

## Fix Brain: shared chat, visible avatars, true Earth spawn, mandatory entry gate

Four targeted fixes — each addresses one of the four reports.

### 1. Chat is local-only — broadcast it through the WebRTC data layer

`handleSend` only calls `setChatLines(...)` locally. There is no peer broadcast at all, so other users never see your messages. Infinity replies are also gated behind a keyword regex (`/infinity|imagination|orb|brain/i`), so casual chat seems "dead" to users.

**Fix:**
- Extend `useBrainVoice` to expose `sendChatLine(line)` and `onChatLine(handler)`. Use `WebRTCManager.broadcastMessage` (already exists) with a new envelope `{ type: 'brain-chat', roomId, line }`. The manager's `messageHandlers` set already fans these out to every peer subscriber on the room.
- In `BrainUniverse.handleSend`: after appending locally, call `sendChatLine(line)`. Subscribe via `onChatLine` to append remote lines to `chatLines` (dedup by `id`).
- Loosen Infinity trigger: respond when the message starts with `@infinity` / `@imagination` *or* contains those words *or* ends with `?`. Keep the existing keyword path for back-compat. So chat actually feels two-way for any reasonable input.

This reuses the existing room (`brain-universe-shared`) — no new transport, no new signaling.

### 2. Remote avatars are never rendered

`BodyLayer` only spawns meshes for `kind === 'piece'`. Voice peers from `useBrainVoice().participants` are not added as physics bodies and not rendered. `RemoteAvatarBody.tsx` exists but is unused.

**Fix:**
- New `useEffect` in `BrainUniverse` keyed on `voicePeers`: for every participant `p` not already in physics, call `physics.addBody({ id: 'peer-' + p.peerId, kind: 'avatar', pos: spawnOnEarth(p.peerId, getEarthPose()), vel: [0,0,0], mass: 1.8, trust: 0.5 })`. On peer-leave, `removeBody`.
- Extend `BodyLayer` with a render path for `kind === 'avatar'`: a capsule mesh (or use existing `RemoteAvatarBody`) positioned from `b.pos`, with a small floating label = `participant.username`. Speaking pulse driven by `p.stream` is optional (skip for now — shipping voice + visibility first).
- Remote avatars also benefit from the rotation-aware integrator that already exists, so they ride Earth's surface naturally.

Result: when User B joins, User A sees their capsule on Earth's surface and hears them.

### 3. "Still spawn in space" — camera default shows stars before the body lands

Two real causes:
- The Canvas mounts with `camera={{ position: [0, 1.6, 5], fov: 70 }}` — world origin. Earth is at `[12, 0, 4.5]`. For the first frame (or until physics produces the self body, ~50 ms after `getCurrentUser` resolves), the camera looks at empty space.
- `PhysicsCameraRig` only updates the camera when `physics.getBody(selfId)` returns a body. If `selfId` is `''` (initial state) the rig's effect doesn't apply.

**Fix:**
- Initialise the Canvas camera at the live Earth surface foot computed at boot: `getEarthPose().center + outwardNormal·(EARTH_RADIUS + 1.6)`, with the outward normal pointing along the spawn direction for `selfId` (or toward `+y` if not yet known). Pass via `camera={{ position: [...], fov: 70 }}` using a tiny helper.
- In `PhysicsCameraRig`: if `selfId` is empty, *still* project the camera to the live Earth surface using the spawn direction for the candidate `id` (the random `guest-xxxx` is determined synchronously, so we can compute it once at mount and use it for the camera before physics produces the body).
- Add a one-shot "ground snap" on the first frame after the body appears: set `camera.position` to surface foot, no easing. Eliminates the orbital-slingshot moment users perceive as "I spawned in space".

### 4. Some users don't get the avatar/mic setup on the published site

Today the gate is bypassed in two ways:
- `?ready=1` in the URL.
- Any non-empty `localStorage['swarm-virtual-hub-prefs']` (returning visitors from Virtual Hub *or* the Brain). On the published deploy, anyone who used Virtual Hub previously skips the Brain gate entirely and never sees the mic prompt.

**Fix:**
- Replace the bypass condition with an explicit, Brain-specific completion flag: `localStorage['brain-entry-complete']` = `{ avatarId, audioInputId, hasMic, ts }`, set only by `BrainEntryModal.handleEnter`. Virtual-Hub prefs are still *seeded* into the modal as defaults, but they no longer skip the gate.
- Remove the `?ready=1` shortcut for first-time Brain visits. (Keep it only as a session-level "I just confirmed in this tab" flag, written by `handleEnter`, so navigating away and back inside the same session doesn't re-prompt.)
- `BrainEntryModal` already disables "Enter the Brain" until `permissionGranted === true` (via `DeviceCheckStep.onPermissionGranted`). Confirm that `DeviceCheckStep` reports `false` if the user denies the prompt or if `getUserMedia` throws `NotAllowedError`, so the gate cannot be bypassed by clicking Enter without granting mic.
- Make the modal **mandatory** on `/brain`: when the user clicks Cancel, navigate back to `/` instead of allowing them onto the page (today `navigate(-1)` is already in `onOpenChange` — keep that path, but also gate the `Canvas` render on `ready === true` so even if the modal is dismissed via ESC nothing renders).

### Files

- `src/hooks/useBrainVoice.ts` — add `sendChatLine(line)` and `onChatLine(handler)` using `manager.broadcastMessage` + `manager.onMessage` filtered by `type === 'brain-chat'` and `roomId === BRAIN_ROOM_ID`. Re-export `BRAIN_ROOM_ID` already done.
- `src/lib/webrtc/types.ts` — extend `VideoRoomMessage` union with `{ type: 'brain-chat'; roomId: string; line: BrainChatLine }`.
- `src/pages/BrainUniverse.tsx`
  - In `handleSend`: also `sendChatLine(line)`; loosen Infinity trigger to also fire on `@infinity` / `@imagination` / messages ending in `?`.
  - Subscribe to `onChatLine` and append remote lines (dedup on `id`).
  - On `voicePeers` change: add/remove `kind: 'avatar'` bodies via `spawnOnEarth(peerId, getEarthPose())`.
  - Camera: initial position computed from `getEarthPose() + spawnOnEarth(candidateId)` so first paint is on the surface; first-frame ground-snap inside `PhysicsCameraRig` once the self body appears.
  - Gate: read `brain-entry-complete` flag (not virtual-hub prefs); render `<Canvas>` only when `ready === true`.
- `src/components/brain/BrainEntryModal.tsx` — on `handleEnter`, additionally write `localStorage['brain-entry-complete'] = JSON.stringify({ avatarId, audioInputId, ts: Date.now() })` and a sessionStorage `brain-ready=1`. Cancel → `navigate(-1)` (already wired by parent).
- `src/components/brain/BodyLayer` (inside `BrainUniverse.tsx`) — add render branch for `kind === 'avatar'` (capsule + label). Or extract to use existing `src/components/brain/RemoteAvatarBody.tsx`.
- `src/components/virtualHub/DeviceCheckStep.tsx` — verify `onPermissionGranted(false)` is fired on `NotAllowedError`; tighten if not (read-only check; only patch if necessary).

### Why this is the right cut

- **No new transport.** Chat reuses the WebRTC room already joined for voice. One subscribe path, one broadcast path.
- **No new physics.** Remote avatars are just bodies with `kind: 'avatar'`; the rotation-aware integrator already handles them.
- **No new gate component.** We tighten the existing gate's bypass condition rather than adding a wrapper.
- **Camera fix is purely render-side**: no field changes, no spawn changes — just project the camera onto Earth from frame 1 instead of waiting on physics.

### Acceptance

```text
1. Two browsers on /brain in the same workspace see each other's chat lines (within ≤500 ms) without refresh, after both pass the entry gate.
2. Chat lines from remote peers appear with the sender's username/short id; local echoes are de-duplicated by line.id.
3. A message of "hi", "hello?", or "@infinity glow" all elicit an Infinity reply (text + optional TTS). Keyword-only input still works.
4. Each remote voice participant is rendered as a capsule on Earth's surface with a name label; the capsule moves with Earth's rotation.
5. From the moment the Canvas mounts, the camera shows the Earth surface — never the empty world origin or interstellar space.
6. After an unauthenticated guest hits /brain on the published site, the BrainEntryModal opens unconditionally, even if `swarm-virtual-hub-prefs` already exists in localStorage.
7. Cancelling the modal navigates away from /brain; clicking Enter without granting mic permission is impossible (button stays disabled).
8. Subsequent visits in the same browser session skip the modal (sessionStorage `brain-ready=1`); a new session re-shows it unless `brain-entry-complete` exists, in which case it shows briefly only if mic permission is no longer granted.
9. No regressions: existing earth.test.ts, uqrcConformance.test.ts, brain integration tests still pass.
10. Mobile 360×560: chat panel still readable, mic toggle still functional, remote avatars visible without tanking FPS.
```

