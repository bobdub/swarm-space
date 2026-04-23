# Brain Nature & Biology — Phased Build Plan

> Status: **Approved plan, Phase 0 (clean state).** No code has landed yet.
> Companion to `BUILDING_BLOCKS_ENGINE.md`, `BRAIN_UNIVERSE.md`, `VIRTUAL_HUB.md`.

## Principle

Three engines, each owns one duty, each only talks to the layer beneath it.
Biology is **physics expressing itself** — never a parallel sim.

```
BiologyEngine        ← decides WHAT kind of piece appears/disappears (life rules)
       │ requests via API
       ▼
BuilderBlockEngine   ← decides HOW pieces enter/leave the world (place/remove/upgrade)
       │ requests via API
       ▼
GameEngine (UqrcPhysics) ← decides WHERE pieces are (position, field, curvature)
```

Existing reality at Phase 0:

- ✅ `GameEngine` = `UqrcPhysics` (`src/lib/brain/uqrcPhysics.ts`).
- ⚠️ `BuilderBlockEngine` documented in `BUILDING_BLOCKS_ENGINE.md` but only
  `SurfaceTree.tsx` exists as a one-off — no formal API yet.
- ❌ `BiologyEngine` not started.

Invariant across all phases: **biology and builder code never write to
`field.axes`, `body.pos`, or pin templates directly.** All world mutation
goes through `BuilderBlockEngine`. Same spirit as the operator-only-writes-
pinTemplate rule.

---

## Phase 1 — Formalize the BuilderBlockEngine (API only)

**Goal:** turn the SurfaceTree pattern into a reusable engine with one entry
point. Nothing visual changes; the existing tree migrates to use the new API
to prove it works.

**Deliverables**

1. `src/lib/brain/builderBlockEngine.ts` — singleton with:
   - `placeBlock({ id, kind, anchorPeerId, lat?, lon?, yaw?, mass, basin, meta })`
     → registers UQRC body + pin, returns handle.
   - `removeBlock(id)` — unpin + removeBody.
   - `upgradeBlock(id, { kind?, mass?, basin? })` — re-pin with new basin
     (used later by biology for seed→sapling→tree).
   - `getBlock(id)` / `listBlocks(filter?)` — read-only views for renderers.
   - `subscribe(fn)` — listeners notified when blocks placed/removed.
   - Internally uses `getBrainPhysics()` + `getEarthLocalSiteFrame` — same
     math as SurfaceTree, lifted into one place.
2. `src/components/brain/builder/BuilderBlockView.tsx` — generic renderer that
   subscribes to the engine and reprojects to `FEET_SHELL_RADIUS` per frame
   (the SurfaceApartment contract, lifted).
3. Migrate `SurfaceTree.tsx` → thin wrapper that calls
   `builderBlockEngine.placeBlock` on mount and lets `BuilderBlockView` render it.
4. Update `docs/BUILDING_BLOCKS_ENGINE.md` — replace "design / reference"
   status with "implemented in `builderBlockEngine.ts`", document the API surface.
5. Memory: `mem://architecture/builder-block-engine` (type: feature) describing
   the API + invariants. Update `mem://index.md`.

**Verification:** `/brain` looks identical to today; the tree still renders;
physics body + pin counts unchanged. No new visible content.

**Out of scope:** persistence, collider fix, any new species, biology, HUD changes.

---

## Phase 2 — Author the Nature Catalog (content only)

**Goal:** define the static nature pieces as data, render them through the
BuilderBlockEngine. World gains visible biome but nothing grows or moves yet.

**Deliverables**

1. `src/lib/brain/nature/natureCatalog.ts` — `NATURE_CATALOG` (water, grass,
   flower, tree, fish, hive, bees) with real compound constituents, mass,
   basin, color (re-uses `blendColor` from `compoundCatalog`).
2. `src/lib/brain/nature/natureSeed.ts` — deterministic
   `seedDefaultBiome(anchorPeerId)` placing the starter set via
   `builderBlockEngine.placeBlock`. Golden-angle scatter; same anchor → same layout.
