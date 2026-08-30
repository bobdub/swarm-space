# Pub Games v1 — Texas Hold'em, Chess, Darts, Liar's Dice

The pub is the interface. Everything happens at furniture inside the Brain's
SurfaceBar: walk up, press E, join, play, leave, or just stand and watch.

## What already exists (reuse, don't rebuild)

- **The pub itself** — `src/components/brain/SurfaceBar.tsx` already renders the
  bar with physical collisions, and there is already an in-world DOM control
  pattern (drei `<Html>` + `BarLightSwitchButton`) that survives raycasts.
- **Interaction registry** — `src/lib/world/barInteractions.ts` already declares
  anchor tags and radii for `bar-stool`, `bar-counter`, `darts-board`,
  `pool-table`, `jukebox`, all `status: 'planned'`. The proximity hook described
  in `docs/features/bar-interactions.md` was never built; it is the missing piece.
- **Multiplayer sync** — `p2pPlacementBridge.ts` shows the exact pattern to copy:
  a local store + `attach*Gossip` + `mesh.broadcast(channel)` + `acceptPeer*`
  with last-writer-wins, plus a sync-request/response backfill for late joiners.
  `barLightsStore.ts` is the smallest working example of that shape.
- **Player presence and position** — physics bodies and remote avatars are
  already live in `BrainUniverseScene.tsx`, so proximity and spectating are free.
- **Token + balances** — `getSwarmBalance` / `transferSwarm` / `burnSwarm` in
  `src/lib/blockchain/token.ts`, plus credits in `src/lib/credits.ts`.
  Everything needed for stakes exists; nothing new is required on-chain.

## Core design decisions

1. **One shared game-table store, four rule modules.** A single
   `src/lib/pub/gameTableStore.ts` holds table records
   (`{ tableId, game, seats, spectators, state, updatedAt, hostPeerId }`) and
   gossips over one mesh channel, exactly like bar lights. Each game is just a
   pure reducer file: `holdem.ts`, `chess.ts`, `darts.ts`, `liarsDice.ts`.
   Adding a game = adding a reducer, never new plumbing.
2. **Host-authoritative, not consensus.** The first player to sit becomes the
   table host; the host runs the reducer and broadcasts the resulting state.
   Everyone else sends intents (`sit`, `leave`, `move`, `throw`, `bet`). If the
   host leaves, the next seat by join order takes over from the last state.
   This is the only realistic option for a P2P mesh at this scope.
3. **DOM game panel, in-world entry.** Entry, seat, spectate and leave happen in
   3D. The actual cards/board render in a compact panel anchored to the table
   (`<Html>` on the table, or a corner overlay on mobile). Nobody leaves the pub.
4. **SWARM stakes are ledger-light.** No transaction per action.

## Entering and leaving a game

- New hook `useNearbyInteractable(playerPos)` walks placements tagged with an
  `anchorTag` from `BAR_INTERACTIONS`, picks the closest inside `radiusM`,
  returns `{ interaction, anchorPos, tableId }`.
- HUD shows one prompt: `Press [E] to join Hold'em` (desktop) or a tap button
  (mobile). Pressing it claims a free seat and opens the panel.
- Any player inside the radius who is **not** seated is auto-listed as a
  spectator and sees the public state (community cards, board, scoreboard) —
  never anyone's hole cards.
- Leaving: press `Q`, close the panel, or walk outside the radius for 10s.
  Poker seats fold-and-cash-out; chess forfeits after a 30s reconnect grace.

## SWARM in v1 (deliberately minimal)

- **Free play is the default.** Every table opens with `stake: 0`. Stakes are
  opt-in and every seated player must tick "agree" before the hand starts.
- **Escrow, not per-action transfers.** On table start each player's buy-in is
  debited once via `transferSwarm` into a table escrow key. On table end, one
  settlement transfer per winner. A poker session = 2 ledger writes per player,
  not one per bet. In-hand chips are plain numbers in table state.
- **Buy a drink / buy a round** — a single `buyDrink(targetPeerId | 'table')`
  helper: fixed small price, one `transferSwarm` to the bar sink (or burn),
  then a gossiped `drinkGranted` event that pops a glass prop on the recipient's
  spot and a chat line ("bobdub bought the table a round").
- **Balance is checked before sitting**, never mid-hand, so no one gets stuck.

## Major technical problems to know up front

- **Hidden information.** Hold'em hole cards and liar's dice cups cannot be
  broadcast in clear. v1: the **host deals** and sends each player only their
  own cards over a direct peer message. Accepted trade-off — the host could
  cheat. Mitigation is a commit-reveal deal, explicitly deferred to v2, and the
  UI must say "friendly table, host deals" while stakes are enabled.
- **Host churn.** Browser tabs close. Host handoff from last-known state must be
  in v1 or tables will lock up.
- **Mesh ordering.** Gossip is unordered; every table state carries a
  monotonically increasing `seq` and stale/duplicate frames are dropped.
- **Bar prefab has no game furniture yet.** SurfaceBar currently has no dartboard
  or card table mesh; v1 adds simple ones and stamps the anchor tags.
- **Mobile input.** Darts needs an aim-and-throw gesture; keep it to a
  tap-charge-release on a fixed reticle rather than free mouse aiming.

## Recommended first prototype: DARTS

Build darts first, not poker. It exercises the whole pipeline — proximity entry,
seats, turn order, spectators, host authority, an optional agreed stake — with
**no hidden information and no complex rules**. 501 down, three throws a turn,
first to exactly zero. If darts works end to end with two browsers, the same
store carries the other three games.

(Chess is second: also zero hidden info. Liar's dice third. Hold'em last,
because it is the only one that needs the private-deal path plus escrow.)

## Phased build order

1. **Phase 1 — Rails.** `useNearbyInteractable` hook + HUD prompt + dartboard
   and card-table meshes in SurfaceBar carrying anchor tags. Flip the darts
   entry to `status: 'beta'`. No gameplay yet; the prompt just opens an empty panel.
2. **Phase 2 — Darts prototype.** `gameTableStore` + mesh gossip channel +
   `darts.ts` reducer + panel UI + spectator view + host handoff. Free play only.
   Test with two browsers.
3. **Phase 3 — SWARM layer.** Agreed-stake toggle, escrow debit/settle,
   `buyDrink` for a player and for the table, drink prop + chat line.
4. **Phase 4 — Chess**, reusing everything (reducer + board panel only).
5. **Phase 5 — Liar's dice**, adds the private-value path (host deals cups).
6. **Phase 6 — Texas Hold'em**, reusing the private path plus multi-round betting
   against escrowed chips.

Stop after Phase 2 and play it before committing to Phase 3.
