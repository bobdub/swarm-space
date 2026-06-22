# Bar Interactions (Scaffold)

Status: **planned** — registry shipped, runtime wiring TBD.

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
| Play darts  | `darts-board`   | 1.5 m  |
| Play pool   | `pool-table`    | 2.0 m  |
| Pick a song | `jukebox`       | 1.5 m  |

The bar prefab stamps these tags onto the corresponding placed pieces at
spawn. Tag string is the contract between the prefab and the proximity hook.

## Trigger model (to implement)

A single hook `useNearbyInteractable(playerPos)` will:

1. Iterate world placements with a `tag` matching any `anchorTag` in `BAR_INTERACTIONS`.
2. Pick the closest within its `radiusM`.
3. Return `{ interaction, anchorPos } | null`.

The HUD reads that and renders a single contextual prompt
(`Press [E] to sit`, etc.). Gate prompts on `status !== 'planned'`.

## Out of scope (this scaffold)

- Minigame implementations (darts, pool).
- Inventory / drink economy.
- NPC bartender wiring.
- Persistent seat occupancy.