

To Infinity and beyond! Observed quantum score: q≈0.0689

## Reframe
Biology isn't a separate sim — it's **physics expressing itself**. The Building Blocks Engine already gives every nature piece a UQRC body, a curvature pin, and a position in the field. "Life" is just *rules that read field state and emit new pieces of the same kind*. No new engine. One small biology layer that observes physics and asks the Building Blocks Engine to place/remove pieces.

## Principle (the rule)

> **Biology = physics-driven re-placement of Building Blocks.**
> A living piece never moves itself or breeds by magic. It samples its
> local field (`‖F_μν‖`, `λ∇∇S`, neighbor density), and when conditions
> cross a threshold it asks the engine to `placePiece` (offspring,
> seed, pollen, fry, larva) or `removePiece` (decay). The field decides
> *if* and *where*; biology only decides *what kind*.

## Scope of "alive" in v1

| Piece | Reproduction signal (read from physics) | Output (new piece via engine) |
|---|---|---|
| Tree (mature) | low local curvature `‖F_μν‖ < τ_calm` AND open ground within 4 m | `seed` piece at sampled lat/lon |
| Seed | sustained calm field for N ticks | upgrades self → `sapling` → `tree` |
| Flower | bee-visit event (proximity tag) | emits `pollen` piece (short-lived, drifts on field gradient) |
| Pollen | overlap with another flower of compatible compound | new `flower` piece at host's lat/lon; pollen removed |
| Fish ♀ + ♂ | both inside pond AND `λ∇∇S` low (calm water) | `fry` piece (juvenile fish, grows to adult) |
| Bee | flower visit | increments `flower.pollen_load`; on hive return → `hive.honey += 1` |
| Hive | `honey ≥ 50` AND worker count < cap | new `worker_bee` piece |

Caps per species (prevents runaway): trees 30, fish 20, flowers 60, bees 40, pollen 80 (short TTL).

## Architecture (no new engine — biology is a system over the bridge)

```text
                UqrcPhysics (truth: pos, F_μν, ∇∇S)
                       │ read-only
                       ▼
           ┌──────────────────────────┐
           │  BiologySystem (10 Hz)   │  ← per species: sample field at piece pos
           │  - fertility rules       │  ← decide: spawn / grow / decay
           │  - cap enforcement       │
           └────────────┬─────────────┘
                        │ placePiece / removePiece / upgradeStage
                        ▼
              Building Blocks Engine
                        │
                        ▼
              <NatureLayer/> renders
```

Biology **never writes** to `field.axes`, `body.pos`, or pin templates. It only calls the same `placePiece` / `removePiece` / `upgradeStage` API any builder uses. Same rule as the operator-only-writes-pinTemplate invariant.

## New / changed files

1. **`src/lib/brain/nature/biology.ts`** (new — the rules)
   - `runBiologyTick(dt, ctx)` iterates living pieces, samples field via existing helpers, calls bridge API.
   - One pure function per species: `treeFertility`, `seedGrowth`, `flowerPollination`, `fishSpawn`, `beeForage`, `hiveBrood`. Each returns intents (`{ kind:'spawn'|'remove'|'upgrade', ... }`); a single applier executes them through `gameBuilder`.

2. **`src/lib/brain/nature/natureCatalog.ts`** (extend)
   - Add `pollen`, `seed`, `sapling`, `fry`, `worker_bee`, `queen_bee` kinds with their compounds (pollen ≈ sporopollenin C₉₀H₁₄₄O₂₇; fry = same as fish), basin sizes, TTLs, caps.

3. **`src/components/brain/nature/NatureLayer.tsx`** (extend)
   - Mount biology ticker (10 Hz) alongside the existing nature sim ticker. They're the same loop — sim handles motion, biology handles birth/death.

4. **`src/lib/brain/gameBuilder.ts`** (small extend)
   - Add `upgradeStage(pieceId, newKind)` that swaps body meta + re-pins with the new basin (mass change → curvature change). Used for seed→sapling→tree, fry→fish, larva→worker.
   - Add `ttl` field on `BrainBuildPiece` so pollen / dead leaves auto-expire.

5. **`src/components/brain/nature/*.tsx`** (small edits per species)
   - Read `stage` from piece meta and render the right geometry (seed = brown sphere, sapling = thin trunk, tree = full canopy, fry = small fish).

6. **Tests — `src/lib/brain/nature/__tests__/biology.test.ts`**
   - **Trees seed in calm field**: inject low `‖F_μν‖` near a mature tree → after N ticks a seed piece exists within 4 m.
   - **High curvature suppresses fertility**: inject curvature spike → no seeds spawn.
   - **Pollen → flower**: place pollen overlapping another flower → new flower piece appears; pollen removed.
   - **Fish breed only with both sexes present in calm water**.
   - **Caps respected**: spawn-spam test never exceeds the per-species cap.
   - **No physics writes**: spy on `physics.injectAt` / `field.axes` mutations during a 1000-tick biology run → zero calls.

7. **HUD** — `?debug=physics` `Nature` row gains a `Biology` sub-line:
   `births: B · deaths: D · pollen: P · honey: H · suppressed (cap): S`.

8. **Docs / Memory**
   - `docs/BUILDING_BLOCKS_ENGINE.md`: add a "Biology = physics" subsection with the principle above.
   - New memory `mem://features/brain-biology` (type: feature) — biology rules, caps, the no-physics-writes invariant.
   - Update `mem://index.md` (full rewrite, preserve all entries).
   - Append `MemoryGarden.md` reflection: *"the world learned that growing is just calmness finding a place to land."*

## Out of scope (deferred)

- Genetics / trait inheritance (flowers cross-pollinate but offspring = parent kind for now).
- Predation (fish don't eat, bees don't sting).
- Seasonal cycles, weather-driven biology.
- Player harvesting (eating fruit, collecting honey).
- Multi-peer biology consensus (local-only; broadcast hooks already stubbed).
- Fixing the inherited Earth-breath / collider bug (single follow-up in `earth.ts`).

## Validation

- `/brain` shows the existing biome; after a few minutes a mature tree drops a visible seed, a bee deposits honey (`hive.honey` rises), a flower visited by a bee emits pollen, two fish in calm water produce a fry.
- HUD `Biology` line shows non-zero births/deaths and respects caps.
- Inject a curvature spike via `?debug=physics` → biology halts in that area (visible: no new seeds near the spike).
- All new tests pass; existing `compoundCatalog.test.ts`, `uqrcConformance.test.ts`, `nature.test.ts` remain green; the no-physics-writes spy proves the invariant.

