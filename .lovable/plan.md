

# Plan: Streaming Stability, Remote Video, and Gun.js Call Recovery

## Issues

1. **Call drops from stream collision** — Renegotiation glare (both peers send offers simultaneously) and immediate peer removal on `disconnected` state
2. **Host recording not in content distribution** — Recording seed event fires but torrent swarm may not be listening; needs verification and fallback
3. **No remote video display** — `LiveStreamControls` renders remote streams as hidden `<audio>` elements only; no video grid exists
4. **No reconnection on drop** — When `connectionState` hits `disconnected`/`failed`, the peer is removed with no recovery attempt

---

## 1. Fix call drops from renegotiation glare

**File: `src/lib/webrtc/manager.ts`**

- Add a `negotiationLock` map per peer to prevent simultaneous offer creation. If a peer is already mid-negotiation, queue the renegotiation instead of firing immediately.
- In `createPeerConnection`, attach `onnegotiationneeded` with a polite/impolite peer model: the peer with the lexicographically smaller ID is "polite" and rolls back on glare; the other is "impolite" and ignores incoming offers during its own negotiation.
- Change `handleRemoteOffer`: if `signalingState !== 'stable'`, rollback local description before applying the remote offer (polite peer behavior).
- Remove the immediate `removePeer` call on `disconnected` state — only remove on `failed` after recovery attempt (see item 4).

## 2. Fix recording not appearing in content distribution

**File: `src/lib/p2p/torrentSwarm.standalone.ts`**

- Verify the `torrent-seed-file` event listener exists. If not, add a `window.addEventListener('torrent-seed-file', ...)` handler that calls `seedFile()` with the provided File blob.
- This ensures the recording blob from `StreamingRoomTray` is actually ingested by the torrent system and appears in the Content Distribution panel.

**File: `src/components/streaming/StreamingRoomTray.tsx`**

- After dispatching `torrent-seed-file`, also directly call the swarm mesh's IndexedDB manifest write as a fallback, so the file appears even if the event listener isn't active yet.

## 3. Add remote peer video grid

**File: `src/components/streaming/LiveStreamControls.tsx`**

- Below the local video preview, add a responsive grid showing each remote participant's video stream.
- Each cell renders a `<video>` element bound to `participant.stream`, with the participant's username overlay and mute indicator.
- If `participant.stream` has no video tracks, show a `CameraOff` placeholder with the participant's name.
- Keep the existing hidden `<audio>` elements as a fallback for audio-only participants.
- Grid layout: 1 column for 1 peer, 2 columns for 2-4 peers; each cell is `aspect-video`.

## 4. Gun.js call recovery manager

**File: `src/lib/webrtc/manager.ts`**

- Replace the immediate `removePeer` on `disconnected`/`failed` with a recovery flow:
  1. On `disconnected`: start a 10s timer. If the connection doesn't return to `connected` within 10s, attempt Gun.js recovery.
  2. Gun.js recovery: send a `reconnect-request` signal via the mesh signaling bridge to the dropped peer. If both peers are still in the room, re-initiate the WebRTC handshake (new offer/answer exchange via Gun relay).
  3. On `failed`: immediately attempt one Gun.js recovery cycle. If the new handshake fails within 15s, then call `removePeer`.
- Add a `reconnectionAttempts` map to limit retries to 3 per peer per session.
- Add `reconnect-request` and `reconnect-ack` message types to the signaling bridge.

**File: `src/lib/streaming/webrtcSignalingBridge.standalone.ts`**

- Add `reconnect-request` and `reconnect-ack` to the `SignalEnvelope.msgType` union.
- When a `reconnect-request` is received, the recipient tears down its stale `RTCPeerConnection` and sends back a `reconnect-ack`, after which the requester creates a fresh offer.

**File: `src/lib/webrtc/types.ts`**

- Add `'reconnect-request' | 'reconnect-ack'` to `VideoRoomMessage.type`.

---

## Files Modified

| File | Changes |
|------|---------|
| `src/lib/webrtc/manager.ts` | Negotiation lock, polite/impolite model, recovery flow, reconnection logic |
| `src/lib/streaming/webrtcSignalingBridge.standalone.ts` | Add reconnect-request/ack message types |
| `src/lib/webrtc/types.ts` | Add reconnect message types |
| `src/components/streaming/LiveStreamControls.tsx` | Add remote peer video grid below local preview |
| `src/lib/p2p/torrentSwarm.standalone.ts` | Add `torrent-seed-file` event listener |
| `src/components/streaming/StreamingRoomTray.tsx` | Fallback manifest write for recording seeding |

