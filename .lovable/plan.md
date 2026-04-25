# Mic & Camera Re-Entry Fix (Brain + Project Universes)

## The Bug

When a user leaves `/brain` **or a project universe** and returns — or hops between universes:
1. Mic permissions are still granted (no re-prompt) ✓
2. But no one can hear them — voice never reaches peers ✗
3. Camera (untested) almost certainly has the same issue ✗

Both `/brain` and `/virtual-hub/:project` route through the **same** `BrainUniverseScene` + `useBrainVoice(enabled, roomId)` code path — only the `roomId` differs (`brain-universe-shared` vs `brain-project-${id}`). The fix applies uniformly to both, and additionally covers the **universe-to-universe hop** case where `roomId` changes (e.g. global Brain → project universe → global Brain).

## Root Cause (three compounding problems)

**1. Tracks are killed on exit, but peer connections survive.**
`useBrainVoice` cleanup calls `manager.stopLocalStream()` which runs `track.stop()` on every audio track. `stop()` is **permanent** — the track object is dead forever. The `RTCPeerConnection`s and their `RTCRtpSender`s are preserved (only the room is left, not the mesh).

**2. The re-entry "replaceTrack" path silently skips renegotiation.**
On re-entry, `startLocalStream()` correctly calls `getUserMedia` again, then walks every existing peer connection looking for a sender to replace the track on (`manager.ts` lines 472–508). The bug: the existing sender still references the **dead track** (a stopped track is still truthy), so `existingSender && !existingSender.track` evaluates **false**, the branch is skipped, and `addedTrack` is never set. **No offer is sent. Peers never learn about the new SSRC.** Audio packets flow into a dead sender forever.

**3. Camera-on path triggers the same dead-sender problem for video.**
`toggleCamera` calls `startLocalStream(true, true)`; on a re-entry where audio already "exists" as a dead track, video gets the same silent-no-renegotiation treatment.

A secondary contributor (per stack-overflow guidance): re-entry happens via React Router navigation with no fresh user gesture, so in Brave/Firefox/Safari the new `getUserMedia` may resolve a track that is technically live but immediately `muted` by the browser until interaction.

## The Fix

### 1. `src/lib/webrtc/manager.ts` — make `startLocalStream` resilient to dead senders
- In the re-acquisition path, treat any sender whose `track.readyState === 'ended'` the same as a sender with no track: always `replaceTrack(newTrack)` and always set `addedTrack = true` so renegotiation fires.
- Guard at the top: if `this.localStream` exists but **all its tracks are ended**, drop it (`this.localStream = null`) and fall through to the first-time-create branch.

### 2. `src/lib/webrtc/manager.ts` — add `refreshLocalStream(audio, video, deviceIds?)`
A single deterministic entrypoint that:
1. Stops & nulls any existing local stream
2. Calls `startLocalStream` fresh
3. Renegotiates with every connected peer
Used by callers that explicitly want fresh tracks (camera toggle, gesture-fallback retry).

### 3. `src/hooks/useBrainVoice.ts` — preserve the stream across exit / room-hop
- **On cleanup** (route exit OR `roomId` change), do NOT call `stopLocalStream()`. Just `manager.toggleAudio(false)` to mute the live track. The mesh and peer-senders stay; on re-entry we just `toggleAudio(true)` — zero re-acquisition needed.
- **On enter**, if `manager.getLocalStream()` exists with a `live` audio track, just unmute it. Only call `startLocalStream` if no live track is present. This eliminates the entire dead-track failure mode on warm re-entry.
- This also fixes the **universe-hop** case: hopping `/brain` → project universe → `/brain` now keeps the same live mic track throughout, only the room membership changes.

### 4. `src/components/brain/BrainUniverseScene.tsx` — camera toggle uses `refreshLocalStream`
The "camera on" branch routes through the new `refreshLocalStream` helper when an existing stream has dead video senders, guaranteeing a renegotiation. The explicit user-driven "camera off" branch keeps its current `track.stop()` + `removeTrack` behavior (that's correct for explicit teardown).

### 5. Browser-gesture safety net
After re-entry, if the audio track surfaces with `track.muted === true` (browser auto-muted for missing gesture), surface a small toast: **"Tap anywhere to enable your mic."** On the next document click, call `refreshLocalStream`. Most users won't hit this because fix #3 reuses the live track — it's the cold-reload fallback.

## Files Modified

- `src/lib/webrtc/manager.ts` — dead-sender detection + new `refreshLocalStream` method
- `src/hooks/useBrainVoice.ts` — preserve stream across exit and room-hop; mute/unmute instead of stop/restart
- `src/components/brain/BrainUniverseScene.tsx` — camera toggle uses `refreshLocalStream`; gesture-fallback toast wiring

## Expected Outcome

- **Exit Brain or project universe** → mic mutes, stream stays alive, peer senders stay valid
- **Re-enter same universe** → instant unmute, "I'm back" is heard immediately, no re-prompt, no renegotiation
- **Hop between universes** (Brain ↔ project) → seamless, same live track, only room membership changes
- **Cold reload re-entry** → fresh `getUserMedia` succeeds; dead-sender-aware code forces renegotiation so peers actually receive the new SSRC
- **Camera on/off across exits** → behaves identically to mic
