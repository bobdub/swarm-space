# Why the Brain effects are invisible — and what to change

I ran the engine checks against the current tree rather than assuming the last turn landed.

## What is actually true right now

- Build is clean (`build OK`), and every new layer **is** mounted: `CarvedCellsLayer`, `WeatherLayer`, `HeldToolMesh` in `BrainUniverseScene.tsx:2057-2059`, `VolcanoLavaPool` in `nature/NatureLayer.tsx:245`.
- `scripts/uqrc-check.mjs` reports no contradictions from the new modules; the top stress files are all pre-existing (`lab.bus.ts`, `galaxy.ts`, `feed.ts`).
- Test suite: 214 passing, 1 real failure (`mediaCoin` needs `URL.createObjectURL` in jsdom), 4 files unresolvable because they import `bun:test` under vitest. All pre-existing, none touch the new code.

So nothing is broken — the effects are **gated behind a door almost nobody opens**.

## The five real defects

1. **No tool can ever be in hand.** `setHeldTool` is called from exactly one place: picking a placed tool back up in `UserPlacementsLayer`. A player must forge in the Lab → mint → place in the world → walk over → pick up before any tool mesh, swing FX, or dig exists. `heldToolStore` is also pure in-memory, so a refresh silently empties the hand.
2. **Digging is unreachable without that tool**, so the Earth shells still cannot be verified — the original complaint is untouched in practice.
3. **Weather is village-local and slow.** Clouds only spawn within 60–280 m of the `swarm-shared-village` anchor, capped at 5, and the loop only ticks while the Brain scene is mounted. Humidity starts at 0.35 and gains ~0.02/s off dry land, so first cloud is ~30 s away and invisible anywhere else on the planet.
4. **Digs are private.** `carvedCellsStore` persists to `localStorage` only — no gossip through `p2pPlacementBridge`, so a pit one peer digs does not exist for anyone else, contradicting the shared-world rule.
5. **No conformance coverage.** There are no tests for `weather.ts`, `carvedCellsStore.ts`, or the `shell` branch of `applyImpact`, so the UQRC coupling (rain → curvature → harder cutting) is unverified.

## Changes

### 1. Give every player a starting tool
- Seed the hand on first Brain entry with a `tool_shovel_stone` (and make the Lab's forge output auto-equip). No physics change — it writes only `heldToolStore`.
- Persist the held prefab id in `localStorage` so a refresh restores the hand; the source placement record stays optional (a seeded tool has none, dropping just re-places it).
- `HeldToolHUD` gains an explicit tool picker for the stone knife / axe / shovel so switching action kinds needs no world round-trip.

### 2. Make digging discoverable
- Show the shell label + depth on the ground reticle whenever a dig-capable tool is held, so the player sees "Grass (n=1)" before swinging.
- Keep `applyImpact` untouched — it already answers shells correctly; only the affordance changes.

### 3. Weather that follows the player
- Anchor cloud spawning to the local player's Earth-local normal instead of the fixed village frame, keeping the same 1 Hz tick and the same `MAX_CLOUDS` cap.
- Raise starting humidity and evaporation floor so the first cloud arrives in a few seconds, and keep the drift/charge maths exactly as-is.
- Weather keeps running via the existing `WeatherLayer` mount; no new timers.

### 4. Share carved cells
- Broadcast `cell-carved` through the existing `p2pPlacementBridge` gossip path (last-writer-wins on `updatedAt`), and apply inbound carves via `carveCell`'s quantised key. Same pattern as world placements, no new transport.

### 5. Conformance tests
- `weather.test.ts` — evaporation → condensation → rain sequence, and that a raining tick raises the field's commutator norm without breaching `FIELD3D_BOUND`.
- `carvedCells.test.ts` — cell key stability under Earth spin, monotonic depth, `DIG_MAX_DEPTH_M` floor.
- Extend the sculpting test with the shell branch: lava rejection, sharpness threshold, and that `weatherCurvatureBoost` raises resistance.

## Technical notes

- No new constants enter the physics operator; weather still perturbs the field only through `injectAt`, per the `/brain` gradient-only rule.
- Held-tool persistence stores an id, never a physics body — no divergence between peers.
- Existing pre-turn failures (`bun:test` files, `mediaCoin` blob URL) are out of scope unless you want them folded in.
