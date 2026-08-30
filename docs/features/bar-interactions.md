# Bar Interactions (Scaffold)

Status: **darts shipped (beta)** — proximity hook + table store live;
the remaining interactions are still `planned`.

## Goal

The starter bar prefab (replacing the previous example structure) contains
stools, a counter, a darts board, a pool table, and a jukebox. Each piece
gets an anchor tag so a proximity scan can surface a context HUD when the
player approaches.

## Anchor tags (source of truth)

Defined in `src/lib/world/barInteractions.ts`:

| Interaction | Anchor tag      | Radius |
| ----------- | --------------- | ------ |
| Sit         | `bar-stool`     | 1.0 m  |
| Order drink | `bar-counter`   | 1.5 m  |
| Play darts  | `darts-board`   | 2.5 m  |
| Play pool   | `pool-table`    | 2.0 m  |
| Pick a song | `jukebox`       | 1.5 m  |

The bar prefab stamps these tags onto the corresponding placed pieces at
spawn. Tag string is the contract between the prefab and the proximity hook.

## Trigger model (implemented)

`src/hooks/useNearbyInteractable.ts` polls the local avatar at 5 Hz and:

1. Iterate world placements with a `tag` matching any `anchorTag` in `BAR_INTERACTIONS`.
2. Picks the closest within its `radiusM`.
3. Returns `{ anchor, interaction, distance } | null`.

Anchors register themselves at spawn through `src/lib/world/pubAnchors.ts`
(bar prefab → BuilderBlock bodyId → live world position). `PubGameLayer`
renders one contextual prompt (`Press [E] to Play darts`), opens the game
panel, and frees the seat when the player walks away for 10 s or presses Q.
Prompts are gated on `status !== 'planned'`.

## Darts table (v1)

- State lives in `src/lib/pub/gameTableStore.ts`; rules in `src/lib/pub/darts.ts`.
- Host = earliest-joined seat. Host runs the reducer and broadcasts the table;
  everyone else sends intents on `pub:table:intent` and renders what arrives.
- Table snapshots gossip on `pub:table` with last-writer-wins on `seq`,
  plus `pub:table:sync-request/response` backfill for late joiners.
- Free play only so far: `stake` exists on the table but nothing debits it yet.

## Out of scope (this scaffold)

- Minigame implementations (darts, pool).
- Inventory / drink economy.
- NPC bartender wiring.
- Persistent seat occupancy.