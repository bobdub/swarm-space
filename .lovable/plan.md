
Goal: make the volcano part of the same Earth organism instead of a separate prop, fix the camera/control inversion at the real source, and stop the player floor from phasing through volcanic geometry.

1. Unify the camera and movement basis
- In `src/components/brain/BrainUniverseScene.tsx`, remove the double application of yaw.
- Right now the scene pre-rotates `fwdCam/rightCam` by `yawRef.current`, then `uqrcPhysics.ts` rotates that basis again with `intent.yaw`, which is why controls still invert after spinning.
- Make one source of truth:
  - either send an unrotated tangent basis plus `intent.yaw`, or
  - send already camera-relative basis and set `intent.yaw = 0`.
- Use the camera’s actual projected forward/right on the local tangent plane so movement always matches the current view.

2. Replace “visual-only volcano props” with one Earth organ descriptor
- In `src/lib/brain/nature/volcanoSeed.ts`, stop seeding three guaranteed village volcanoes.
- Change the volcano selection model to exactly one active volcano near the shared village:
  - choose the best convergent seam site within reach;
  - if none exists, choose one deterministic fallback;
  - never prepend three fallback entries.
- Return a single shared volcano descriptor: site normal, cone radius, cone height, crater radius, shaft depth, pressure radius.

3. Make the volcano part of the Earth surface itself
- In `src/components/brain/EarthBody.tsx`, add vertex displacement for the chosen volcano site so the ground rises into a cone from the planet mesh itself instead of intersecting with a separate cone object.
- Keep the crater as part of the same displaced landform.
- Move plume/glow rendering to a lightweight overlay anchored to the crater only; the cone/base should come from Earth geometry, not a stacked prop.

4. Make collision use the same volcanic surface function
- In `src/lib/brain/earth.ts`, add a shared surface sampler such as:
  - base visible ground radius
  - plus local volcanic elevation offset from the single volcano descriptor.
- Expose helpers for:
  - visible surface radius at a normal/position
  - body shell radius above that local ground
  - structure shell radius above that local ground
- Replace fixed-radius assumptions where needed so the “floor” is the same organ the player sees.

5. Remove the current collision cheat that ignores local terrain shape
- In `src/lib/brain/uqrcPhysics.ts`, stop treating `BODY_SHELL_RADIUS` as globally flat around the whole planet for volcanic regions.
- Sample the local target shell from the shared Earth/volcano surface function when applying:
  - radial restoring force
  - idle settle dead-band
  - walk-shell stabilization.
- This makes the player stand on the volcanic slope instead of clipping through a visual mesh while physics still thinks the world is a perfect sphere.

6. Tie mantle venting to the same single volcano organ
- In `src/lib/brain/lavaMantle.ts`, replace the broad multi-site vent assumption with the chosen active volcano descriptor for the village region.
- Keep the vent sink deep in the mantle, but align its centerline with the same site used by:
  - Earth surface displacement
  - crater/plume rendering
  - local collision shell.
- This removes the split between “mantle pressure logic” and “surface volcano art”.

7. Simplify volcano rendering in `NatureLayer`
- In `src/components/brain/nature/NatureLayer.tsx`, stop rendering multiple full cone volcano props.
- Keep only secondary effects that belong above the crater:
  - vent glow
  - smoke/ash plume
  - optional lava throat detail visible only inside the crater.
- Do not draw a full underground shaft through the ground unless the terrain is explicitly opened for it.

8. Keep wet-work intact and separate from false artifacts
- Do not remove `WetWorkHabitat`.
- Leave the wet-work organism as the only habitat system.
- Only remove volcano visuals that duplicate Earth geometry or create false intersections.

Files to modify
- `src/components/brain/BrainUniverseScene.tsx`
- `src/components/brain/EarthBody.tsx`
- `src/components/brain/nature/NatureLayer.tsx`
- `src/lib/brain/earth.ts`
- `src/lib/brain/uqrcPhysics.ts`
- `src/lib/brain/lavaMantle.ts`
- `src/lib/brain/nature/volcanoSeed.ts`

Technical details
- Current camera bug: yaw is applied twice across scene intent + physics intent.
- Current volcano bug: three fallback volcanoes are intentionally prepended in `volcanoSeed.ts`.
- Current phasing bug: volcano is rendered as a separate object, while Earth collision still resolves to a constant spherical shell.
- Fix direction: one shared volcano organ descriptor consumed by mantle, terrain, render, and collision.

Validation
- Verify only one volcano appears near the village.
- Verify walking uphill onto the volcano raises the player naturally with no ground clipping.
- Verify the crater/plume aligns with the mantle vent site.
- Verify WASD/joystick remain camera-relative after 360° spins and across horizon changes.
- Verify idle standing on normal ground and on volcano slopes no longer jitters.