

# Testing Map → Action Plan

To Infinity and beyond. Eleven drift vectors collapsed into five waves. Each item lists the file(s) touched and the user-visible outcome.

## Wave 1 — Visible bugs (do first)

**1.1 Wifi-icon "Builder Mode" error**
`src/components/P2PStatusIndicator.tsx` (handleConnectToPeer, ~L381–419)
The toast at L410 reads `loadConnectionState().mode === 'builder'` and shows "Builder is not online". This fires for normal SWARM users when a dial doesn't immediately succeed. Fix: only show the Builder copy when `activeCell` is actually set; otherwise show "Dialing — peer not reached yet" with retry.

**1.2 Mute Self vs. Mute Infinity rendered identically**
`src/components/brain/BrainChatPanel.tsx` (voice pill, mic button area)
Add separate icon + color tokens:
- Self-mute → `MicOff` red, label "Mic muted"
- Infinity-mute → `VolumeX` amber, label "Infinity silenced"
And split the two states in BrainUniverseScene's HUD (`Mic/MicOff` row vs. `Volume2/VolumeX` row) so they never share a glyph color.

**1.3 Falling through the volcano never returns to Earth**
`src/lib/brain/uqrcPhysics.ts` (integrator end-of-step)
Add a "core escape" rule: if `|pos − earthCenter| < CORE_RADIUS` for >1 s, teleport the body to `spawnNearSharedVillage(peerId)` and fire `toast.info('You fell through the volcano — respawned at the village')`. Keeps the falling animation the user enjoys but guarantees recovery.

**1.4 Remote players "hop"**
`src/components/brain/RemoteAvatarBody.tsx`
Position is set straight from prop on every render. Add per-frame slerp/lerp toward a target ref (0.18 factor) and rebuild quaternion only when delta > 0.5 m. Eliminates the 1-Hz hop driven by streaming presence updates.

**1.5 "Some players fall through the earth" — version drift**
`src/lib/brain/brainPersistence.ts` + `src/components/brain/BrainUniverseScene.tsx`
Bump `BRAIN_PHYSICS_VERSION` const, embed it in heartbeat presence payload, and when a remote peer reports an older version, render their avatar pinned to `STRUCTURE_SHELL_RADIUS` (skin shell) instead of trusting their reported altitude. Show a "peer needs reload" badge near their name.

## Wave 2 — New controls & navigation

**2.1 Run / Flash button**
`BrainUniverseScene.tsx` PhysicsCameraRig + on-screen HUD
- Hold `Shift` (desktop) or tap a new "⚡ Run" pill (mobile/touch) → multiply intent magnitude ×2.2 for up to 4 s, 6 s cooldown shown as the pill emptying. Wires into existing `intent` passed to physics — no new physics path.

**2.2 USB / Gamepad support (desktop)**
New file `src/hooks/useGamepadIntent.ts`
- Polls `navigator.getGamepads()` in `requestAnimationFrame`, maps left stick → `moveInput`, right stick → `lookInput`, A → jump, RT → run, B → portal.
- BrainUniverseScene imports the hook; values are merged with keyboard (max-magnitude wins). No effect on mobile.

**2.3 Compass**
New `src/components/brain/CompassHUD.tsx`
- Small bezel pinned bottom-right of the canvas. Reads `getEarthPose()` + camera forward, projects onto the local tangent plane, displays N / village / volcano / portal markers. Pure-CSS rotating ring; no extra render passes.

**2.4 Map**
New `src/components/brain/MiniMapHUD.tsx` and route `/brain/map`
- Tap compass → opens a 2D azimuthal projection around the player. Shows: shared village, local volcano, nearby remote avatars (last presence positions), portals. Uses existing `surfaceClass` LUT for ocean/land tint so the map matches the world.

## Wave 3 — Account & onboarding

**3.1 Delete Account**
`src/pages/Settings.tsx` (new "Danger Zone" card at bottom)
- Button → confirmation modal (type "DELETE" to confirm).
- Action: clear IndexedDB (`brain-*`, `swarm-*`, `p2p-*`), localStorage, sessionStorage, sign out of Supabase, redirect to `/`. Does **not** touch the mesh — your peer-id simply disappears from the network on next prune.

**3.2 Auto-route to /brain on first login (Chrome regression)**
`src/pages/Index.tsx` already redirects authed users to `/brain`. But if `useAuth` resolves user *after* the redirect window in Chrome's stricter scheduler, it falls through to Profile.
Fix: gate redirect on `!authLoading && user`, and if user is on `/` or `/profile` and has no `brain-entry-complete` localStorage flag, push to `/brain` once auth resolves.

**3.3 "Never auto-connected" on Chrome**
`src/main.tsx` deferred boot is gated by `connState.enabled`. Brand-new accounts have `enabled=false` → nothing starts. Chrome's `requestIdleCallback` may also never fire if the tab is hidden during onboarding.
Fix:
- Default `connState.enabled` to `true` for first-time visitors who pass the Brain entry modal (already a known gate).
- Replace the bare `requestIdleCallback` with `requestIdleCallback(fn, { timeout: 1500 })` so Chrome guarantees execution.

## Wave 4 — Cleanup

- Remove the dead "Builder Mode" copy from `P2PStatusIndicator.tsx` once 1.1 lands, and rename the toast string to "Mesh dial pending".
- Add a memory note `mem://constraints/visual-state-distinction` ("Self-mute and entity-mute MUST use different icons + colors").

## Out of scope this loop

- New mesh transport
- Memory-coin work (back-burner per existing constraint)
- Avatar physics rewrite — only the version-gate for old peers ships now

## Technical notes

- Run cooldown = single ref in PhysicsCameraRig; no new state subscriptions.
- Gamepad hook must early-return on `!('getGamepads' in navigator)` (Safari iOS).
- Core-escape uses an existing helper (`spawnNearSharedVillage`); no new physics shells.
- Map projects with `getSurfaceFrame(playerPos)` as the local "up" so North = +tangent_z. Re-uses `sampleSurfaceClass` LUT — single source of color truth (Vector B from prior plan).
- Delete-account does not call any backend RPC; account deletion in Lovable Cloud is documented separately and surfaced via the existing Settings link to docs.

