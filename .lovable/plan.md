

## Brain: video grid, desktop joystick, gentler look controls

Three additions to `/brain`. All three are surgical — they touch the HUD layer and a small piece of WebRTC plumbing, leaving physics, presence, and avatars untouched.

### 1. Camera + video grid (default OFF)

**New component: `src/components/brain/BrainVideoGrid.tsx`**
- Reads `participants` from `useWebRTC()` (same hook `PersistentAudioLayer` uses).
- Renders one tile per peer with a video track, plus a self tile when local camera is on.
- Tile = `<video autoPlay playsInline muted={isSelf}>` with `srcObject = participant.stream`, username caption, mic-status dot. Non-video peers show their avatar emoji/initial fallback (no tile if neither video nor desire to show).
- Layout: horizontal strip that wraps to 2 rows when >4 peers. Tile size 128×96 (mobile 96×72). Auto-hides when 0 peers have video AND local camera is off.

**HUD wiring in `BrainUniverse.tsx`**
- Add a `Video` / `VideoOff` toggle button (lucide-react) **immediately to the left of the existing Mic button** in the top-right HUD cluster.
- New state `cameraOn` (default `false`). Toggle calls `manager.startLocalStream(true, true)` to add a video track to the existing audio stream (the manager already handles incremental track add + renegotiation), then `manager.toggleVideo(true)`. Off path calls `manager.toggleVideo(false)` and stops the local video track.
- The grid is **anchored under the camera button** and **pops down** from there: positioned `absolute top-14 right-[~120px]` aligned beneath the button, with `animate-in slide-in-from-top-2 fade-in` when shown, `slide-out-to-top-2 fade-out` when hidden. Visibility = `cameraOn || anyRemoteHasVideo`.
- The grid sits above the canvas (`z-20`) but below modals, and is non-blocking for pointer events outside its tiles (`pointer-events-none` on the wrapper, `pointer-events-auto` on individual tiles).

**Presence**: no change needed. Video track flows through the existing room peer connections; remote peers see it automatically because `startLocalStream` triggers renegotiation in `manager.ts`.

### 2. Desktop joystick (left/right/forward/back)

**New component: `DesktopJoystick`** inside `BrainUniverse.tsx` (mirrors the existing `MobileJoystick` but mouse-driven and shown only when `!isMobile`).
- 96×96 circular pad, bottom-left of the screen (`absolute bottom-4 left-4 z-20`), translucent like the mobile one.
- Mouse handlers: `mousedown` activates, `mousemove` (window-level while active) updates the same `moveInput.fwd` / `moveInput.right` globals already consumed by `PhysicsCameraRig`. `mouseup` / `mouseleave` resets to 0.
- Knob nub follows the cursor inside the pad with a max radius clamp; values normalised to `[-1, 1]`.
- Stays visible always on desktop (it does not steal pointer-lock — clicking it does not enter lock). Keyboard WASD continues to work in parallel since the rig sums `kFwd + moveInput.fwd`.

### 3. Gentler look controls (no strong mouse capture)

Replace `<PointerLockControls />` with a **drag-to-look** model on desktop.

**New component: `DesktopLookOverlay`** (full-screen `absolute inset-0 z-10`, behind HUD/joystick/grid).
- `mousedown` on the overlay starts a look drag; `mousemove` accumulates into `lookInput.yaw` / `lookInput.pitch` using the same scaling already used by `TouchLookOverlay` (`* 0.005`). `mouseup` / window blur ends the drag.
- No pointer lock, no cursor hiding — cursor stays visible, user can move it freely, and clicking HUD buttons works without an Esc-to-release dance.
- The overlay uses `cursor-grab` normally and `cursor-grabbing` while dragging. It **does not** intercept clicks on HUD or joystick because those have higher `z-index`.
- Remove the `<PointerLockControls />` line from the Canvas. Keep `TouchLookOverlay` for mobile.
- Update the bottom hint from "Click to look · WASD to drift" → "Drag to look · WASD or joystick to move".

### Files touched

- `src/pages/BrainUniverse.tsx` — add Video toggle button + state, mount `BrainVideoGrid`, add `DesktopJoystick` + `DesktopLookOverlay`, remove `PointerLockControls`, update hint text.
- `src/components/brain/BrainVideoGrid.tsx` — new file, video tile grid.

No changes to physics, presence, signaling, or avatar pipeline. The existing `WebRTCManager.startLocalStream(audio, video)` already handles incremental video-track addition and renegotiation, so peers see each other automatically when either turns the camera on.

### Acceptance

```text
1. /brain loads with camera OFF; no getUserMedia video prompt fires until the user clicks the Video button.
2. Clicking the Video button (left of the Mic button) requests camera permission, adds a tile to the grid that pops down from beneath the button with a smooth slide+fade.
3. When another peer turns their camera on, a tile for them appears in the same grid within ~1s.
4. Turning the camera off removes the local tile and stops the camera light; the grid auto-hides when no tiles remain.
5. On desktop, a circular joystick sits bottom-left; dragging it moves the player forward/back/left/right just like WASD. WASD keys still work simultaneously.
6. On desktop, looking around uses drag-to-look — no pointer lock, no cursor hide, no Esc required to click HUD buttons.
7. Mobile retains its existing TouchLookOverlay + MobileJoystick behavior unchanged.
8. No regressions to voice, presence, avatars, or chat.
```

