## Goal

Give portals and prefabs (walls, etc.) the same placement mechanic:

1. Select asset → a ghost spawns in front of the camera on the planet surface.
2. Drag the ghost around Earth to reposition.
3. Press **Confirm** to commit, **Cancel** to discard.

Today the two paths diverge:
- **Portals** use the shared `AssetCaster` cast registry but drop on the first tap (no preview, no drag).
- **Prefabs/walls** use a separate `PlacementInteractor` that *also* commits on `pointerdown`. The duplicate surface plus the recent overlay-inertness wiring is why selecting a wall feels like “nothing happens” — the click either races the overlay or the ghost never positions itself somewhere visible.

The fix is to collapse both into one **PlacementSession** with reposition + confirm.

## Approach

### 1. Extend the cast registry into a placement session
`src/lib/world/assetCaster.ts`
- Rename concept from `PendingCast` → `PlacementSession` (keep `setPendingCast` alias for back-compat to avoid touching unrelated imports).
- Add fields:
  - `hitPoint: Vec3 | null` (live ghost position)
  - `status: 'positioning'`
  - `onConfirm(hit, payload)` (replaces `onHit`)
  - optional `ghost: { kind: 'box', w,h,d,color } | { kind: 'ring', color }`
- Add `updateHit(hit)`, `confirmCast()`, plus existing `clearPendingCast()` for cancel.

### 2. Unify the in-Canvas surface
`src/components/world/AssetCaster.tsx`
- On arm: raycast from the camera forward through the Earth sphere to get an initial hit; seed `session.hitPoint`. This is the “spawns in front of you” behavior.
- Render the ghost based on `session.ghost` (box for prefabs sized from prefab dims, ring for portals).
- Pointer events on the raycast shell call `updateHit` (no commit on tap). Pointer events on the ghost itself start a drag that follows the pointer across the Earth shell.
- Remove the immediate `onHit → clearPendingCast` path.

### 3. Retire `PlacementInteractor`
`src/components/world/PlacementInteractor.tsx`
- Delete. Its responsibilities move into `AssetCaster`.
- In `BrainUniverseScene.tsx`, remove the `<PlacementInteractor>` mount.

### 4. Drive prefab placement through the session
`src/components/brain/BrainUniverseScene.tsx`
- Add an effect that watches `builder.selectedPrefabId`:
  - On select: open a placement session with `kind:'prefab'`, ghost = box from prefab dims/color, `onConfirm` calls `placePrefabAtHit` + `recordLocalPlacement` and then `builder.selectPrefab(null)`.
  - On deselect/unmount: `clearPendingCast()`.
- Portal `handleBeginPortalCast` switches from immediate drop to opening a session with `kind:'portal'`, ghost = ring, `onConfirm` calls `handleDropPortal(hit)`.

### 5. HUD: add Confirm + Cancel
`src/components/brain/BrainUniverseScene.tsx` (`CastHUD`)
- While a session is armed, show the label plus two buttons:
  - **Confirm** → `confirmCast()` (no-op if `hitPoint` still null)
  - **Cancel** → `clearPendingCast()` (also clears `selectedPrefabId` for prefab sessions)
- Buttons are `type="button"`, only the buttons get `pointer-events-auto` so the planet stays interactive for drag.

### 6. Keep the overlay-inertness already in place
`scenePlacementArmed = castArmed || prefabPlacementArmed` already disables `DesktopLookOverlay` / `TouchLookOverlay`. No change needed once both flows route through `pendingCast` — `castArmed` alone will cover it, but we keep the OR for safety.

## Files touched
- `src/lib/world/assetCaster.ts` — session shape, `updateHit`, `confirmCast`.
- `src/components/world/AssetCaster.tsx` — camera-forward seed, drag-to-move, ghost rendering, no tap-commit.
- `src/components/brain/BrainUniverseScene.tsx` — wire prefab selection to session, switch portal cast to confirm flow, add Confirm/Cancel to `CastHUD`, drop `PlacementInteractor` mount.
- `src/components/world/PlacementInteractor.tsx` — delete.

## Out of scope
- Multi-axis rotate / scale on the ghost (yaw stays 0 for this pass).
- Physics-body preview (we keep the lightweight ghost mesh; commit still routes through `BuilderBlockEngine` / `placePrefabAtHit` unchanged).
- Persistence/gossip changes — `recordLocalPlacement` is still called on confirm.
