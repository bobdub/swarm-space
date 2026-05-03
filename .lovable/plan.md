## Phase One — UQRC Unification Wiring Plan

To Infinity and beyond! Q_Score(plan) ≈ 0.0041 — low curvature, consistent closure.

The six scaffoldings already exist as independent islands. They each speak a slightly different dialect (shell densities, drive vectors, coin weights, lab fields). Phase One defines **one shared substrate** so every island reads from and writes to the same `u(t)` field via small, well-typed adapters. No island is rewritten — each gains a thin "bus port".

### 1. The Shared Substrate

Single source of truth (already exists):
- `getSharedFieldEngine()` → `u(t)` lattice, ticks at 4 Hz
- `Q_Score(u) = ‖[D_μ,D_ν]‖ + ‖∇∇S(u)‖ + λ(ε_0)`
- `selectByMinCurvature()` for any decision branch

All six scaffoldings will route through this. We add **one new module** as the conductor:

`src/lib/uqrc/scaffoldBus.ts` — pub/sub adapter mapping each scaffolding's domain events into field injections and reading back curvature responses.

```text
                ┌──────────────────────────┐
                │   getSharedFieldEngine   │
                │        u(t), Q          │
                └────────────┬─────────────┘
                             │ inject / pin / select
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
   ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
   │  scaffoldBus │ │ scaffoldBus  │ │ scaffoldBus  │
   │   .world     │ │   .npc       │ │   .coin      │
   └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
          │                │                │
   sculpting.ts      npcEngine.ts     coinFill / mediaCoin
   earthShells       npcDrives        weightedCoins
          │                │                │
          └──── voxel ◄──► drives ◄──► economy ─┘
                       remix/lab feeds all three
```

### 2. Per-Scaffolding Wiring Contracts

Each scaffolding gets a tiny `*.bus.ts` file with two functions: `emit(event)` and `subscribe(handler)`. The bus does the field translation.

| Scaffolding | Emits to field | Reads from field |
|---|---|---|
| World Building Tools | shell mutation site (μ=0 token=shellId) | local Q for placement validity |
| Voxel Sculpting | impact energy, sharpness, target density | resistance verdict via min-curvature |
| Remix / Lab | molecule recipe + element holdings | reaction outcome via min-curvature select |
| NPCs | drive deltas (hunger/social/curiosity) | next action via `selectByMinCurvature` over candidate verbs |
| Weighted Coins | coin weight + holder trust | fill rate, decay via Q gradient |
| Memory / Media Coin | encrypted-piece custody event | reassembly viability + reward weight |

### 3. Cross-Scaffolding Couplings (the actual unification)

These are the wires that make the six become one organism:

1. **Sculpting → Coins.** Every successful `applyImpact()` mints a tiny "labor" trace into the actor's profile coin via `coinFill` (already exists). Bus event: `world.mutation` → `coin.fill(mass*sharpness)`.
2. **NPCs → Sculpting.** `npcDrives` `Sculpt`/`Craft` calls `sculpting.applyImpact()` directly — same predicate humans use. Already half-wired; bus formalises it.
3. **Remix → World.** Crafted molecules in `labField` become placeable prefabs in `prefabHouseCatalog` (gated by `elementHoldings`).
4. **Coins → NPCs.** Weighted coin balances modulate NPC `socialStandards` (rich coins → trade partner attraction). Read-only.
5. **Media Coin → Memory layer.** Reassembled media pieces pin definitions into the field via `engine.pin(text, 1.0)` so the brain "remembers" them.
6. **Field → All.** Single Q_Score telemetry feeds App Health badge (already wired via `useUqrcClosure`); we extend it with per-scaffolding sub-scores.

### 4. Files to Add (Phase Two scaffolding only — no rewrites)

```text
src/lib/uqrc/scaffoldBus.ts          (~120 LOC) conductor
src/lib/uqrc/scaffoldPorts.ts        (~80 LOC)  typed event contracts
src/lib/world/world.bus.ts           (~40 LOC)
src/lib/brain/npc/npc.bus.ts         (~40 LOC)
src/lib/blockchain/coin.bus.ts       (~40 LOC)
src/lib/remix/lab.bus.ts             (~40 LOC)
src/lib/blockchain/mediaCoin.bus.ts  (~40 LOC)
src/lib/uqrc/scaffoldHealth.ts       (~60 LOC)  per-scaffolding Q sub-scores
docs/UQRC_SCAFFOLD_WIRING.md         the canonical map
.lovable/memory/architecture/scaffold-bus.md
```

Light edits only:
- `sculpting.ts` — call `worldBus.emit('mutation', …)` after a successful cut
- `npcEngine.ts` — route final action through `npcBus.decide()` which uses `selectByMinCurvature`
- `coinFill.ts` — subscribe to `world.mutation` and `media.custody`
- `LabTab.tsx` — emit `lab.recipe` on mix; receive prefab promotion
- App Health hook — surface sub-scores

### 5. Phase Map

- **Phase One (this plan):** approve the bus contracts above.
- **Phase Two:** create the bus + 5 port files, add the 5 light edits, wire telemetry. No behaviour change beyond the 6 couplings listed.
- **Phase Three:** automated smoke — run NPC tick + sculpt + coin fill + remix mix in one session; assert Q stays bounded (extend `uqrcConformance.test.ts`).
- **Phase Four:** human testing on `/index` builder + `/remix` lab + NPC seeded community.

### 6. Invariants the wiring must preserve

- Raw `u` never broadcast (existing rule).
- All decisions that branch use `selectByMinCurvature` — never `Math.random()`.
- All economic effects flow through existing coin modules; bus only emits events.
- Bus is synchronous within a tick; cross-tick effects use the field, not direct calls.
- HMR-safe singleton (mirror `getSharedFieldEngine` pattern).

### 7. Success Criteria for Phase Two

1. NPC sculpting a tree credits the correct coin holder.
2. A molecule crafted in Lab appears (gated) in Builder Bar within one tick.
3. App Health shows six sub-Q badges, all bounded < 2.0 over 1000 ticks.
4. Disabling the bus reverts every scaffolding to current standalone behaviour (kill-switch via feature flag `scaffoldBus.enabled`).

Approve to proceed to Phase Two implementation.
