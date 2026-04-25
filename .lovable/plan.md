# Mic & Camera Re-Entry Fix — IMPLEMENTED 2026-04-25

## Bug
On exit from `/brain` or a project universe, the mic stream was killed with
`track.stop()` — permanent. On re-entry permissions were still granted but
peer senders held dead-track references, no renegotiation fired, and no one
heard the user. Same code path for `/brain` and project universes (they
share `BrainUniverseScene` + `useBrainVoice`, only `roomId` differs).

## Fix Applied
1. **`src/lib/webrtc/manager.ts`**
   - `startLocalStream` now drops a fully-ended cached stream before
     re-acquiring, and treats senders carrying ended tracks the same as
     empty senders — replaceTrack + force renegotiation.
   - New `refreshLocalStream(audio, video, deviceIds?)` helper.
   - New `hasLiveAudioTrack()` predicate.
2. **`src/hooks/useBrainVoice.ts`**
   - Cleanup mutes the track instead of stopping it. Stream survives route
     exits and universe hops; peer senders stay valid.
   - On enter, if a live audio track exists, just unmute — no second
     getUserMedia (which browsers would auto-mute without a fresh gesture).
3. **`src/components/brain/BrainUniverseScene.tsx`**
   - Camera toggle uses `refreshLocalStream` when existing stream has any
     dead track, guaranteeing renegotiation.
   - Gesture-fallback toast: if browser auto-muted the re-acquired mic,
     "Tap anywhere to enable your mic" → next click calls `refreshLocalStream`
     inside a valid gesture.
