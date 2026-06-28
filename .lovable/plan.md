
# Fix: Live chat room — peers can't see/hear each other

## Root cause

The Brain room works (peers hear each other) because `useBrainVoice` calls `startLocalStream` BEFORE `joinRoom`. By the time offers are exchanged, the upfront `sendrecv` transceivers already carry the local mic track, so the remote SDP advertises the SSRC and the other side plays audio.

Live rooms use `useLiveRoomMedia`, which is intentionally "spectator first" and does NOT acquire mic/camera on mount. The signaling sequence becomes:

1. Both peers join → upfront transceivers are `sendrecv` but `sender.track === null`.
2. Initial offer/answer completes with no audio/video SSRCs.
3. User clicks "Mic on" later → `startLocalStream` tries to slot the new track into an existing transceiver, then renegotiate.

Step 3 is where it breaks:

- The matcher in `startLocalStream` (manager.ts ~543) finds the upfront transceiver by `t.receiver.track?.kind === track.kind`. Pre-negotiation, `receiver.track` is **null**, so the matcher misses the upfront slot, falls through to `existingSender` (also null kind), then falls through to a fresh `addTrack`. That creates a duplicate m-section AND the renegotiation is only triggered by `onnegotiationneeded`, which is then deferred or eaten by the glare lock (`negotiationLock` / `MAX_NEGOTIATION_RETRIES`). Console shows repeated "Recovery attempt 2/3" — the late tracks never make it to the wire.
- Even when the track does land, the impolite-peer glare branch defers re-offer by 500 ms but only once; if the lock is still held (it often is during simultaneous mic-on by both users) the offer is silently dropped.

Result: every live participant sees only their own preview tile and hears no one.

Secondary issues feeding the same symptom:

- `LivePostPreview` and `LivePostBoxBody` both mount for the same room (inline post + auto-popped dock), each binds its own `<audio>` element pool to the participant stream, and each runs a poll/refresh loop. Harmless for video, but the duplicate audio elements + duplicate `joinRoom` calls create noise that obscures the real failure.
- `room-sync` path (manager.ts ~85) no longer creates offers for the newcomer (correctly), but `join-room` only fires when the mesh roundtrip actually delivers — if a peer joined before mesh signaling was ready, no offer is ever created and there is no resync trigger.

## Fix

### 1. Eager media acquisition for active live-room participants

`src/hooks/useLiveRoomMedia.ts`
- Add a new option `eagerMic?: boolean` (default `false` to keep spectator semantics).
- When `eagerMic` is true, after `joinRoom` succeeds, call `manager.startLocalStream(true, false)` immediately (mirroring `useBrainVoice`). Failures are non-fatal — fall back to the toggle path.
- Always re-broadcast a fresh offer to every peer after a successful first-time mic acquisition (covered by fix #2).

`src/components/streaming/LivePostBoxBody.tsx`
- Pass `eagerMic` = true for the host (`isHost`) and for anyone who entered via "Participate Live" (already represented by being mounted in the floating dock — the dock body is the active surface, the inline preview stays passive).
- Acquisition stays gated behind a user gesture: the dock is opened by clicking Pop out / Open chat, so it counts as a gesture.

`src/components/streaming/LivePostPreview.tsx`
- Stays passive (spectator). No eager mic.

### 2. Fix late-track renegotiation in `WebRTCManager.startLocalStream`

`src/lib/webrtc/manager.ts`
- Replace the receiver-kind heuristic with an **ordered transceiver lookup**: `pc.getTransceivers()[0]` is the audio slot, `[1]` is the video slot (both created upfront in `createPeerConnection`). Verify by checking `transceiver.sender.getParameters().codecs` is empty or by tagging the slot via `mid` after first negotiation; the index-based approach is sufficient because we control transceiver creation order.
- Both the warm-stream branch (~478) and the first-time-stream branch (~536) use the same helper.
- After `replaceTrack` on a previously-empty slot, **always** call `createOfferForPeer(peerId)` directly (do not rely solely on `onnegotiationneeded`) and reset the per-peer retry counter so the offer cannot be eaten by `MAX_NEGOTIATION_RETRIES` previously triggered by recovery loops.

### 3. Make the negotiation lock self-healing

`src/lib/webrtc/manager.ts` (`createOfferForPeer`)
- When a fresh track addition fires `createOfferForPeer` and the lock is held, set `negotiationNeeded` AND schedule a watchdog (1500 ms) that clears the lock if no offer was sent in that window, then retries. Prevents the "stuck lock after recovery" state visible in current console logs (`Recovery attempt 2/3 for peer-…`).
- In the impolite-glare branch (~227): instead of a one-shot 500 ms re-offer, queue via `negotiationNeeded` so the drain loop on `finally` (line 195) handles it consistently.

### 4. Add a join-room retry / re-hello for late mesh

`src/hooks/useLiveRoomMedia.ts`
- After `joinRoom`, send `helloRoom` at 0 ms, 1.2 s, 3.5 s, **and** 7 s (already partially there) — keep this.
- On every `peer-joined` event for our room, if we have a local track and no `RTCPeerConnection` exists yet for that peer, call `manager.ensureOfferToPeer(peerId)` (a new public wrapper around `createOfferForPeer` that bypasses the retry cap). This recovers the "joined before signaling was ready" case.

### 5. Consolidate spectator audio rendering

- Remove the inline `<audio>` rail from `LivePostPreview.tsx` (lines ~439–446). Audio playback for the room comes from a single source.
- Use the existing `PersistentAudioLayer` keyed by `roomId` and mount it once at the app root for the active live room (same pattern as Brain). This eliminates duplicate `srcObject` rebinds that can interrupt playback.

### 6. Verification

Three browser contexts on the published preview, same live room:
- Host (creator) → mic auto-acquires; broadcasting badge shows "Broadcasting".
- Spectator A clicks Participate Live (in dock) → toggles mic → host AND spectator B hear them within ~1 s.
- Spectator B keeps mic off → hears both, sees both video tiles if cameras enabled.
- Kill one PC via devtools → `Resync` button on the tile restores audio/video without a page reload.
- Confirm console no longer shows repeating "Recovery attempt N/3" loops.

Add a regression test under `src/lib/webrtc/__tests__/negotiationLoop.test.ts` covering: late mic acquisition on an empty transceiver triggers exactly one offer and the offer's SDP contains an `a=ssrc` line for audio.

## Out of scope

- Spectator-first semantics for feed previews (unchanged).
- Signaling protocol rewrite, room discovery changes, UQRC.
- Brain voice path (`useBrainVoice`) — already works; leave untouched.
