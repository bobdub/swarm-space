# Fix the land overlay: black slabs and repeated respawns

The land markers added in the last change are breaking the world: long black walls across the horizon and the avatar snapping back to its spawn point after a few steps.

## What the code shows

- `LandPlotsOverlay.tsx` renders, per plot and **every frame**: a perimeter line (`depthTest: false`), a 6x6 fill mesh whose vertices are rewritten in world space, plus a drei `<Html occlude="blending">` nameplate.
- `occlude="blending"` adds a real occlusion plate into the scene. Combined with `distanceFactor` on a group positioned at Earth-scale world coordinates, that plate is the most likely source of the long black slabs in the screenshot (the two visible "Your land" chips sit exactly on it).
- The outlines/fills use `depthTest: false` and are rebuilt with `computeBoundingSphere()` each frame for every plot — cheap for one plot, a per-frame stall as plots accumulate.
- `uqrcPhysics.ts` has a core-escape rescue that respawns a humanoid at the shared village after ~1s inside the core radius. A frame stall producing a large `dt` catch-up is a plausible route into that rescue, but this is **not yet confirmed** — verifying it is the first step below, not an assumption.

## Plan

1. **Kill the black slabs.** Drop `occlude="blending"` from the plot nameplate and stop using drei `<Html>` for it. Render the label as a canvas-texture `THREE.Sprite` (billboarded, depth-tested, distance-faded) so no DOM plate is injected into the scene, and hide labels past a view distance.

2. **Make the overlay cheap and non-intrusive.**
   - Rebuild plot geometry only when the Earth pose actually changes materially, not unconditionally every frame; keep a single shared material per style instead of one per plot.
   - Restore normal `depthTest` on the outline so it reads as ground marking rather than an overlay drawn through the terrain.
   - Cap the number of plots rendered by distance from the player.

3. **Default markers off outside Builder Mode.** `landOverlayStore` defaults to on today. Flip the default so the walking world stays clean; the "Land" chip turns markers on, and Builder Mode shows them automatically. This also gives an immediate escape hatch if anything else regresses.

4. **Diagnose the respawn before changing physics.** Run a browser session on `/brain`, walk with the overlay on and with it off, and log per-frame `dt`, catch-up tick counts, avatar radius, and every core-rescue fire. Only then fix the actual cause — if it is dt catch-up, clamp the accumulator so a rendering stall cannot drive the body through the core; if it is something else, the log will name it.

5. **Verify.** Re-run the Brain physics tests plus the land-plot tests, then confirm in the browser: no black geometry, land boundaries legible, and continuous walking for a few minutes with no respawn.

## Technical notes

- Files touched: `src/components/world/LandPlotsOverlay.tsx` (sprite labels, throttled rebuild, shared materials, distance cull), `src/lib/world/landOverlayStore.ts` (default off), and — only if the diagnosis supports it — the accumulator guard in `src/lib/brain/uqrcPhysics.ts`.
- No change to the ownership gate (`landPermissions.ts` / `landPlots.ts`); enforcement stays as built.
- Physics stays field-derived; any accumulator change is a bound on simulated catch-up, not a new force or clamp on position.
