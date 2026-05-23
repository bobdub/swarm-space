## Plan

1. Restore wall + decoration persistence on refresh
- Wire world placement hydration into the Brain scene boot path so placed walls are replayed every time the universe loads, matching the persistence behavior users already get from portals.
- Verify decoration metadata reattaches during replay so a refreshed wall still shows its pinned post.

2. Fix wall move mode so it does not freeze or disappear
- Rework the wall edit flow so entering Move does not leave the wall in a removed/no-ghost state.
- Seed the cast ghost from the existing wall position in a way the AssetCaster can actually render immediately, then keep cancel/confirm restoring or updating the same placement cleanly.
- Preserve controls while moving so camera/drag interaction remains responsive.

3. Restore the on-wall confirm/checkmark during Move
- Ensure the same in-world confirm UI used for placement also appears for wall edits.
- Keep the action chip and cast-confirm UI from conflicting, so users see one clear confirmation path while moving or decorating.

4. Make wall posts scale to the wall face correctly
- Update the billboard sizing logic to derive its usable display area from the placed wall dimensions instead of a nearly fixed panel feel.
- Tune image/text layout so posts read like full posters on the wall, not tiny cards floating in the middle.

5. Validate the full wall workflow
- Check these flows end-to-end: place wall, decorate wall, refresh, move wall, cancel move, confirm move, re-open actions, and verify the post remains attached and visually fills the wall.

## Technical details
- Likely files: `src/components/brain/BrainUniverseScene.tsx`, `src/components/world/AssetCaster.tsx`, `src/components/world/UserPlacementsLayer.tsx`, `src/components/world/WallPostBillboard.tsx`, `src/lib/world/worldPlacementsStore.ts`.
- Main fixes are expected in two areas:
  - boot-time replay of `worldPlacementsStore` records
  - edit-mode cast seeding/confirmation so the ghost, wall body, and checkmark stay in sync
- I will keep the existing decorate architecture and only patch the persistence/move/render bugs you listed.