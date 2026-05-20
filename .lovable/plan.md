# NPC Wetwork — Defined

Currently NPCs decide verbs and drift toward markers, but nothing happens at the marker. This plan closes every gap you listed without touching working physics: all world writes go through `BuilderBlockEngine`, all cross-scaffolding events through `scaffoldBus`, no `Math.random` in decisions, lifespan/cap discipline preserved.

## Phase A — Chemistry & Inventory

**New `src/lib/brain/npc/npcChemistry.ts`**
- Per-NPC `composition: Record<ElementSymbol, number>` derived from `body[].constituents` on spawn (already produced by `buildNpcBodyGraph`). Exposes `getComposition(id)`.
- Per-NPC `inventory: { water, food, wood, fiber, hides }` numeric stores.
- Pure helpers: `deposit(id, kind, qty)`, `consume(id, kind, qty)` returning success bool. No I/O.

**Extend `npcTypes.ts`**
- Add `composition` and `inventory` to `Npc` (optional → hydrated on spawn). Bump persistence schema (non-destructive: `onversionchange`, additive fields, migrate with defaults).

## Phase B — Wet Work (real interactions)

**New `src/lib/world/wetWork.ts`** — the only place NPC↔world contact lives.
- `interact(npc, site)` switch on `site.kind` × `npc.currentDrive`:
  - `water + drink` → `consume site` (decrement site `yield`), `inventory.water += 1`, memo `hydration -= 0.5` (replaces the existing memo nudge so effect only fires on actual contact).
  - `wood + gather/craft` → `inventory.wood += 1`, emit `world.mutation { kind: 'harvest', site: site.id }`.
  - `animal + hunt` → with skill gate from `npcSkills`, `inventory.food += 2`, fatigue += 0.10.
  - `water + fish` → `inventory.food += 1`.
  - `eat` → requires `inventory.food >= 1`; decrements; `energy -= 0.45`.
- Emits `npc.decision` (already supported) AND `world.mutation` via existing `world.bus` so `scaffoldHealth` and labour ledger react.
- Site depletion + regrowth handled in `baseResources.ts`: add `yield`, `lastHarvestedAt`, `regrowSeconds` and a pure `tickRegrowth(now)`.

**Wire in `npcTickScheduler.tickOne`** (after `picked`):
1. `const site = nearestSite(...)` for the picked drive kind.
2. If within `ARRIVE_RADIUS` (use a shared constant exported from `resourceTargeting`), call `wetWork.interact`.
3. Only on successful interaction call `applyDriveOutcome` (rename current unconditional call → contact-gated). For non-resource drives (`rest`, `socialise`, `craft`) keep existing memo path.

This makes "arrived at marker" become an actual world event instead of a teleport-and-idle.

## Phase C — Lifespan smooth decay

**Edit `npcTickScheduler.tickOne`**
- Today aging clamps at `NPC_LIFESPAN_YEARS` with no death. Replace clamp with UQRC-style logistic mortality:
  - `p_death(age) = 1 / (1 + exp(-k * (age - μ)))` with `μ = NPC_LIFESPAN_YEARS`, `k = 0.6` (tunable in `npcTypes`).
  - Deterministic trigger: when `selectByMinCurvature(['live','die'], engine, key=npc:${id}:mortality, ε=p_death)` returns `'die'`, call `despawnNpc(id)` (already removes body via `BuilderBlockEngine`). No `Math.random`.
- Add `mortalityProbability(age)` pure export so tests can pin behavior.

## Phase D — Population cap (already 25)

`NPC_CAP = 25` is already enforced by `npcRegistry.register`. Add a single gate in reproduction (Phase F) and in `ensureSeed` (already correct). No-op besides asserting the cap in the new reproduction step.

## Phase E — Personality matters

