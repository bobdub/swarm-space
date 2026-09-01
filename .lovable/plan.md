# Land ownership: protection, surface markers, and dev roads

Owned land should be genuinely protected, visibly marked on the ground, and there should be a communal layer (roads, squares) that only devs can lay down.

## Current state (verified)

- Plots live in `src/lib/world/landPlots.ts` (localStorage, cell rects in the lattice-origin tangent frame) with helpers `getPlotAtTangent`, `rectOverlapsForeign`.
- Ownership is enforced in only two places today — prefab **place** and prefab **edit/move** in `BrainUniverseScene.tsx` ("This land belongs to another player").
- Not gated: deleting/decorating an existing placement, terrain sculpting/digging (`toolActions.ts`, `carvedCellsStore.ts`), and plot survey overlap on claim.
- `LandPlotsOverlay` renders only while Builder Mode is on, and shows a bare outline plus a red fill for foreign plots — no owner identity, no always-on marker.
- There is no dev/admin role anywhere in the project.

## What we'll build

### 1. One permission gate, used everywhere

Add `canBuildAt(tx, tz, actorId)` to `landPlots.ts` returning `{ allowed, reason, plot }`:

- Unclaimed land: allowed.
- Own plot: allowed.
- Foreign plot: denied ("This land belongs to <owner>").
- Communal/road plot: denied for everyone except devs (so roads can't be built over).
- Devs: allowed anywhere (they maintain the commons).

Route every mutation through it: prefab place, prefab move/edit, prefab **delete**, wall decorate, and the sculpt/dig tool actions. Denials show a toast and change nothing.

Also block claiming a plot that overlaps a foreign or communal plot (`rectOverlapsForeign` already exists; wire it into the survey confirm path).

### 2. Dev allowlist

New `src/lib/world/devRoles.ts` with a hardcoded `DEV_PEER_IDS` list and `isDev(peerId)`. You give me the peer IDs to seed it with (or I leave it empty and you paste yours in — it's a one-line edit).

### 3. Surface ownership markers (always on, toggleable)

Rework `LandPlotsOverlay` so it renders regardless of Builder Mode:

- Ground tint per plot: green = yours, amber = another player's, blue-grey = communal/road.
- Boundary outline stays, slightly brighter while building.
- A small owner nameplate (drei `<Html>`, distance-faded, occluded) at the plot centre showing the owner's display name, or "Public / Road".
- Low opacity by default so the world stays clean; boosted while Builder Mode is on.
- A HUD toggle ("Show land") next to the existing builder controls, persisted in localStorage, that hides all plot overlays.

### 4. Dev roads and communal areas

Extend `LandPlot` with `kind: 'private' | 'road' | 'commons'` (defaults to `'private'`, so existing saved plots keep working).

Devs get a **Commons** tool in the builder bar: same walk-the-loop survey as a land claim, but free (no SWARM burn), and on confirm it claims the rect as a `road` or `commons` plot owned by `public`. Roads render as a distinct surface strip and everyone may walk them; nobody but a dev may build on them, and private claims can't overlap them.

## Technical notes

- Files touched: `src/lib/world/landPlots.ts` (kind + `canBuildAt`), new `src/lib/world/devRoles.ts`, `src/components/world/LandPlotsOverlay.tsx` (always-on markers, nameplates, kind colours), `src/components/world/PlotSurveyOverlay.tsx` (free commons survey + overlap rejection), `src/components/brain/builder/BrainBuilderBar.tsx` (dev Commons tool + Show land toggle), `src/components/brain/BrainUniverseScene.tsx` (route place/edit/delete/decorate through `canBuildAt`), `src/lib/world/toolActions.ts` (sculpt gate).
- Migration is additive: plots missing `kind` are read as `'private'`.
- Nameplates use `occlude="blending"` to avoid the earlier raycast-occlusion performance regression.
- New unit tests in `src/lib/world/__tests__/landPlots.test.ts` covering `canBuildAt` for owner / foreigner / dev / road, and overlap rejection on claim.
- Enforcement stays client-side, consistent with the existing local-first trust model; no chain or backend changes.
