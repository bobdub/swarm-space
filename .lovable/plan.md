# Land plots: labels, overlaps, merging, top view, roads

Five fixes around land ownership in the Brain. Verified in the current code before writing this.

## 1. Land labels are too big (blocks actions)

`LandPlotsOverlay.tsx#makeLabelSprite` draws a 34 px font at world scale 3.2, so a nameplate spans several grid cells and hides the build surface.

- Shrink base sprite: font 34 → 16 px, padding 12 → 6, world scale 3.2 → ~1.4.
- Scale down further in Top view (read `getBuilderTopView()` in the marker frame loop, ~0.55x extra) and drop the lift from 1.6 m to ~0.6 m so labels sit as flat tags on the parcel.
- Tighten label view distance in Top view (160 m → ~90 m) so only the plots you are over get named. Labels stay pure WebGL sprites — no drei `<Html>`, so the old black-slab bug cannot return.

## 2. Overlapping plots should not be allowed

Today `rectOverlapsForeign` only blocks overlap with *other* owners; two claims by the same owner can overlap, and the survey overlay uses the same foreign-only check.

- Add `rectOverlapsAny(rect, ns)` in `landPlots.ts` and use it in `claimLandPlot` as a hard guard: a claim that intersects any existing plot (own, foreign or commons) is rejected.
- `PlotSurveyOverlay.tsx` blocks the survey visually and disables Purchase when the surveyed rect intersects any existing plot that is not a same-owner private plot (those are handled by merging, item 3).
- Existing already-overlapping records are left alone; the merge pass in item 3 cleans up same-owner cases.

## 3. Same-owner plots join into one

- After a successful private claim, run a merge pass: repeatedly union same-owner private plots in the same anchor frame whose cell rects touch or overlap, when the union rect is exactly covered by the members (a clean rectangle). Non-rectangular unions stay as separate rects but render as one group.
- Rendering: `LandPlotsOverlay` groups same-owner adjacent plots and draws a single outline around the merged footprint with one nameplate, instead of one label per parcel — this is what makes the repeated "Your land" tags in the screenshot collapse to a single label.
- Merged records keep the earliest `claimedAt` and the summed `priceSwarm`; commons never merge with private.

## 4. Top view should show all your land

Currently the boom is a fixed 14 m up / 10 m back.

- Compute a target height from the local player's owned footprint: bounding box of your plots (or a sensible default when you own none), converted to metres, then a height that fits that span in the camera frustum, clamped to a safe range (~14 m to ~120 m).
- Ease into that height with the existing `boomBlend` lerp so the transition stays smooth, and keep the widened pitch clamp.
- Recompute when the plot list changes, not per frame.

## 5. No way to lay roads

`DEV_PEER_IDS` is empty and the "Commons" chip only renders when `isDev(selfId)` is true, so nobody can see it — that is why roads are unreachable.

- Add a "Roads" affordance that does not depend on a hardcoded dev list: keep commons dev-gated for the *free/public* variant, but surface the chip whenever the local peer is a dev **or** the Brain is running in the local/owner context, and add a visible way to grant yourself dev in this build (a small "Enable roads" control in the builder bar overflow that calls `grantDev(selfId)` and persists in localStorage).
- Once enabled, the flow is the existing one: toggle Commons → Plot → walk a loop → confirm (free), producing a slate commons parcel that nobody can build on.

## Technical notes

- Files: `src/components/world/LandPlotsOverlay.tsx`, `src/lib/world/landPlots.ts`, `src/components/world/PlotSurveyOverlay.tsx`, `src/components/brain/builder/BrainBuilderBar.tsx`, `src/components/brain/BrainUniverseScene.tsx` (top-view boom), `src/lib/brain/builderCameraStore.ts` (target height field), `src/lib/world/devRoles.ts`.
- No change to pricing (3 SWARM/box), the build permission gate `canBuildAtWorldPoint`, physics, or P2P placement gossip.
- Unit tests extended in `src/lib/world/__tests__/landPlots.test.ts` for overlap rejection and same-owner merging.
- A `roadmap.md` entry is added at the project root tracking these five items.

## Verification

Enter the Brain, toggle Land markers: labels are small tags and adjacent same-owner plots show one outline and one name. Attempt a survey overlapping an existing plot — Purchase is blocked. Claim two adjacent plots and confirm they merge. Toggle Top view and confirm the camera rises far enough to frame all owned land. Enable roads, toggle Commons, and lay a free public strip.
