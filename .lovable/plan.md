## Problem

Audio is asymmetric across three peers: Peer C hears both A and B, Peer A hears only one of them, Peer B hears both. The previous fix improved over "no one hears anyone" but still leaves directional gaps. Combined with the console showing repeated "Negotiation of connection to peer-… failed" and a tight queued-renegotiation cycle, this is a **negotiation race** rather than a media-routing bug.

## Root cause (technical)

In `src/lib/webrtc/manager.ts`:

1. **`createOfferForPeer` re-queues but never retries when the queue drains in a non-stable state.** Lines 167-174:
   ```ts
   if (pc.signalingState !== 'stable') {
     this.negotiationQueue.set(meshPeerId, true);
     return;   // ← bails inside the try, so the finally drains the queue with a 250ms retry
   }
   ```
   The `finally` block drains it once. If the second attempt also lands while not-stable, the queue is set, the function returns, finally runs, and *re-drains again* — but if at that 250ms mark the state is **still** non-stable (still mid-answer), the loop terminates and the late mic track never gets advertised. This is exactly the asymmetry pattern: the peer who enabled audio last loses one direction.

2. **No "needs-renegotiation" flag.** Once we've abandoned an offer attempt, nothing remembers that the peer hasn't yet been told about our new track. The next renegotiation only happens if a new track is added or the connection state cycles through `failed`.

3. **`replaceTrack` on the upfront sendrecv transceiver does require an offer/answer the first time** in practice — Chromium does NOT auto-renegotiate on `replaceTrack`, but the previously negotiated SDP advertised an `inactive`/no-track sender; the remote needs the new SSRC to actually decode RTP. So the previous-previous fix (forcing `renegotiate = true`) was correct in spirit; the bug is that the negotiation gets dropped on the floor when glare hits.

4. **Glare resolution is asymmetric**: lines 204-214, the *impolite* peer ignores the incoming offer entirely. If the impolite peer was the one with the late-added mic, they never re-offer either, and the polite peer never learns about their audio SSRC.

## Fix

### Change `src/lib/webrtc/manager.ts`

1. **Replace queue-once with a `negotiationNeeded` flag**:
   - Add `private negotiationNeeded = new Map<string, boolean>();`
   - In `createOfferForPeer`, when state is non-stable OR another offer is in-flight, set `negotiationNeeded.set(peerId, true)` and return.
   - In the `finally`, drain via:
     ```ts
     if (this.negotiationNeeded.get(meshPeerId)) {
       this.negotiationNeeded.delete(meshPeerId);
       setTimeout(() => void this.createOfferForPeer(meshPeerId), 300);
     }
     ```
   - Remove the old `negotiationQueue` map.

2. **After resolving glare on the impolite side, schedule a follow-up offer** so the late local track still gets advertised:
   ```ts
   if (!polite) {
     console.log(`[WebRTC] ⚡ Glare — impolite, ignoring incoming offer; will re-offer`);
     this.negotiationNeeded.set(meshPeerId, true);
     // Drain after current cycle stabilises
     setTimeout(() => void this.createOfferForPeer(meshPeerId), 500);
     return;
   }
   ```

3. **Use the standard `onnegotiationneeded` event** as a backstop. Inside `createPeerConnection`:
   ```ts
   pc.onnegotiationneeded = () => {
     if (!this.currentRoomId) return;
     void this.createOfferForPeer(peerId).catch(err =>
       console.warn('[WebRTC] negotiationneeded offer failed:', err));
   };
   ```
   This catches the case where `replaceTrack` or `addTrack` legitimately needs a renegotiation that our manual paths missed.

4. **Stop firing manual renegotiation** from `startLocalStream` / `startScreenShare` whenever `onnegotiationneeded` will fire. Replace the explicit `void this.createOfferForPeer(peerId)` calls in lines 416-420, 484-488, 519-523 with a single comment — the browser's `negotiationneeded` event will trigger our handler. (Keep the manual call only as a safety net behind a 1s debounce.)

5. **Make the disconnect grace period log-aware**: when a recovery cycle starts because of a one-way audio failure (ICE connected but media flow broken), the current code waits 10s then tears the connection down. That's fine — but ensure `attemptRecovery` clears `negotiationNeeded` for that peer so the fresh PC starts clean.

### No changes needed elsewhere

- `PersistentAudioLayer.tsx` is correct — once `participant.stream` carries the audio track and an offer/answer round-trip with the correct SSRCs has completed, audio plays.
- Signaling bridge is fine; the issue is local negotiation discipline, not transport.

## Files to modify

- `src/lib/webrtc/manager.ts`

## Acceptance

- Three peers in one room with mics on → all three hear all others within ~3s of the last one joining.
- Console shows at most one "Glare detected" per peer-pair, followed by a successful re-offer (no infinite "Negotiation … failed" loops).
- Toggling mute/unmute does not break audio for any direction.
