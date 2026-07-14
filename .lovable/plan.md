# Move the Bar Lights switch onto the bar wall by the door

## Goal
Relocate the working "Bar Lights: ON/OFF" toggle from its fixed
bottom-left screen corner onto the south wall of the bar, next to the
doorway. Nothing else changes — same store, same toggle behaviour, same
label, same on/off styling. Just a new position.

## Why the naive approach ("render a 3D mesh, use R3F onClick") is
## rejected

The existing button's own header comment (`src/components/brain/BarLightSwitchButton.tsx:1-10`) explains
that the switch is **deliberately a plain DOM element** because in-canvas
raycast clicks in this scene are unreliable — orbit controls, pointer
lock, invisible colliders and the avatar's own click handlers all
compete for the pointer. Turning it into a `<mesh onClick>` inside the
WebGL canvas would break the "100% guaranteed to work" requirement on
day one. Any plan that puts the switch inside the R3F scene graph fails
the user's brief.

## The plan — keep it DOM, pin it to a world-space anchor

Use `@react-three/drei`'s `<Html>` helper (already a project
dependency, `package.json:50`). `<Html>` renders arbitrary DOM as a
child of a Three.js group and reprojects it to screen coordinates each
frame using the live camera. The DOM node itself is a normal HTML
button — clicks go through the standard DOM path, not raycasts — so
reliability is identical to today.

Anchor the `<Html>` group to a point on the south wall (the wall
containing the doorway), just to the right of the opening, at
switch-plate height. In `SurfaceBar`'s local frame (see
`src/components/brain/SurfaceBar.tsx:20-31`, `98-107`):

- The south wall is at `z = -HALF_D` (= -10 m).
- The doorway is centred at `x = 0` with half-width `DOOR_HALF = 1.4`.
- The wall runs from `x = +DOOR_HALF` to `x = +HALF_W` on the right of
  the door.

The anchor point is:

```
localX = DOOR_HALF + 0.4       // 40 cm right of the door frame
localY = 1.3                   // ~switch-plate height above floor
localZ = -HALF_D + WALL_T/2 + 0.01  // flush with the interior face
```

This is then transformed into world space through the same tangent-
frame helper already used by `BuilderBlockView` — we do **not** compute
it ourselves; we reuse the existing block placement pattern so the
switch tracks the bar exactly like the wall segments and sign already
do.

## Concrete changes (only these files)

### 1. `src/components/brain/BarLightSwitchButton.tsx`
Add an **optional** `variant` prop:

- `variant="overlay"` (default) — unchanged behaviour, keeps existing
  fixed-position styles. Existing tests
  (`src/components/brain/__tests__/BarLightSwitchButton.test.tsx`) keep
  passing untouched.
- `variant="wall"` — same button, but with `position: 'static'` and
  slightly smaller padding so it sits nicely as a wall plate. Same
  click handler, same store call, same label, same on/off colours.

No existing call site is modified; only a new prop is added with a
backwards-compatible default.

### 2. `src/components/brain/SurfaceBar.tsx`
Inside the existing return, add one new `<BuilderBlockView>` (or reuse
the roof block's local frame — same pattern as `Doorway lintel` at
`src/components/brain/SurfaceBar.tsx:349-356`) that wraps a drei
`<Html>` positioned at the local coordinates above, with
`transform occlude={false} distanceFactor={8}` so the DOM plate scales
with distance but is always clickable (drei `<Html>` uses a real DOM
overlay, not raycasting). Inside the `<Html>`:

```tsx
<BarLightSwitchButton variant="wall" />
```

That's it. The button component is reused verbatim; only its container
changes.

### 3. `src/pages/BrainUniverse.tsx`
Remove the single line at `src/pages/BrainUniverse.tsx:22`
(`<BarLightSwitchButton />`) and its import at line 10. The switch now
lives inside `SurfaceBar` and is anchored to the wall.

Nothing else in this file is touched.

## Why this is 100% guaranteed to work

1. The button component itself is not rewritten — its click handler,
   its `toggleBarLights()` call, its store subscription, and its
   existing unit tests all remain byte-for-byte identical on the
   default `variant="overlay"` path. The `variant="wall"` path only
   changes CSS positioning, not behaviour.
2. drei `<Html>` renders the button as **real DOM outside the canvas**.
   Clicks are handled by the browser's normal event system, so the
   "raycast/orbit-control swallows the click" failure mode called out
   in the button's own comment cannot occur.
3. The anchor uses the same `BuilderBlockView` local frame the doorway
   lintel already uses, so its world position is derived from the bar's
   existing pose — no new math, no new transforms, no drift risk.
4. If `SurfaceBar` is not mounted (e.g. the bar has despawned), the
   switch is simply absent — the same behaviour as today when the DOM
   overlay is removed from `BrainUniverse.tsx`. No orphan state.

## Verification

After the change:

1. `bun run build` and run `BarLightSwitchButton.test.tsx` — must pass
   unchanged (they exercise `variant="overlay"`).
2. Launch `/brain`, walk up to the bar's south wall, click the plate to
   the right of the door — bar lights toggle, and the label flips
   between "ON" and "OFF" exactly as before.
3. Confirm the fixed bottom-left overlay is gone (no duplicate switch).
4. Move the camera around; confirm the plate stays visually attached
   to that wall spot (drei `<Html>` projection).

## Out of scope

- No changes to `barLightsStore`, lighting logic, `SurfaceBar` walls,
  furniture, sign, doorway, physics, or any other file.
- No visual redesign of the button beyond the minimal `variant="wall"`
  layout tweak needed to sit on a wall.
- No new dependencies (`@react-three/drei` is already installed).
