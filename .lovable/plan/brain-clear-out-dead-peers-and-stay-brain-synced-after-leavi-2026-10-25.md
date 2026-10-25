# Brain: clear out dead peers, and stay "Brain synced" after leaving

## Goals
1. Peers who refreshed or closed the tab disappear from the Brain right away, along with their sound, video and avatar.
2. Leaving the Brain page does not end your call. A small "You are Brain synced" bar follows you around SWARM with mic, camera and Disconnect buttons.
3. No forced re-sync. A refresh counts as a clean disconnect: the old avatar is removed and you join again as a fresh connection, the way the mesh already works.

## 1. Remove dead peers
- When a page refreshes or a tab closes, it quickly tells the room it is leaving. Everyone else then removes that person's avatar, sound and video tiles straight away.
- If that message never arrives (crash, lost connection), each person's room list drops anyone who has sent no presence or media for about 20 seconds. Their call connection, sound and avatar get closed too.
- The room list no longer brings back someone it already removed just because an old message about them arrives late. Only a new join or new presence from that person brings them back.
- After a refresh, the old identity is never brought back to life. The person shows up again through their new join, so no duplicate "peer-xxx" appears.

## 2. "You are Brain synced" bar
- Leaving the Brain page keeps you in the Brain conversation. You stay in the room and keep hearing everyone.
- On every other page, a small floating bar shows "Brain synced", how many people are in the room, and three buttons: Mic on/off, Camera on/off and Disconnect.
- Mute and camera choices carry over exactly. The bar uses the same remembered mute setting the Brain uses.
- Disconnect leaves the room, turns off your mic and camera, and hides the bar. Going back to the Brain page reconnects normally.
- The bar shows only while you are still in the Brain room. It is hidden on the Brain page itself and sized to fit phones.
- If you open a live stream room, that room takes over and the Brain sync ends cleanly, so you are never in two calls.

## 3. No re-sync on refresh
- Remove any code that tries to restore the previous call after a refresh. A refresh means you leave, then join again from scratch.

## Technical scope
- `src/lib/streaming/webrtcSignalingBridge.standalone.ts`: tombstone peers that leave, ignore stale messages from them, expire room members after about 20 seconds without presence, and send a leave message on `pagehide`.
- `src/lib/webrtc/manager.ts`: a `removeParticipant` method that closes the call connection and tracks and sends `peer-left`. A sweep for stale participants. On `pagehide`, call `leaveRoom` (best effort). Nothing restores the session.
- New `src/lib/brain/brainSyncStore.ts`: the app-wide setting for "stay synced to room X", with `sync`/`disconnect`.
- New `src/components/brain/BrainSyncHost.tsx`, mounted in `App.tsx` like `LiveRoomVoiceHost`: keeps `useBrainVoice` joined to the synced room on pages other than the Brain.
- New `src/components/brain/BrainSyncDock.tsx`: the floating bar (mic, camera, Disconnect), built with design tokens.
- `src/hooks/useBrainVoice.ts` and `BrainUniverseScene.tsx`: leaving the Brain page hands the room over to the sync host instead of calling `leaveRoom`. The Leave/Disconnect button clears the sync.
- `LiveRoomVoiceHost.tsx`: joining a live room clears the Brain sync.
- Tests: dead-peer removal (leave message and timeout), no revival from stale messages, the sync staying active across a page change, and Disconnect fully leaving the room.
- Record the rule in `AGENTS.md`: Brain room membership is app-level and only an explicit disconnect ends it; a refresh is a disconnect, never a resume.
