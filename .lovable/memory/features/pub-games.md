---
name: Pub Games
description: Darts-first pub game system — proximity anchors, host-authoritative table store, mesh gossip, SWARM stakes deferred
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
- Build order: darts (done) → SWARM stakes/drinks → chess → liar's dice →
  hold'em. Hidden-information games need the host-deals private path.
- SWARM: free play is always the default; stakes will use one escrow debit per
  seat and one settlement transfer, never per-action transactions.
