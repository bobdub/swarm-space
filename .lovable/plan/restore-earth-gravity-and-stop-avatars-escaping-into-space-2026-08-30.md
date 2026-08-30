# Restore Earth gravity and stop avatars escaping into space

The failure is in field ownership, not the wall-post rendering. Builder support basins and the Earth mantle share `pinTemplate`, but removing or moving any support basin currently zeroes every covered cell. The pub creates many overlapping wall/furniture basins on the same coarse 24³ lattice, so their per-tick restamping repeatedly erases the Earth basin beneath the players. Once an avatar crosses the current atmosphere cutoff, the integrator also switches it to free-space motion and stops applying the analytic surface-restoring gradient, making escape effectively permanent.

## Changes

1. **Make pin layers composable**
   - Stop `unpinSupportBasin()` from directly clearing shared Earth/structure cells.
   - Track Earth/mantle and builder support contributions independently, then compose the effective `pinTemplate`/mask deterministically.
   - Preserve overlapping builder basins when one block moves or is removed; no block may erase another block’s support or the planetary basin.

2. **Keep Earth-attached avatars inside the Earth gravity domain**
   - Treat bodies marked `attachedTo: 'earth-surface'` as Earth-local passengers even if a transient force pushes them just outside the narrow atmosphere threshold.
   - Extend the existing field-derived radial restoring profile far enough to recapture escaped surface avatars smoothly; do not teleport, clamp, or add a separate gravity constant.
   - Add finite-position/velocity protection so an invalid physics sample is recovered at the known Earth-local site rather than poisoning the camera and peer broadcast.

3. **Stabilize existing sessions**
   - On scene startup, detect a saved/current self body that is already outside the recoverable Earth region and respawn it once at the shared village with zero velocity.
   - Keep normal walking, seating, remote seat locks, and deliberate movement unchanged.

4. **Regression coverage and verification**
   - Add an overlap test proving repeated pub support-basin restamps cannot erase the mantle or neighboring support pins.
   - Add a long-duration surface-avatar test with pub basins active, checking bounded altitude, finite state, and no escape after several simulated minutes.
   - Add a recovery test for an Earth-attached avatar slightly beyond the former cutoff.
   - Run the focused Brain physics/pub tests, typecheck/build validation, and browser verification on `/brain` over an extended idle/walk interval; confirm the planet remains visible and the altitude stays bounded.
   - Extend the caretaker reflection after the repository is tended.

## Technical constraint

The fix stays within the existing UQRC model: gravity remains the gradient of the composed field/mantle profile. Rendering and camera code remain read-only, and there will be no per-frame projection onto the Earth surface.