3. `src/components/brain/nature/NatureLayer.tsx` — mounts on `/brain`, calls
   seed once, renders each block with kind-specific geometry inside `BuilderBlockView`.
4. Mount `<NatureLayer />` in `BrainUniverseScene.tsx`. Remove the standalone
   `<SurfaceTree />` (the catalog includes one tree at the same spot).

**Starter biome**

- Pond of water tiles
- Grass blades scattered around
- 18 flowers
- 10 fish (7 ♀, 3 ♂)
- 10 tree seeds (rendered as mature trees in Phase 2; growth lands in Phase 3)
- 1 bee hive with starter bees + queen

**Verification:** `/brain` shows pond, grass, flowers, fish (static), hive,
bees (static), trees. Counts match catalog. Earth rotates → biome rotates with
it. No movement, no birth/death.

**Out of scope:** biology, persistence, fish/bee animation, HUD.

---

## Phase 3 — BiologyEngine v1 (motion + life-cycle, scoped + capped)

**Goal:** add the BiologyEngine as a separate system that reads physics, calls
BuilderBlockEngine. Nothing else touches it.

**Deliverables**

1. `src/lib/brain/biology/biologyEngine.ts` — singleton with:
   - `tick(dt)` driven by NatureLayer's 10 Hz loop.
   - Per-species pure rule functions returning intents
     (`spawn` / `remove` / `upgrade` / `move`).
   - Single applier executes intents via `builderBlockEngine`. Hard caps per
     species enforced here.
   - **Invariant:** never calls `physics.injectAt`, never mutates `field.axes`
     or `body.pos` directly. Movement = repeatedly calling
     `builderBlockEngine.upgradeBlock` with new `lat/lon`.
2. Rules implemented (small, observable):
   - Tree (mature) + low local `‖F_μν‖` → emit `seed` within 4 m.
   - Seed → sapling → tree over N ticks of sustained calm.
   - Bee state machine: idle → flower → home → `hive.honey += 1`.
   - Hive `honey ≥ 50` AND `worker_bee` count < cap → spawn worker.
   - Fish ♀+♂ in calm water → `fry`; fry → fish over N ticks.
   - Flower visited by bee → emit `pollen` (TTL); pollen overlapping another
     flower → new flower.
3. Caps: trees 30, fish 20, flowers 60, bees 40, pollen 80 (short TTL).
4. HUD: `?debug=physics` `Nature` row gains a `Biology` line —
   `births · deaths · pollen · honey · capped`.
5. Tests: `biology.test.ts` — calm-field seeding, curvature spike suppression,
   pollen→flower, fish breeding, cap respect, **no-physics-writes spy**.
6. Memory: `mem://features/brain-biology` + index update.

**Verification:** leave `/brain` ~2 minutes; honey rises, a seed appears near
a tree, a bee deposits, a fry exists if both fish sexes are present. Inject
curvature spike via `?debug=physics` → biology halts in that area.

**Out of scope:** persistence, P2P sync, genetics, predation, harvesting,
collider fix.

---

## Deferred (explicit, not in any phase above)

- Persistence of nature/biology state (IndexedDB, throttled 2.5s) — Phase 4.
- P2P sync of biome — Phase 5.
- Earth-breath / collider fix in `earth.ts` — single follow-up, applies to all
  engines at once.
- Avatar-calibrated scale.
- Genetics, predation, seasons, player harvesting.

---

## Phase 0 cleanup record

- Removed the speculative `src/lib/brain/nature/natureCatalog.ts` started
  during the over-ambitious first pass.
- No other nature/biology files remain on disk.
- Repo is at a clean baseline; awaiting approval to begin **Phase 1**.

## See also

- `docs/BUILDING_BLOCKS_ENGINE.md` — engine contract these phases formalize.
- `docs/BRAIN_UNIVERSE.md` — the universe biology lives in.
- `src/components/brain/SurfaceApartment.tsx` — per-piece reference contract.
- `src/lib/brain/uqrcPhysics.ts` — the actual game engine (truth layer).