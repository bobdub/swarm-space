# Implement Brain screen sharing the standard WebRTC way

You are right: the mesh and calling already work. The screen-share code added a parallel, hand-rolled path (a hard-coded third media slot, manual offers per action, and guesses based on track mute) that fights the working system. The fix is to delete that special path and use the ordinary way browsers ship a second video stream.

## Why others never see the screen today

- Sharing is announced to the room only when it stops, never when it starts. The start announcement sits in the wrong place (room creation), so viewers get no reliable notice that a screen exists.
- The screen is pushed through a fixed, reserved slot and renegotiated by a hand-written offer that shares a single per-peer lock with the camera and microphone. A camera toggle at the same moment can consume the retry budget and the screen offer is discarded with only a console warning.
- Viewers decide what is a screen by slot position, and decide it stopped from a momentary quiet track. Both are guesses about state the browser already reports properly.

## The correct implementation

1. **Share the screen as its own media stream, not a reserved slot.**
   Add the captured screen track to each connection as a normal second video stream. Browsers already carry the stream identity in the negotiation, so the receiving side knows the incoming track belongs to a separate stream than the camera. Remove the fixed third-slot reservation and all position-based guessing.

2. **Let the browser drive renegotiation.**
   Adding or removing the screen track already raises the browser's own "negotiation needed" event, which the existing negotiation handling covers. Delete the manual per-action offer loop for screen sharing so screen sharing shares one consistent, already-proven negotiation path with camera and microphone instead of competing with it.

3. **Remove the track when sharing stops.**
   Stopping removes the screen track from each connection and lets the same negotiation path settle. No manual slot clearing, no inference from mute.

4. **Identify and end the tile from real browser signals.**
   The viewer creates a screen tile when a track arrives on a stream that is not the camera stream, and removes it when that stream's track genuinely ends or the stream is removed. Momentary quiet no longer removes anything, so no compensating flag is needed.

5. **Keep one lightweight room announcement, correctly placed.**
   Send "sharing started" at the moment the screen is actually attached and "sharing stopped" when it is removed, so late joiners and reconnecting peers learn the state immediately. This is a notification only; the media path no longer depends on it.

6. **Delete the compensating code.**
   Remove the reserved-slot logic, the position/slot classification fallback, the mute/unmute state flag, and the screen-specific retry handling. Fewer moving parts than today, not more.

## Verification

- Focused WebRTC tests extended so two connected sides exchange a real screen track: it arrives as a separate stream, survives a camera toggle, and disappears only when sharing ends.
- Type checks and the existing negotiation tests.
- Two live sessions in the browser: one user shares, the other sees the tile appear within a couple of seconds, opens it full size, and voice stays live on both sides throughout.

## Technical scope

`src/lib/webrtc/manager.ts` (screen track add/remove via standard sender handling, negotiation-needed driven, stream-based classification in the track handler), `src/lib/webrtc/types.ts` (drop the compensating active flag), `src/components/brain/BrainVideoGrid.tsx` (tile keyed off the screen stream), and the WebRTC tests. Capture permission handling and the tile visual design stay as they are.
