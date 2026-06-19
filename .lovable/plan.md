# BuildGridOverlay v2 — World-Anchored, Terrain-Hugging, Player-Following

The current overlay is wrong on two axes:

1. **Anchor**: it's pinned to `SHARED_VILLAGE_ANCHOR_ID`, treating the bar as the centre of the world. The bar is just a worked example.
2. **Altitude**: it sits at `BODY_SHELL_RADIUS + 0.02` — the flat physics shell — so over any terrain with elevation/lift it floats above the actual ground.

UQRC/lightspeed framing for the fix:

- **Coordinate truth = Earth-local tangent frame at the observer.** Per `𝒟_μ u(x) := ( u(x + ℓ_min e_μ) - u(x) ) / ℓ_min`, the grid lattice is a discrete sampling of the tangent connection at the player's foot. So the grid must re-anchor at the local body each tick, not at a faraway village.
- **Lightspeed budget.** `𝒞_light(Δt) := c · Δt` says any visible feature can only travel `c · Δt` per frame. A grid 40 m wide at 60 fps moves negligibly relative to `c`, so per-frame re-anchoring is causally trivial — but the lattice phase must stay continuous (no integer-snap of the centre to a cell, or it visibly judders). We anchor the **mesh** to the player and pass an integer **cell-offset uniform** to the shader so the painted lines stay locked to absolute world cells.
- **Curvature closure.** `Q_Score` rewards `‖[D_μ,D_ν]‖ ≈ 0`. Pinning the disk to the player's live tangent basis keeps the grid orthonormal at the observer; lines drift back into the planet's curvature naturally at the disk edge where the fade already kills them.

## Changes

### 1. World-anchored cells (no village dependency)
Add to `src/lib/world/buildGrid.ts`:
- `worldCellOriginLocal(localNormal)` → returns the integer-cell-aligned tangent origin for any point on Earth (uses two stable basis axes derived from `localNormal` the same way `getEarthLocalSiteFrame` does, so every viewer gets the same lattice).
- Lattice is global: cell `(0,0)` is defined at the Earth-local pole reference, not at the village.

### 2. Terrain hugging
Use `sampleSurfaceLift(localNormal)` from `src/lib/brain/surfaceProfile.ts` to lift each frame's disk centre onto the actual ground, exactly like `spawnNearSharedVillage` does (lines ~200–210 of `BrainUniverseScene.tsx`). The disk centre y now matches the visible terrain, eliminating the float.

To handle the disk crossing terrain slopes within its 40 m radius without bulk-deforming geometry (cheap), keep the disk flat at the player and lean on the radial fade: anywhere ground rises/falls more than ~0.5 m the grid quietly fades. (Full per-vertex lift sampling is deferred — flagged below.)

### 3. Follow the player, not a fixed anchor
`BuildGridOverlay` props become:
- `selfId: string` — local peer id; resolves the live body via `getBrainPhysics().getBody(selfId)`.
- `fallbackAnchorPeerId?: string` — only used pre-spawn.

Per frame:
1. Read body world pos (or spawn fallback).
2. Convert to Earth-local unit normal via `quatRotate(pose.invSpinQuat, …)`.
3. `lift = sampleSurfaceLift(localNormal)`; place disk at `(EARTH_RADIUS + lift) * normal` in Earth-local, then `earthLocalToWorld(...)` → world pos.
4. Build basis `(right, up, forward)` from that local normal (same construction as `getEarthLocalSiteFrame`, snapped through the live spin quat for orientation).
5. Pass `uCellOffset = (origin.x mod CELL, origin.z mod CELL)` into the shader so lattice phase stays locked to absolute cells while the mesh slides with the player.

### 4. Mount call
`BrainUniverseScene.tsx`:
```diff
-{isBuilding && <BuildGridOverlay anchorPeerId={SHARED_VILLAGE_ANCHOR_ID} />}
+{isBuilding && <BuildGridOverlay selfId={selfId} fallbackAnchorPeerId={SHARED_VILLAGE_ANCHOR_ID} />}
```

### 5. Shader update (`BuildGridOverlay.tsx`)
- New uniform `uCellOffset: vec2` consumed in `gridMask`: `gridMask(vLocal + uCellOffset, pitch, lineW)`. Result: lines paint at absolute world-cell positions even though the disk mesh follows the player.
- Bump `uOpacity` default to `0.7` and dim `uColor` to `#94a3b8` for a less Bar-themed look (world-grid, not bar-grid).

## File-by-file

```text
src/lib/world/buildGrid.ts                  [edit] add worldCellOriginLocal()
src/components/world/BuildGridOverlay.tsx   [edit] selfId-driven, terrain lift, cell-offset uniform
src/components/brain/BrainUniverseScene.tsx [edit] pass selfId instead of village anchor
```

## Out of scope (flagged, not built now)

- **Per-vertex terrain conformance** of the grid disk (would need a tessellated mesh + per-vertex lift sample). Deferred until users complain about the edge fade on steep terrain.
- Moving cell `(0,0)` to a designer-chosen world origin; current pole-reference is fine for now.

## Verification

1. Toggle Builder Mode while standing far from the bar — grid recentres under the player.
2. Walk: lines slide under the feet rather than dragging with the mesh (cell-offset uniform working).
3. Stand on a hill / dune: grid hugs ground, not floating at shell height.
