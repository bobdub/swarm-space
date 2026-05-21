# Fix raycast not catching planet taps

## Root cause

The in-Canvas `AssetCaster` raycast surface is correct, but it never receives pointer events. After choosing a project in `DropPortalModal`, `handleBeginPortalCast` arms a pending cast — but the scene always renders a full-screen look overlay above the Canvas:

- `DesktopLookOverlay` and `TouchLookOverlay` are `absolute inset-0 z-10` divs that swallow `mousedown` / `touchstart` for drag-to-look.
- The Canvas sits at the default z, so r3f's pointer event chain (`onPointerMove` / `onClick` on the raycast sphere) never fires.

This matches the symptom on both mobile `/brain-dev` and `/brain`: the cast arms (toast shows), but the planet tap "does nothing".

A secondary nuisance: nothing in the HUD tells the user a cast is armed, and there is no way to cancel except reloading.

## Fix

1. Make the look overlays inert while a cast is pending.
   - Subscribe to `subscribeCast` in `BrainUniverseScene` (top-level component) to track `pendingCast`.
   - Pass an `inert` prop to `DesktopLookOverlay` and `TouchLookOverlay`. When inert, the root div renders with `pointer-events-none` (and skips its drag listener attachment for clarity).
   - This preserves drag-to-look the rest of the time and lets pointer events fall through to the Canvas only while a cast is armed.

2. Add a minimal "casting" HUD strip.
   - When `pendingCast` is non-null, show a thin pill at the top of the scene with the cast label (e.g. "Drop portal: ProjectX — tap the planet") and a "Cancel" button that calls `clearPendingCast()`.
   - Pure presentation; uses existing semantic tokens. Stays above the Canvas but uses `pointer-events-none` on the container with `pointer-events-auto` on the Cancel button only, so it doesn't re-block the planet.

3. Keep `AssetCaster` behavior, with two small hardenings.
   - Ensure the raycast sphere always renders inside the Canvas (it already returns `null` when no cast — that's fine because the look overlay now lets clicks through only when a cast exists).
   - Use `onPointerDown` in addition to `onClick` so the first touch on mobile commits instantly without waiting for the synthetic click (some mobile browsers drop the click if a `touchstart` listener was previously active on a parent).

4. Sanity check at `/brain-dev`.
   - Open the dev page on mobile viewport, open the Portal modal, pick a project, confirm:
     - Top pill says "Drop portal: …"
     - Tapping the planet places the portal and clears the cast.
     - Drag-to-look returns to normal afterwards.

## Files touched

- `src/components/brain/BrainUniverseScene.tsx`
  - New `usePendingCast()` local hook (or inline `useState` + `subscribeCast` effect) at the scene root.
  - Pass `inert={!!pendingCast}` to `DesktopLookOverlay` and `TouchLookOverlay`.
  - Render `CastHUD` (small inline component) when `pendingCast` is non-null.
  - `DesktopLookOverlay` / `TouchLookOverlay` accept `inert` and short-circuit listener attach + add `pointer-events-none`.
- `src/components/world/AssetCaster.tsx`
  - Add `onPointerDown` handler mirroring `onClick` for mobile-first commits.

No physics, persistence, or builder code changes. No new dependencies.

## Out of scope

- Snapping the hit point to terrain/biome rules (still uses `EARTH_RADIUS + 0.05` like today).
- Extending the cast surface to non-Earth bodies (galaxy, sun).
- Replacing `DropPortalModal` UX.
