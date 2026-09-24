# Builder Needs — Brain World

The Brain builder's current status and what it still needs. This is the live checklist for gameplay basics, and it replaces the older phase docs now in `docs/archive/`.

## Working now
- Starter tools are free: Axe, Shovel, Knife, Bucket and Pick (stone).
- An equipped tool shows in the hand, and the compact HUD shows Use / Drop.
- **Swing-to-hit:** press Use near something you can work and the tool hits it without tapping it first (`resolveNearbyTarget` in `toolActions.ts`). It picks the closest thing in reach and favours what you are facing.
  - Axe → tree, 4.2 m reach. Three cuts fell the tree, then 3 wood drops land on the ground.
  - Pick → mountain (14 m) / volcano (18 m), 1 stone drop per bite.
  - Bucket → flower / grass (2.8 m), fish / water (3.2 m). The item is removed from the world when you collect it.
- **Solid obstacles:** trees, walls, doors, fences, houses and rocks push the walker back sideways (`resolveSolidObstacles` in `uqrcPhysics.ts`). The size of each object comes from `solidRadiusFor()`; set `meta.solidRadius` on a piece to override it.
- You can walk and place: the build ghost follows you, and you can rotate it, place it or cancel.
- Builder Options tab: grid & physics, land, camera, and avatar choice (Rabbit / Cat / Dragon).

## Open needs (priority order)
1. **Fruit.** The world has no fruit yet. Add a `fruit` nature kind that hangs on trees and falls as a `food` drop. The Bucket or Knife should collect it and remove it.
2. **Shovel swing-to-dig.** Digging still needs a tapped ground (`shell`) target. Build a shell target from the point in front of the player so Use digs without a tap. The hole also needs to show up visibly in the ground mesh (check `CarvedCellsLayer`).
3. **Stone from walking into rock.** Stone currently comes only from Pick bites. Decide whether hard collisions with boulders should chip stone.
4. **Wall shape.** Walls collide as a circle 1.1 m wide. Long walls need a box-shaped collider (length/width aligned to the wall's rotation) to close gaps at the ends.
5. **Volcano grounding.** Players can still sink through the volcano slope. Replace the `|dr| < 1.0` settle band with a hard floor at `BODY_SHELL_RADIUS + elevation`.
6. **Other avatars (network).** Collision runs on each player's own device. Remote avatars are pushed out on the viewer's screen only.
7. **Tests.** Add unit tests for `solidRadiusFor`, the push-out, and `resolveNearbyTarget`.

## Rules to keep
- Every change to the world goes through `applyImpact` and the land-ownership check (`landBlocks`).
- `builderBlockEngine` is the only place that creates bodies for objects.
- No `<form>` elements. Buttons use `type="button"`.
