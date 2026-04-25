# `/brain` mutual-visibility race — lightspeed measurement + fix

## 𝒞_light(Δt) — measured drift

I traced the round-trip from "open Brain" → "see other avatar". The race is **not** in P2P (the prior fix landed; Gun + mesh come up promptly). The drift is one shell up, in the **room-join announcement**.

```text
t0   User A inside /brain.  joinedRooms = {brain-universe-shared: {A}}
t0   User B outside /brain.  Mesh: A↔B already connected.
t1   B navigates to /brain.
     useBrainVoice(enabled=true) fires.
     manager.joinRoom(BRAIN_ROOM_ID)
       → announceJoinRoom() → mesh.broadcast(SIGNAL_CHANNEL, 'join-room')
     A receives 'join-room', adds B to its room set, sends 'room-sync' back.
     Both sides emit 'peer-joined' → SDP offer/answer → audio + presence flow.
     ✅ This path works.

t1'  Alternative: A enters /brain BEFORE the A↔B mesh edge exists
     (cold load, /brain is the landing route, mesh still warming).
     announceJoinRoom() broadcasts to ZERO peers.
     joinedRooms.set('brain-…', {A}) locally — fine.
     Mesh edge A↔B forms ~2-5s later.
     Neither side ever re-announces. A's join-room packet is GONE.
     B's UI never learns A is in the room → no offer, no presence,
     no Brain.spawn for A on B's screen.
     ❌ This is the race the user reported.
```

Symptoms match exactly:

- "logged on, automatically entered the brain, did not find each-other" → both joined before the mesh edge existed; join-room evaporated into an empty broadcast.
- "exited the brain and connected within seconds" → leaving cancels the room and the mesh edge stabilises.
- "went back into the brain → worked" → second `joinRoom` happens against a warm mesh, so the broadcast actually reaches peers.

The drift is a classic **one-shot announcement on an unreliable transport**. `announceJoinRoom` and `sendRoomPresence` both use `mesh.broadcast`, which is a fan-out over *currently connected* peers — peers that join the mesh later receive nothing.

## Fix — three small, targeted edits

All in the signaling bridge + voice hook. No physics, no UI, no transport rewrites.

### 1. Re-announce join on mesh expansion

In `src/lib/streaming/webrtcSignalingBridge.standalone.ts`, when a new peer connection forms, replay every locally-joined room's `join-room` envelope **directed at that peer** (not a re-broadcast). The bridge already keeps `joinedRooms` per local node — iterate it and `meshRef.send(SIGNAL_CHANNEL, newPeerId, …)` one envelope per room.

Hook point: subscribe to the same source SwarmMesh already exposes for "peer connected" (the bridge attaches via `meshRef` in `attachSignalingBridge`; add a one-line listener there).

### 2. Replay last-known presence to new peers

Same listener: for each entry in `roomPresenceLog` whose `peerId === myPeerId` (i.e. our own most recent presence broadcast for any room we're in), re-send it directed to the new peer. This is what gives the new peer our avatar/position **without** waiting for the next 1.5 s broadcast tick.

### 3. Pull-on-join: ask for room state when *we* learn of a new room edge

When `useBrainVoice` runs `manager.joinRoom(BRAIN_ROOM_ID)`, also fire a small `room-hello` envelope after a 250 ms delay; receivers reply with `room-sync` + their cached presence for that room. This covers the symmetric case where *they* were already in the room when we arrived but their original `join-room` is long gone from the wire.

`room-hello` is one new envelope type in the existing switch in `handleIncoming`; payload is just `{roomId}`. Receiver responds with the same `room-sync` shape already used at line 133-140, plus a `presence-replay` for their own cached entry.

## Files

- `src/lib/streaming/webrtcSignalingBridge.standalone.ts`
  - Add `room-hello` and `presence-replay` to the `SignalEnvelope` union + `handleIncoming` switch.
  - In `attachSignalingBridge`, hook the mesh's "connection-opened" event to replay `joinedRooms` and own presence to the new peer.
  - Export `helloRoom(roomId)` for callers.
- `src/hooks/useBrainVoice.ts`
  - After `joinRoom` succeeds, call `helloRoom(roomId)` once with a 250 ms delay so the directed envelope rides over an established channel.

## Out of scope

- The prior `GlobalCell` / cascade timing fix stays as-is. It got the *mesh* hot quickly; this fix gets the *room* hot quickly on top of it.
- No change to PeerJS, Gun relays, or RoomDiscovery.
- No physics or rendering changes — `voicePeers` already drives `Brain.spawn` correctly once presence arrives.

## Expected behavior after fix

- Cold-start scenario (both users land directly on `/brain`): as soon as the mesh edge forms (≤ a few seconds), each side replays its join + presence to the other. Avatars appear without an exit/re-enter cycle.
- Warm scenario (one inside, one navigates in): unchanged fast path.
- Refresh on `/brain` while peer is already inside: `room-hello` pulls their state immediately on first mesh connection — no waiting for their next 1.5 s presence tick.
