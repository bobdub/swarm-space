---
name: Pub Games
description: Pub game system — proximity anchors, host-authoritative table store, mesh gossip, SWARM stakes/escrow and buy-a-drink
type: feature
---

THE PUB IS THE INTERFACE — players walk up to furniture in the Brain's
SurfaceBar, press E, and play. No separate game screen.

- Anchors: `src/lib/world/pubAnchors.ts` registers interactables by their
  BuilderBlock bodyId; tags come from `src/lib/world/barInteractions.ts`.
- Proximity: `useNearbyInteractable` polls at 5 Hz; `PubGameLayer` renders one
  contextual prompt and the game panel. Q or walking away 10 s frees the seat.
- Table state: `src/lib/pub/gameTableStore.ts`. Host = earliest-joined seat.
  Host runs the reducer, broadcasts the table (`pub:table`, LWW on `seq`);
  others send intents (`pub:table:intent`). Backfill via sync-request/response.
- Rules live in pure reducers — `src/lib/pub/darts.ts` (501). Adding a game
  means adding a reducer, never new plumbing.
- Build order: darts (done) → SWARM stakes/drinks (done) → chess → liar's
  dice → hold'em. Hidden-info games need the host-deals private path.
- SWARM layer (`src/lib/pub/stakes.ts`, `PubStakePanel.tsx`): free play
  (stake 0) is always the default and never touches the ledger. Staked tables
  are FROZEN until every seat ticks agree AND buys in; changing the stake
  clears all agreements. One debit per seat into `pub-escrow:<tableId>`, one
  settlement transfer to the winner by the host (`settled` flag = pay once).
  Leaving clears that seat's agreement/funding; a reset re-opens buy-ins.
- Drinks (`src/lib/pub/drinks.ts`): 1 SWARM per glass to `pub-bar-sink`,
  gossiped on `pub:drink`, idempotent on event id, 120 s TTL. Pops a glass
  prop (`PubDrinkProps`) beside the recipient and dispatches a
  `pub:chat-line` window event that BrainUniverseScene appends to Brain chat.
