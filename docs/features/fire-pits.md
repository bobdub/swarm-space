# Fire pits

Players make fire on the island by building a **Fire Pit** and feeding it gathered **Wood**.

## Building the pit

- Open Builder Mode, go to **Tools**, and pick **Fire Pit**. It places like any other build (ghost, then a short raise).
- Cost: **4 Stone**, derived from the pit's all-mineral constituents (`Si₆Ca₂Fe`) by `materials.ts` like every prefab. It is not flammable and is never carried: it has no "Pick up" action even though it sits in the Tools tab.
- Prefab id: `fire_pit_stone` (`FIRE_PIT_ID` in `src/lib/brain/prefabHouseCatalog.ts`).

## Lighting and feeding

- Tap the pit (owners see it in their Edit/Delete chip; anyone else within 12 m gets a small fire chip).
- **Light fire / Add wood** spends **1 Wood** from that player's own bag. Wood comes from chopping trees with the Stone Axe and picking up the logs.
- 1 Wood burns **5 minutes**. Wood on a burning fire extends it, up to **30 minutes** ahead; past that the button is disabled ("the pit is full"). Wood on a cold pit starts a new fire.
- The fire goes out by itself when its time runs out. Anyone can feed anyone's pit.

## How every peer sees the same fire

`src/lib/world/fireStore.ts` keeps a log of fuel facts (`pitId`, `actorId`, `wood`, `at`). Whether a pit burns is a pure fold of those facts over the shared clock (`burnUntil`), so peers holding the same facts agree on the flames and on when they die, with nothing sent when a fire goes out. Facts gossip like nature events in `p2pPlacementBridge.ts` (`fire:event`, plus a backfill request to each newly connected peer and every 2 minutes), are relayed once to other peers, persisted in localStorage, and dropped after 24 hours. Wood is spent locally only, before the fact is recorded.

Tunables live at the top of `fireStore.ts`: `BURN_MS_PER_WOOD`, `MAX_BURN_MS`, `WOOD_PER_FUEL`.
