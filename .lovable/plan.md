# Four-way calls: fix the missing peer and add a Gun.js room graph

## Goal
In a call with 4 people, everyone hears and sees everyone. Refreshing must not move the "left out" spot to someone else.

## What changes for users
- Every person in a room connects straight to every other person (a web, not a line).
- If one link fails, it repairs itself quietly without dropping the rest of the call.
- A person who joins or refreshes reaches all others within seconds.

## Plan

1. **Gun.js room graph (new, added on top)**
   - Each room gets a small shared Gun node listing who is present (peer ID, mic/camera state, heartbeat time).
   - Every member watches it, so a new or refreshed peer is seen by all others at once, without passing messages through other browsers.
   - Each peer also gets a room inbox in Gun for call setup messages (offer, answer, network candidates). These are only used when no direct data link exists to that person yet.
   - Records carry a timestamp and are ignored after 30 seconds, and are cleared on leave, so old setup messages never come back.
   - Audio and video never go through Gun; only short setup messages do.

2. **Web closure: everyone dials everyone in the room**
   - When the graph shows a room member with no call link to us, the side with the lower peer ID starts the call (one agreed starter, no collisions).
   - Uses the existing dial rules (backoff, limits, Auto-connect), never a redial storm.

3. **Fix multi-hop drops**
   - Call setup messages try: direct link first, then Gun inbox, then the existing 2-hop relay. Whichever arrives first wins; duplicates are ignored by ID.

4. **Consistent "who starts" rule**
   - Both sides compare the same kind of ID (mesh peer ID) so two devices never both wait or both start.

5. **Track and playback guards**
   - A live incoming audio track clears any leftover "muted" placeholder so audible people are not silenced.
   - Re-try audio playback when a track arrives or changes, using the single shared audio setup.
   - Per-pair health check: if one pair has no incoming sound for a while, repair just that pair.

6. **Tests**
   - Four-peer simulation with joins in different orders and one peer refreshing: every pair (all 6) ends up connected with audio both ways.
   - Gun graph tests: stale records ignored, inbox delivery when no direct link, no duplicate handling.

## Technical details
- New `src/lib/streaming/roomGraph.ts` using the existing `GunAdapter` (native WebSocket, all relays kept incl. `relay.peer.ooo`). Keys: `swarm-space/rooms/<roomId>/peers/<peerId>` and `swarm-space/rooms/<roomId>/inbox/<targetPeerId>/<fromPeerId>`.
- `webrtcSignalingBridge.standalone.ts`: subscribe on room join, route directed signals direct -> Gun inbox -> `relayDirected`, dedup by existing keys.
- `manager.ts`: lower-mesh-ID offerer rule for graph-discovered members; `isPolite` uses mesh IDs on both sides; per-pair inbound RTP repair reuses existing bounded recovery.
- `PersistentAudioLayer.tsx`: unmute/replay guards on track events.
- The stalled-dial relay rule stays: Gun mesh relay edges still never carry media; the room inbox is a separate signaling-only path. Update `src/lib/p2p/AGENTS.md` with the room graph rule.
- Tests in `src/lib/webrtc/__tests__/` and `src/lib/streaming/__tests__/`; no live browser tests while you are testing Brain.
