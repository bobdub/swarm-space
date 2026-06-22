# Live Post Preview Sizing + Cross-Feature Scaffolding

Focus: shrink the inline live-post preview to a compact card (full surface lives in the floating dock), and stand up lightweight scaffolding for the four still-rough areas (Grid QA, Plot QA, Bar interactions, Landmarks v1) without committing to their final shape.

## Part 1 — Live post preview sizing (visible fix)

Today `LivePostBoxBody` renders the entire live surface inline: brain/classic preview pane (`16/10` aspect), A/V control row, **and a 200 px-min classic chat panel**. On a 360 px mobile post that's ~500 px tall inside a feed card. The floating dock already owns the full surface; the inline copy should be a one-glance **preview card**, not a duplicate dock.

### What changes

`src/components/streaming/LivePostBox.tsx`:

- Keep the existing auto-pop behaviour. The "Chat is open in the floating window — Dock back here" pill stays as-is.
- When **not** popped out (initial mount before auto-pop, or after user docks back), render a new compact component `LivePostPreview` instead of `LivePostBoxBody`.
- `LivePostBoxBody` itself is unchanged structurally — it remains the body the floating dock and any explicit "expand inline" path mounts.

New `src/components/streaming/LivePostPreview.tsx`:

- Single rounded card, full width of post, fixed height clamp `min-h-[140px] max-h-[200px]` with `aspect-[16/9]` so it scales cleanly on 360 → 1280 viewports.
- Background: same brain-gradient backdrop used today (extracted as `BrainPreviewBackdrop`).
- Foreground: Live badge (single, not two), title (clamp 1), participant count, two buttons:
  - **Open chat** → `setFloatingLiveDock(...)` (re-pops the dock if user closed it).
  - **Join Live Brain** → opens the immersive scene directly (reuses `liveChatVariant` path).
- No A/V controls, no chat panel inline. Those exist only in the dock / immersive view.
- Removes the double "Live" marker (today both `LivePostBox` collapsed state and `LivePostBoxBody` header render badges).

`src/components/streaming/LivePostBoxBody.tsx`:

- Remove `aspectRatio: '16/10'` lock on the preview pane and let it fill the dock's available height (the dock chrome already sets dimensions). This stops the preview from being letterboxed when the dock is taller than wide.
- Cap classic chat `min-h-[200px]` → `min-h-[140px]` so the dock works on shorter screens.

### Verification

- Open a feed post with an active live room on mobile preview (360×557): post card height ≤ 260 px until user opens dock.
- Tap **Open chat** → floating dock mounts, post collapses to the existing "Chat is open in the floating window" pill.
- Single "Live" badge visible in each state.
- Floating dock preview pane scales to dock size; no letterbox.

## Part 2 — Scaffolding (no behaviour change, ready for next pass)

For each untested area: a `docs/` runbook + a typed seam where the next implementation lands. No new runtime branches enabled by default.

### 2a. Builder Grid QA scaffold

- `docs/qa/builder-grid.md` — manual QA script: enter Builder Mode, drop one wall, verify snap to WALL_PITCH, drag a second wall to confirm coplanar snap, confirm grid overlay aligns to world-origin (not bar-origin), screenshot checklist.
- No code change — flagged hotspots from the prior `BuildGridOverlay` move are already shipped.

### 2b. Plot QA scaffold

- `docs/qa/land-plots.md` — walk-claim happy path, foreign-plot rejection, insufficient SWARM disabled-confirm, minimum-4-walls loop closure, persistence across reload.
- New `src/lib/world/__tests__/landPlots.test.ts` covering pure helpers: `cellRectFromTrail`, `priceForRect`, `rectOverlapsForeign`, `getPlotAtTangent`. Pure data, no DOM.

### 2c. Bar interactions scaffold

- New `src/lib/world/barInteractions.ts` — typed registry:
  ```ts
  export type BarInteractionId = 'sit' | 'order' | 'darts' | 'pool' | 'jukebox';
  export interface BarInteraction { id: BarInteractionId; label: string; anchorTag: string; status: 'planned' | 'beta' | 'shipped'; }
  export const BAR_INTERACTIONS: BarInteraction[] = [/* all 'planned' for now */];
  ```
- `docs/features/bar-interactions.md` — design notes: anchor tags on bar prefab pieces (`tag: 'bar-stool'`, `tag: 'pool-table'`), proximity trigger radius, single shared `useNearbyInteractable` hook (to be implemented later).
- No UI wiring yet.

### 2d. Landmarks v1 scaffold

- New `src/lib/world/landmarkCatalog.ts` — empty catalog with the type signature the future Landmarks tab will consume:
  ```ts
  export interface LandmarkPrefab { id: string; label: string; sizeCells: { w: number; d: number }; tier: 'common' | 'rare'; }
  export const LANDMARK_CATALOG: LandmarkPrefab[] = [];
  export function landmarksForPlot(/* unlocksLandmarks */): LandmarkPrefab[] { return []; }
  ```
- `docs/features/landmarks.md` — gating rule (owner standing inside own plot), placement rule (one landmark per plot, anchored to plot centre cell), pricing TBD.
- Builder bar can later import `landmarksForPlot` and conditionally render a section; not wired now.

### Files

**New**
- `src/components/streaming/LivePostPreview.tsx`
- `src/components/streaming/BrainPreviewBackdrop.tsx` (extracted gradient block)
- `src/lib/world/__tests__/landPlots.test.ts`
- `src/lib/world/barInteractions.ts`
- `src/lib/world/landmarkCatalog.ts`
- `docs/qa/builder-grid.md`
- `docs/qa/land-plots.md`
- `docs/features/bar-interactions.md`
- `docs/features/landmarks.md`

**Edited**
- `src/components/streaming/LivePostBox.tsx` — swap inline body for `LivePostPreview`, drop second Live badge.
- `src/components/streaming/LivePostBoxBody.tsx` — remove 16/10 aspect lock on preview pane, lower chat `min-h`.

## Out of scope

- Wiring landmark catalog into Builder Bar UI (deferred until catalog has content).
- Bar interaction triggers / proximity engine.
- Any UQRC change — last patch is final.
- Floating dock chrome redesign.
