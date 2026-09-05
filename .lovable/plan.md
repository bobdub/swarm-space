# Screen Share in the Brain

Add a screen-share toggle beside the camera and microphone buttons inside the Brain hubs, so anyone in the space can show their screen while still talking, and others can pop the shared screen open large to follow along.

## What people will see

- A new monitor icon sits next to the camera and mic buttons in the top bar of the Brain (both the main Brain and project hubs).
- Tap it, accept the browser's picker, and your shared screen appears in the small video area as a tile marked "Your screen".
- Tap the same button again (or use the browser's own "Stop sharing" bar) to stop. Voice keeps running the whole time — sharing never touches your microphone.
- Everyone else gets a tile labelled "<name>'s screen" with an expand control. Clicking it opens a large overlay to watch the screen; closing it returns to the small tiles. The small tiles stay visible so people can still see faces.
- While someone is sharing, their tile is outlined so it is obvious which tile is the screen and which is the camera.

## Behaviour rules

- Sharing is independent of camera and mic state: you can share with the camera off and the mic on.
- Only one share per person; starting a share while already sharing does nothing new.
- If the browser refuses or the user cancels the picker, the button simply returns to off with a short "Screen share cancelled" notice.
- Leaving the Brain, or the entry gate closing, stops any active share and releases the capture.

## Technical notes

Files involved:

- `src/lib/webrtc/manager.ts` — screen capture already exists (`startScreenShare`, `stopScreenShare`, `getScreenStream`, and the `ontrack` screen-slot routing into `participant.screenStream`). Two corrections needed:
  - Reserve the screen slot explicitly: add a third upfront transceiver (`addTransceiver('video', { direction: 'sendrecv' })`) in `createPeerConnection`, so index 2 is always the screen slot regardless of track arrival order.
  - Switch `startScreenShare` / `stopScreenShare` to `replaceTrack` on that reserved sender instead of `addTrack`/`removeTrack`, and only send the screen's video track (screen audio stays out of the mesh in v1 to protect voice). Emit a `room-updated` broadcast on start as well as stop so peers refresh promptly.
- `src/components/brain/BrainUniverseScene.tsx` — new `sharingScreen` state and a `toggleScreenShare` callback mirroring `toggleCamera`; a `MonitorUp` / `MonitorOff` button placed immediately before the camera button; pass `screenStream` and `sharingScreen` into `BrainVideoGrid`; stop the share on unmount.
- `src/components/brain/BrainVideoGrid.tsx` — build screen tiles from `localScreenStream` and each participant's `screenStream`; add an expand button on every screen tile and a full-screen overlay (fixed, dimmed backdrop, close button, `object-contain` video) rendered for the currently expanded tile. Screen tiles are muted locally to avoid echo.
- Colour and icon separation follows the existing paired-state rule: camera uses `Video`/`VideoOff`, mic uses `Mic`/`MicOff`, screen share uses `MonitorUp`/`MonitorOff` with a cyan active ring so the three are never confused.

Out of scope for v1: sharing screen audio into the call, remote control, and pinning a share onto a 3D wall in the world.