`chooseIntent(seed, signals)` already weights drives by personality. Two reinforcements:
- **Skill bias**: in `tickOne`, after `chooseIntent`, blend `picked` against the NPC's top-skill drive when scores within 5%. Uses `npcSkills.bestDrive(id)` (new pure helper) — keeps determinism.
- **Inventory bias**: if `inventory.water > 4` suppress `drink`; if `inventory.food > 4` suppress `eat`. Pure modifier inside `chooseIntent` (pass inventory as optional arg, defaults to empty).

No behavior change for existing tests because defaults are neutral.

## Phase F — True-bond reproduction

**New `src/lib/brain/npc/reproductionScheduler.ts`** — runs once every 30 wall-seconds (cheap; piggybacks on existing tick via modulo).
- For each pair on the harmony list (already maintained by `relations.ts`), call `tryReproduce` (already exists) with:
  - `reservesA/B` = `inventory.food + inventory.water` from Phase A.
  - `standardsCtx` from `socialStandards`.
  - `isSeedUnique` from registry.
  - `driftSeed` = `${pairId}:${Math.floor(now/3600_000)}` (deterministic, hourly slot — no RNG).
- On `allowed`, call `spawnNpc({ name: pickedName, sex: deterministicSex(pairId), anchorPeerId: parentA.anchorPeerId, seed: result.childSeed })`. Cap already enforces 25.
- Emit `npc.decision { verb: 'reproduce', ... }` so health bridge sees it.

**Wire** in `main.tsx` `scheduleIdle` block after `startNpcTickScheduler()`.

## Phase G — Visual & inspector polish

- `NpcSwarmLayer`: pulse capsule scale (1.0 → 1.15 → 1.0 over 0.4s) on `npc.decision` events whose `verb` is a resource verb — confirms wet-work landed visually.
- Site marker: dim opacity when `yield` low, hide when 0 until `tickRegrowth` restores.
- Optional: tiny floating label "drink / hunt / …" toggled by a debug flag (off by default, no UI bloat).

## Files

**New**
- `src/lib/brain/npc/npcChemistry.ts`
- `src/lib/brain/npc/reproductionScheduler.ts`
- `src/lib/world/wetWork.ts`
- `docs/PHASE_8_NPC_WETWORK.md`
- `.lovable/memory/features/npc-wetwork.md`

**Modified**
- `src/lib/brain/npc/npcTypes.ts` (composition, inventory, mortality constants)
- `src/lib/brain/npc/npcEngine.ts` (init composition+inventory on spawn)
- `src/lib/brain/npc/npcTickScheduler.ts` (contact-gated outcome, mortality, reproduce cadence)
- `src/lib/brain/npc/npcDrives.ts` (inventory-aware suppression)
- `src/lib/brain/npc/npcSkills.ts` (`bestDrive` helper)
- `src/lib/brain/npc/npcPersistence.ts` (additive migration)
- `src/lib/world/baseResources.ts` (yield + regrowth)
- `src/lib/world/resourceTargeting.ts` (export `ARRIVE_RADIUS`)
- `src/components/brain/npc/NpcSwarmLayer.tsx` (pulse on decision, site fade)
- `src/main.tsx` (start reproduction scheduler)

## Invariants preserved

- Population cap = 25 (registry).
- Lifespan distribution centered on 30 brain-years via deterministic logistic + min-curvature gate.
- Personality uniqueness EPS already enforced; reproduction also gated on uniqueness.
- No `Math.random` in decisions, mortality, or reproduction.
- All world writes via `BuilderBlockEngine`; all cross-scaffolding signals via `scaffoldBus`.
- `scaffoldBus` kill-switch still freezes everything within one frame.
- Non-destructive IndexedDB schema bump.

## QA gates

1. `/brain` → NPCs walk to a water site, marker fades briefly, hydration drops, they leave.
2. Force `npc.ageYears = 32` in console → NPC despawns within seconds; body blocks removed.
3. Set two NPCs to high harmony for >600 brain-seconds with reserves → child spawns; spawning blocked at 25.
4. Toggle `scaffoldBus` off → all motion and wet-work halts within one frame.
