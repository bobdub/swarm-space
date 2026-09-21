# Brain video & voice chat — four fixes

All four problems come from the same place: the Brain shows tiles and names based on guesses instead of what each person's device is actually doing, and a connection is only ever set up from one direction.

## 1. No more black squares

Right now every connection reserves a video slot up front, even for someone who only joined with a microphone. The other side receives that empty slot and draws a black tile.

Change the tile rule so a person's video box appears only when a real, live picture is arriving — the browser reports a placeholder video as "not receiving", and the tile is skipped. Each person also tells the room when they switch their camera on or off, so tiles appear and vanish immediately instead of waiting for the picture to stall. Someone who allowed the camera but never turned it on shows no box at all — just as with no camera.

## 2. Real names under every box

Names are recorded once, when a person is first noticed, and at that moment the name is often not known yet, so "Peer" or "Unknown" is stored and never replaced.

Change it so every later message that carries a name updates the stored one, and the Brain's own presence list (which already knows everyone's username and avatar) is used as the preferred source for both the video box and the screen-share box. The screen box then reads "<name>'s screen". If a name genuinely hasn't arrived yet, show a short readable id and replace it the moment the name does arrive.

## 3. Mute that stays muted

Two things currently undo a mute: the microphone setup step re-enables the mic whenever it re-runs, and turning the camera on re-acquires the microphone as a brand-new, unmuted one.

Move mute to a single remembered setting on the call layer. Any time a microphone is acquired, replaced or re-enabled, that setting is applied to it, so a mute survives camera toggles, reconnects and re-entering the Brain. The mute state is also announced to the room, so everyone's mic icon matches reality rather than defaulting to "unmuted".

## 4. One-way audio/video

A connection is only started when someone announces they are joining. If that announcement arrives before the two people are linked in the mesh — or a negotiation attempt is dropped after its retries run out — one side ends up sending while the other never does, which is exactly the "I can hear them, they can't hear me" case.

Add a short, repeated health check per person in the room: a few seconds after joining, and periodically afterwards, each side checks whether it is actually receiving anything from every other participant and whether its own tracks are attached. If a connection is idle or half-formed, it re-runs the standard setup once (with backoff, so two sides can't fight). Both sides announce their presence on entry so whoever notices first starts the connection; the existing polite/impolite rule keeps a simultaneous start from colliding. Dropped negotiations are retried instead of being abandoned with only a log line.

## Technical scope

- `src/lib/webrtc/manager.ts` — `ensureParticipant` updates the username on later signals instead of keeping the first placeholder; new `setMuted`/`isSelfMuted` desired-state applied in `startLocalStream`, `refreshLocalStream` and `toggleAudio`; per-participant `isVideoEnabled`/`isMuted` driven by a new room-level media-state announcement plus remote `track.muted`/`onmute`/`onunmute`; a periodic per-peer connection health check that re-offers when a connection is connected but carries no inbound media, and re-queues negotiations after the retry budget instead of dropping them.
- `src/lib/webrtc/types.ts` — add the media-state message type (`camera`/`mic` flags) to `VideoRoomMessage`.
- `src/lib/streaming/webrtcSignalingBridge.standalone.ts` — send/receive helper for the media-state announcement, alongside the existing screen-share-state one.
- `src/components/brain/BrainVideoGrid.tsx` — tile shown only for live, unmuted incoming video; labels resolved from a name map passed in by the scene.
- `src/components/brain/BrainUniverseScene.tsx` — pass Brain presence usernames into the grid; announce camera and mic state on toggle; route mute through the manager's remembered state.
- `src/hooks/useBrainVoice.ts` — stop force-unmuting on effect re-runs; read mute from the manager.
- Tests: extend `src/lib/webrtc/__tests__/negotiationLoop.test.ts` with a half-connected peer recovering, and add coverage for username backfill and mute persistence across a stream refresh.
