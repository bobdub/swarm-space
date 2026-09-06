# A new building framework for the Brain

Rebuild how you see yourself, choose what to make, and actually make it. Four parts, each usable on its own.

## 1. Over-the-shoulder view

- You see your own character from slightly behind and above, by default, everywhere in the Brain.
- A small view button (and the `V` key) flips between over-the-shoulder and close-up first person.
- The camera swings smoothly and keeps the character clear of the ground and of walls behind you.
- The existing overhead "Top view" for building stays as a third option while the builder is open.

## 2. Materials, in plain words

Everything you gather becomes a simple material — Wood, Stone, Water, Fibre, Food — instead of chemical letters. Existing gathered amounts are carried over, so nothing you already collected is lost.

## 3. The new inventory display

- Replaces the bottom builder bar. Press `B` (or the hammer button) and a transparent panel fades into the middle of the screen; the world stays visible behind it and you can still hear and talk to people.
- Left side: sections — Gathered, Structures, Doors & Windows, Roofs, Tools.
- Each item is a tile showing its picture, its name and the materials it needs (for example "Wood 4 · Stone 2").
- If you don't have enough, the tile is dimmed and can't be picked; hovering says what's missing.
- Your current material totals sit along the top of the panel.
- Closing: pick an item, press `B` again, or press Escape.

## 4. Ghost previews you control

- Picking an item closes the panel and drops a translucent ghost a couple of steps in front of you.
- The ghost stays in front of you as you walk and turn — it no longer skates around with the mouse.
- On the ghost: a check mark to place, a rotate arrow, and a cancel X. On desktop, click to place, `R` to rotate, `Esc` to cancel. On mobile, tap the buttons.
- Once placed, the ghost stops following you and waits on the ground.
- Only you see your own ghosts. Other people see the finished object only.

## 5. Building it

- Walk up to a placed ghost and a small prompt appears on it: **Build — press and hold**.
- Hold the mouse button (or your finger) on it. A ring fills and the prompt becomes a countdown.
- Build time scales with the item's size and material cost — a small wall is a few seconds, a roof section longer.
- Let go early and the progress eases back down rather than resetting instantly.
- At zero, the materials are spent, the ghost turns solid, and the finished object appears for everyone.
- If materials ran out in the meantime, the prompt says so instead of building.

## 6. Chopping trees

- Walk to a tree with an axe held, swing, and you see your character swing.
- The tree shakes on each hit, and after a few hits it topples and drops wood pieces on the ground.
- Walk over the wood to pick it up; it flies to you and your Wood total ticks up.
- The stump fades away shortly after.
- Digging, water, fruit and flowers follow the same pattern later — this build does trees, and leaves the existing dig behaviour untouched.

## Technical notes

- Camera: extend `PhysicsCameraRig` in `BrainUniverseScene.tsx` with a third-person boom (back ~4.5 m, up ~2.2 m, eased like the existing `boomBlend`), plus a short raycast pull-in against terrain. New `cameraViewStore.ts` alongside `builderCameraStore.ts` holds `'third' | 'first' | 'top'`. Render the local player using `RemoteAvatarBody` driven by the self body, hidden in first person.
- Materials: new `src/lib/world/materials.ts` maps the element counts already in `harvestedInventory` to the five display materials (and back for spending), so persistence and NPC harvest paths are unchanged. Prefab costs derive from `constituents` in `prefabHouseCatalog.ts` — no hand-typed numbers.
- Inventory UI: new `src/components/brain/builder/BuilderInventory.tsx` replacing `BrainBuilderBar` as the primary surface (bar kept only for the mode toggles). `role="form"`, all buttons `type="button"` per project rules.
- Ghost: rework `AssetCaster.tsx` + `assetCaster.ts` so an armed cast has a `follow` state — position recomputed each frame from the avatar's forward vector instead of pointer raycast; click transitions `follow -> staged` rather than committing.
- Staged ghosts live in a new local-only `pendingBuildsStore.ts` (IDB, not gossiped). Completion calls the existing `getBuilderBlockEngine().placeBlock(...)` — still the single writer — which already persists and gossips to peers.
- Press-and-hold: new `BuildProgressRing` on the staged ghost; hold timer in a `useFrame` loop, duration `f(volume, total material cost)`, spends through `spendHarvested`.
- Trees: extend `toolActions.ts` `chop` with per-tree hit counts, add falling/topple animation to `NatureLayer`/`SurfaceTree`, drop pickups via a small `worldDropsStore`, and reuse `emitSwingFx` for the swing.

## Verification

Playwright run in the preview: enter the Brain, confirm the character is visible from behind, open the inventory and screenshot the dimmed vs available tiles, pick a wall, screenshot the ghost holding position in front while walking, place it, hold to build, and confirm the solid object appears. Then chop a tree and confirm wood is added.
