# Others can't see a shared screen in the Brain

Right now the person sharing sees their own screen tile, but nobody else does. The sharing side does send the picture out — what is unverified is whether it arrives and, if it arrives, whether the viewer's tile survives. Two things in the current code can each swallow it, and both will be checked before anything is declared fixed.

## Step 1 — Repair remote delivery now

Your live two-user test already confirms the failure: local capture works, but the remote screen never displays. Implement the mesh and viewer-state corrections directly, while adding focused diagnostics to show whether each remote track was negotiated, received, classified, and rendered.

## Step 2 — Faults to fix

1. **The viewer drops the tile on a momentary pause.** When a picture track arrives it can briefly go quiet, especially while the connection is being renegotiated right after sharing starts. Today the viewer treats that single quiet moment as "sharing stopped" and clears the tile forever, with nothing to bring it back. Fix: only clear on a real stop, and restore the tile when the picture resumes.
2. **The viewer's slot doesn't line up.** The screen is sent on a dedicated third media slot and the viewer recognises it purely by slot position. If the two sides ever number their slots differently, the incoming screen is mistaken for a camera and merged into the face tile. Fix: identify the screen track by an explicit marker rather than by position alone.

## Step 3 — Make the arrival explicit (the "ping")

Add a small message sent through the mesh when someone starts or stops sharing, carrying their id. Viewers use it to know a share is expected, to refresh their tiles immediately instead of waiting for the periodic check, and to clear a tile only when the owner really stopped. This also covers the case where the picture arrives before the tile list is next refreshed.

## Step 4 — Verify the completed repair

After implementation, repeat the two-session run: the viewer must see a `<name>'s screen` tile appear within a couple of seconds, keep it while the sharer keeps sharing (including across a camera or mic toggle), be able to open it full size, and lose it only when the sharer stops. Voice stays live throughout on both sides.

## Technical notes

- `src/lib/webrtc/manager.ts`
  - `ontrack`: `event.track.onmute` currently nulls `participant.screenStream` with no `onunmute` counterpart — remote screen tiles are permanently dropped by any transient mute (very likely during the renegotiation that immediately follows `publishScreenStream`). Replace with mute/unmute pairing plus `onended`, keeping the stream reference and toggling a `screenActive` flag instead of discarding it.
  - Screen classification via `pc.getTransceivers()[2]` identity is fragile after rollback/recovery re-creates transceivers. Add a mid-based check (`event.transceiver.mid` recorded when the screen transceiver is created) as the primary test, with index 2 as fallback.
  - Broadcast a UI event (`peer-joined`-style refresh) when a screen track is first received; today only the 1.5s poll in `BrainUniverseScene` picks it up.
  - Add `screen-share-started` / `screen-share-stopped` to the room-message union in `src/lib/webrtc/types.ts` and emit them from `publishScreenStream` / `stopScreenShare`, relayed through the existing mesh channel used for room messages.
  - Confirm `createOfferForPeer` after `replaceTrack` is not being dropped by the negotiation lock/glare path for the peers that never see the share.
- `src/components/brain/BrainVideoGrid.tsx`: build remote screen tiles from the stream plus the active flag rather than `getVideoTracks().length > 0`, so a briefly muted track keeps its tile.
- Verification harness under `/tmp/browser/screenshare-mesh/`: two Playwright contexts, Chromium flags `--auto-select-desktop-capture-source` and `--use-fake-ui-for-media-stream`, logging `[WebRTC]` console lines from both sides.
