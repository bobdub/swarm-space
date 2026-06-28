You are right: blockchain is not the live chat/WebRTC issue. The live-room problem is that I let the live post, floating dock, preview audio, and Brain view all manage WebRTC separately. That created duplicate room joins, duplicate audio binding, repeated hello/offers, and a single shared WebRTC manager being pulled between room surfaces.

Do I know what the issue is?
Yes. The actual issue is architectural bloat around the live-room presentation:

- The main Brain path already has working room voice/chat behavior.
- Live rooms added a second parallel media path (`LivePostPreview`, `LivePostBoxBody`, `useLiveRoomMedia`, old `PersistentAudioLayer`) instead of reusing the working Brain pattern.
- The feed preview and floating dock can both mount for the same room and both call `joinRoom`, `helloRoom`, audio binding, polling, and renegotiation.
- The WebRTC manager is singleton/current-room based, so multiple UI surfaces fighting over it causes churn and reconnect loops.
- Tabs between Classic and Brain should only change presentation; they should not remount/rejoin/re-negotiate media.

Plan:

1. Make one live-room media controller per room
   - Introduce one canonical live-room controller/hook that owns WebRTC join, participants, local stream, remote streams, and chat for a given live room.
   - The post preview, dock, Classic tab, and Brain tab will all read from that one controller instead of each creating their own WebRTC behavior.
   - This removes duplicate joins, duplicate hello calls, duplicate polling, and duplicate audio elements.

2. Reuse the working Brain room pattern
   - Base participant mode on the same flow as `useBrainVoice`: acquire/preserve local mic track, join the room, publish presence/chat, and keep tracks alive instead of repeatedly stopping/restarting them.
   - Use the live room ID as the Brain room ID for that live chat room.
   - The live room’s virtual Brain view becomes a presentation of the same room state, not a second media system.

3. Keep passive feed viewing truly passive
   - Feed posts join the live room as receive-only viewers through the shared controller.
   - They can see/hear the stream from the post without opening the dock and without enabling mic/camera.
   - The feed preview will not publish local media unless the user explicitly chooses to participate.

4. Add explicit participant upgrade
   - `Participate Live` upgrades the same controller from receive-only to publishing mic/camera.
   - Mic and camera toggles update the existing transceivers/tracks instead of starting a competing room join.
   - Camera remains optional; audio/text participation still works without camera.

5. Make Classic / Brain tabs presentation-only
   - Classic tab shows live video tiles + text chat.
   - Brain tab shows the virtual room/Brain view bound to the same live room ID.
   - Switching tabs must not leave/rejoin the room, recreate audio elements, or renegotiate WebRTC.

6. Remove/bypass dead duplicate live media code
   - Strip WebRTC joining/audio playback/toggles out of `LivePostPreview`; it becomes a lightweight feed presentation and open/participate control.
   - Replace the old `PersistentAudioLayer` dependency on `useWebRTC` with the shared live-room controller, or remove it if the controller owns audio playback.
   - Keep textual chat, but route it through the same room channel already used by Brain chat.

7. Stabilize the WebRTC manager only where necessary
   - Stop peer removal/reconnect loops from tearing down active live-room peers while the mesh still sees them.
   - Keep one negotiation path; no scattered manual offer storms from preview + dock + sync.
   - Do not touch unrelated blockchain code as part of this live-room fix.

8. Verify before saying fixed
   - Run a two-client browser test.
   - Host creates live room from post composer; feed shows live post with audio/video stream.
   - Passive viewer can see/hear from feed without joining.
   - Viewer clicks Participate Live and can be seen/heard by host and other viewers.
   - Text chat works in the live room.
   - Classic / Brain tabs switch back and forth without media dropping.
   - No repeated `Max reconnect attempts` loops during the test.

Primary files involved:
- `src/hooks/useBrainVoice.ts`
- `src/hooks/useLiveRoomMedia.ts`
- `src/components/streaming/LivePostPreview.tsx`
- `src/components/streaming/LivePostBoxBody.tsx`
- `src/components/streaming/FloatingLiveDock.tsx`
- `src/components/streaming/PersistentAudioLayer.tsx`
- `src/lib/webrtc/manager.ts`
- `src/lib/streaming/webrtcSignalingBridge.standalone.ts`

<presentation-actions>
  <presentation-open-history>View History</presentation-open-history>
</presentation-actions>

<presentation-actions>
<presentation-link url="https://docs.lovable.dev/tips-tricks/troubleshooting">Troubleshooting docs</presentation-link>
</presentation-actions>