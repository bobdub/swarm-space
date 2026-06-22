# Landmarks v1 (Scaffold)

Status: **scaffold only** — type seam in place, catalog empty.

## Gating rule

A player may place a landmark **only** while standing inside one of their own
claimed plots (`LandPlot.ownerId === selfId` and `unlocksLandmarks === true`).
Builder Bar surfaces the Landmarks tab conditionally; tab is hidden otherwise.

## Placement rule

- One landmark per plot for v1.
- Anchored to the plot centre cell.
- Re-placement replaces the existing landmark (no inventory loss).

## Pricing

TBD. The catalog `LandmarkPrefab.priceSwarm` field is optional — undefined
means free to plot owners (already paid the plot cost).

## API seam

From `src/lib/world/landmarkCatalog.ts`:

```ts
interface LandmarkPrefab {
  id: string;
  label: string;
  sizeCells: { w: number; d: number };
  tier: 'common' | 'rare';
  priceSwarm?: number;
}

function landmarksForPlot(plot: LandPlot | null): ReadonlyArray<LandmarkPrefab>;
```

Builder Bar should render an empty "Coming soon — first landmark drops at v1.1"
tile while `LANDMARK_CATALOG` is empty.

## Out of scope

- Catalog content (flag, fountain, signpost prefabs).
- Multi-landmark plots.
- Trading / transferring landmarks.
- Chain-backed landmark deeds.