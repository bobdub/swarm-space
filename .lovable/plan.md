## Goal

Make the **Plot toggle** discoverable on the Brain Builder Bar (mobile-safe), and fix the **build grid** so one grid box = one wall length = 3 SWARM, with assets snapping along those lines.

## Findings

- `BrainBuilderBar.tsx` already renders `Plot`, `Free Build`, and `Magnetic` toggles in the top row using `flex items-center gap-3` with multiple chips and labels. On a 360px viewport that row overflows / pushes `Plot` off-screen, which matches the "not found" report.
- `useBrainBuilder` defaults: `magnetic = true` ✓, `freeBuild = false` ✓, `plotting = false` (user requested **default On** for the *toggle visibility*, not auto-claim — interpreted as "always-visible chip").
- `src/lib/world/buildGrid.ts` exports `CELL = 1.0` and `WALL_PITCH = 2.5`. `BuildGridOverlay` paints both, so the visible grid has 1 m minor lines + 2.5 m major lines. Walls span 2.5 m, so the visual "box" the user expects (4 walls = 1 box) is the *major* line spacing, not the minor.
- `landPlots.ts` already prices at `BOX_PRICE_SWARM = 3` per `WALL_PITCH × WALL_PITCH` cell — no economic change needed.
- Snap helper `snapToCell` defaults to `CELL` (1 m). Placement currently slides in 1 m steps, not wall-length steps.

## Changes

### 1. `src/components/brain/builder/BrainBuilderBar.tsx`

- Re-flow the top row into a **two-row layout on narrow viewports**: prefab badge + Exit on top; toggle chips (Magnetic, Free Build, Plot) on a dedicated row below, wrapped with `flex-wrap gap-2`. Guarantees all three chips visible at 360 px.
- Tighten chip labels on `<sm` (icon + short label) so they never clip.
- Add `data-testid="builder-toggle-plot"` etc. for QA.

### 2. `src/lib/world/buildGrid.ts`

- Set `CELL = WALL_PITCH` (= 2.5 m) so the visible grid box equals one wall and one plot cell. Remove the redundant minor lattice.
- Keep `WALL_PITCH` and `Y_STEP` unchanged.
- `snapToCell` now snaps to 2.5 m by default → asset drags slide along wall-length lines (left/right/up/down).

### 3. `src/components/world/BuildGridOverlay.tsx`

- Since `CELL === WALL_PITCH`, drop the `minor` shader pass and render only the major (wall-pitch) lines, slightly bolder. Keeps the visual exactly as the user described: one line per wall, intersections form one plot-priced box.

### 4. `src/lib/world/__tests__/landPlots.test.ts`

- Add a regression test asserting `PLOT_CELL === WALL_PITCH === CELL`, so any future drift between asset snap and plot pricing fails fast.

### 5. `docs/qa/builder-grid.md`

- Update steps 2–3: snap pitch is now 2.5 m everywhere; one cell = one wall = 3 SWARM. Remove the "1 m minor lines" expectation.

## Notes:

- Plot-toggle *default On* as in "auto-start walking a survey" — read as "chip always visible", which is what this delivers. If you actually meant the survey should auto-arm when entering Builder Mode, say so and I'll flip `plotting` default in `useBrainBuilder`.
- Builder Bar visual redesign beyond the wrap fix.
- Any landmark / bar-interaction wiring (scaffolding already shipped).

User Notes:   
I want to open builder mode and click plot when I am ready to plot and purchase land.   
Scaffolding for landmarks are in place and should be charted:   
  
- Trader Stand  
Sell collected items from in world play.  
  
- Statue  
A rock statue rending of a users avatar.   
  
- Weighted Coins  
If users have created a weighted coin they may use it here.  
  
Landmarks are only allowed on plotted land, other assets can be freely placed in the world or on plotted land by the owner.