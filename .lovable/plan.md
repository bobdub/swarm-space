# Bar Light Switch — Simple, Guaranteed Fix

## Approach
Throw away the fancy 3D rocker panel. Replace it with a plain HTML button in a `<Html>` overlay anchored inside the bar. HTML buttons click reliably 100% of the time — no raycast, no z-fighting, no invisible wall blocking, no R3F event graph issues. That's what has been failing.

One button. One light group. On/off. Nothing else.

## Steps

### 1. Rip out the broken switch
In `src/components/brain/SurfaceBar.tsx`:
- Delete the `bar-switch` BuilderBlock I added on the outside wall.
- Delete the 3-mesh rocker panel and its click handlers.
- Keep the ceiling lights and sconces exactly as they are.

### 2. Add one boolean + one HTML button
Still in `SurfaceBar.tsx`:
- `const [lightsOn, setLightsOn] = useState(true);`
- Drive the ceiling `<pointLight>` and sconce `<pointLight>` `intensity` from `lightsOn` (on = current value, off = 0).
- Add one drei `<Html>` overlay positioned just inside the south doorway at ~1.4m height, `distanceFactor={6}`, `occlude={false}`, `zIndexRange={[100, 0]}`:
  ```
  <button
    type="button"
    onClick={(e) => { e.stopPropagation(); setLightsOn(v => !v); }}
    onPointerDown={(e) => e.stopPropagation()}
    data-testid="bar-light-switch"
  >
    Lights: {lightsOn ? 'ON' : 'OFF'}
  </button>
  ```
- Styled as a chunky pill (dark wood bg, amber text when on, dim grey when off) so it reads as a switch, not a debug button.

### 3. Verification — three independent checks, all must pass

Run all three. If any fails, the fix is not shipped.

**Check A — Unit test** (`src/components/brain/__tests__/SurfaceBar.switch.test.tsx`):
- Render `<SurfaceBar />` inside a test `<Canvas>` wrapper.
- Find button by `data-testid="bar-light-switch"`.
- Assert initial text `Lights: ON`.
- `fireEvent.click`. Assert text becomes `Lights: OFF`.
- Click again. Assert `Lights: ON`.

**Check B — Playwright live-preview click** (`/tmp/browser/switch/test.py`):
- Navigate to `http://localhost:8080/brain`.
- Wait for canvas, teleport/walk avatar next to the bar south doorway (or just widen the `<Html>` distanceFactor so it's visible from spawn for the test).
- Screenshot `1_before.png`.
- `page.get_by_test_id("bar-light-switch").click()`.
- Screenshot `2_after.png`.
- Assert button text changed from ON → OFF.
- Click again, screenshot `3_toggled.png`, assert OFF → ON.
- Print console logs; fail on any error containing "switch" or "SurfaceBar".

**Check C — Visual pixel diff of the lit area**:
- In the same Playwright run, take element screenshots of a fixed bar-interior region before and after click.
- Compare mean pixel brightness with PIL. Assert lights-off frame is measurably darker (mean luminance drop > 15%). This is what proves the lights *actually changed* — not just the label.

Only after A, B, and C all pass in one run is this reported as fixed. Screenshots + brightness numbers get shown back to you.

## Why this is guaranteed
- HTML button click ≠ 3D raycast. No possibility of a mesh, wall, roof, or invisible collider blocking it.
- `stopPropagation` on both `pointerDown` and `click` prevents avatar/orbit controls from swallowing it.
- The pixel-brightness assertion prevents a false-positive where the label toggles but the lights don't respond.

## Non-goals
Everything not listed above.