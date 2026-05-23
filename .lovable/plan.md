## Goal
Fix two decorate-mode regressions in the Brain world:
1. Publishing a wall decoration must leave the wall visible in-world.
2. The wall action chip (`Move`, `Decorate`, `Delete`) must not appear while the decorate composer is open.

## Plan
1. Stabilize the wall after publish
   - Trace the decorate flow from `WallDecorateComposer` through `wallDecorations` and `worldPlacementsStore` to confirm the placement record survives publish.
   - Adjust the in-world wall rendering so a decoration update does not make the wall disappear when the placement record or block briefly re-syncs.
   - If needed, keep the wall mesh/render path resilient during decoration updates instead of dropping to `null` while the block/store refreshes.

2. Isolate decorate mode from selection actions
   - Add an explicit “decorate mode” signal in the Brain scene.
   - Pass that state into `UserPlacementsLayer` so the wall’s action popover is suppressed while the decorate composer is active.
   - Ensure wall clicks don’t immediately re-select and reopen the `Move / Decorate / Delete` UI behind the composer.

3. Preserve current move behavior
   - Keep the existing `Move` behavior that uses the on-wall checkmark/confirm flow.
   - Make sure the decorate-state guard does not interfere with move mode, placement confirm, or normal wall selection once the composer closes.

4. Validate the exact flow
   - Verify: select wall → Decorate → publish → wall remains visible with its attached post.
   - Verify: while decorating, the wall action chip is hidden.
   - Verify: after closing decorate mode, wall selection and move/delete actions still work normally.

## Technical details
- Primary files:
  - `src/components/brain/BrainUniverseScene.tsx`
  - `src/components/world/UserPlacementsLayer.tsx`
  - `src/components/world/WallDecorateComposer.tsx`
  - `src/components/world/WallPostBillboard.tsx`
  - `src/lib/world/worldPlacementsStore.ts`
- Likely implementation approach:
  - Introduce a decorate-active prop/state in scene-layer coordination.
  - Gate wall action-chip rendering with that state.
  - Make the wall + billboard render path tolerate placement/block refresh after `decorateWall(...)` updates.