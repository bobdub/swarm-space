# Make remote Brain screen sharing actually deliver

## Confirmed diagnosis

The published repair does not complete the start path:

- `publishScreenStream()` attaches the screen track and requests an offer, but never sends `screen-share-state: active`. The only active announcement is incorrectly placed in room creation, before a screen is necessarily being shared; stopping does announce correctly.
- Directed offer/answer delivery can fail silently. The mesh `send()` resolves `false` when no direct edge exists, while the signaling bridge only falls back to broadcast when the promise rejects. A resolved `false` therefore drops the renegotiation without retry or visible failure.
- Incoming offer handling is launched without an error boundary. The observed “fewer m-sections” failure can abort screen renegotiation without rebuilding the mismatched peer connection.
- Existing negotiation tests do not model transceivers or screen tracks, so they can pass without proving that another user receives a shared display.

## Repair

1. **Make signaling delivery truthful**
   - Treat both a rejected send and a `false` result as delivery failure, then broadcast the directed envelope as fallback.
   - Apply this consistently to offers, answers, reconnect messages, room sync, and screen-share state.

2. **Announce the real screen lifecycle**
   - Send the active announcement only after a captured track is attached to peer senders.
   - Keep the stop announcement where sharing ends.
   - Replay active state to peers that join or reconnect while sharing is already underway.

3. **Recover failed screen negotiation**
   - Catch remote offer/answer failures at the signaling boundary.
   - If the peer connection has incompatible media sections, close and recreate that one connection with the fixed audio/camera/screen slot order, then issue one clean offer.
   - Preserve the microphone stream and captured screen through this peer-only rebuild.

4. **Add an arrival acknowledgement**
   - When the viewer receives the dedicated screen track, send a directed acknowledgement to the sharer.
   - If the sharer gets no acknowledgement after the start announcement, retry once with a clean peer negotiation instead of leaving a local-only tile.
   - Record concise diagnostics for attachment, offer delivery, remote track classification, acknowledgement, and recovery.

5. **Prove the remote path**
   - Add tests with realistic transceiver slots and two connected managers: start share, deliver offer/answer, receive the remote screen track, preserve it through mute/unmute, and remove it on stop.
   - Test the resolved-`false` mesh-send fallback and the mismatched-media-section rebuild.
   - Run the focused WebRTC tests, type checks, and a two-session browser check where one user shares and the other opens the remote tile while voice remains live.

## Technical scope

Primary files: `src/lib/webrtc/manager.ts`, `src/lib/streaming/webrtcSignalingBridge.standalone.ts`, `src/lib/webrtc/types.ts`, and WebRTC tests. The screen tile design and capture permission flow remain unchanged.
