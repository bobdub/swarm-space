# Shrink land-plot labels in Top view

Problem: the canvas-texture "Your land" / owner nameplate sprites in `LandPlotsOverlay.tsx` are oversized, especially when the builder Top view camera pulls far above the avatar. They cover multiple grid cells and block clicks on the build surface.

## Changes

1. Reduce base label size in `LandPlotsOverlay.tsx#makeLabelSprite`:
   - Drop font from 34 px to 16 px.
   - Drop padding from 12 px to 6 px.
   - Drop world scale from 3.2 to ~1.4.
   - Keep the pill background and outline, just smaller.

2. Add Top-view-aware scale fade:
   - Read `getBuilderTopView()` inside the `useFrame` of `PlotMarker`.
   - When top view is active, scale the sprite an additional ~0.55× and lower its vertical lift from 1.6 m to 0.6 m so it sits closer to the ground and reads as a small tag.
   - Also tighten `LABEL_VIEW_DISTANCE` from 160 m to 90 m while top view is on, so only nearby plots label themselves.

3. Keep normal walking view readable:
   - Non-top-view scale stays at the new smaller base size (still readable at walking distance).
   - Existing distance fade at 160 m remains for normal view.

4. Verify the "Land" chip still toggles markers on/off and that the smaller sprites do not reintroduce the old black occlusion plate (they are still pure WebGL sprites, no `<Html>`).

## Verification

Open the Brain, enter builder mode, toggle Top view, and confirm the "Your land" / owner labels are small tags that do not obscure the grid or block placement clicks. Then exit Top view and confirm labels remain readable at ground level.
