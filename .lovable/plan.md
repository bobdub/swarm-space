# Fix: wall-post media visible through pub walls

## Diagnosis (confirmed in code)

The pub walls, roof, and builder-mode blocks are all real 3D meshes with opaque materials — depth occlusion works correctly between them (that's why trees and the environment are properly hidden when you're inside the pub).

What shows *through* the walls is the wall-post media (the floating post cards in the screenshot):

- `src/components/world/WallPostBillboard.tsx:379` renders each wall post as a drei `<Html transform>` DOM overlay with `zIndexRange={[10, 0]}` and **no occlusion**. DOM elements are composited above the WebGL canvas, so they ignore 3D depth and paint over any wall.
- `src/components/world/UserPlacementsLayer.tsx:132` does the same for the selection action chip (`zIndexRange={[100, 0]}`).

## Fix (small, no architecture change)

1. **WallPostBillboard.tsx** — add `occlude` to the `<Html transform>` element so the billboard is hidden whenever 3D geometry (pub walls, roof, other builds) sits between the camera and the post. Keep `transform` so the media stays flat on the wall.
2. **UserPlacementsLayer.tsx** — add `occlude` to the selection chip `<Html>` for the same reason (a selected wall's chip currently floats through buildings too).
3. Sanity-check other drei `Html` overlays in the brain scene (e.g. `HubBuildLayer` compound labels are Virtual Hub only — leave alone unless they share the problem).

## Notes / trade-offs

- drei `occlude` uses raycast-based occlusion: fine at the current billboard counts in a scene. If a performance issue appears with many decorated walls, the fallback is a manual line-of-sight check (raycast from camera to billboard each ~200 ms, hide via style) — only add if needed.
- No changes to walls, blocks, trees, or the physics layer; this is purely a rendering fix.

## Verification

- Typecheck + build.
- Playwright screenshot from inside the pub: wall posts outside must not render; from outside, they render normally; video/audio playback in a billboard still works when visible.
