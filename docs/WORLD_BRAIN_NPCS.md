# World Brain NPCs — Living UQRC Field Beings

_Status: light scaffolding landed. Engine API is stable; 8 Hz step loop, body rendering, and field-sampling bridge are follow-ups._

## Core axiom

Each NPC is a persistent, self-evolving `u(t)` configuration instantiated and sustained inside the World Brain's UQRC field engine. Bodies are graphs of real chemical compounds (C, H, O, N, P, S, Ca, Si lattices forming proteins, water, bone, lens). Behaviour, learning, crafting, social bonds, and reproduction all emerge from the same operators that drive water flow and curvature closure.

## Architecture — third tier of the existing engine stack

```text
NpcEngine            ← decides WHAT npcs exist, want, learn, bond, birth
       │ requests via API
       ▼
BuilderBlockEngine   ← decides HOW pieces enter/leave the world
       │ requests via API
       ▼
UqrcPhysics          ← decides WHERE pieces are (field, gradients, curvature)
```

Hard rules (carried straight from `BRAIN_NATURE_PHASES.md`):

- `npcEngine` **never** writes to `field.axes`, `body.pos`, or pin templates.
- Every NPC body slot is placed via `builderBlockEngine.placeBlock`.
- All compound constituents must exist in `SHELL_DEFS ∪ INNER_SYMBOLS`. Validated at `npcBody.ts` module load.
- No `<form>` elements in any NPC UI. All buttons `type="button"`.
- IndexedDB writes throttled to ≥ 2.5 m (project-wide perf rule).

## Population & lifecycle constants (`npcTypes.ts`)

| Constant                      | Value | Meaning                                           |
|-------------------------------|-------|---------------------------------------------------|
| `NPC_CAP`                     | 25    | Hard population ceiling.                          |
| `NPC_LIFESPAN_YEARS`          | 30    | Default brain-year lifespan.                      |
| `INITIAL_FEMALES`             | 5     | Seed roster females.                              |
| `INITIAL_MALES`               | 3     | Seed roster males.                                |
| `PERSONALITY_UNIQUENESS_EPS`  | 0.18  | No two NPC seeds may sit closer than this.        |
| `HARMONY_EPS`                 | 0.05  | `‖[D_μ_i, D_μ_j]‖` ceiling for "harmonic" sample. |
| `HARMONY_WINDOW_SECONDS`      | 600   | Sustained harmony required before reproduction.   |
| `GESTATION_RESERVE`           | 8     | Min H₂O+carbon-rich blocks per parent to gestate. |

## Body — six builder blocks, real chemistry

| Slot     | Compound          | Constituents                       |
|----------|-------------------|------------------------------------|
| `core`   | cytoplasm         | H, O, C, N (water + protein)       |
| `head`   | cranium-and-lens  | Ca, P, O, Si, C, H                 |
| `arm_l`  | keratin-arm       | C, H, N, O, S                      |
| `arm_r`  | keratin-arm       | C, H, N, O, S                      |
| `leg_l`  | bone-and-muscle   | Ca, P, O, C, H, N                  |
| `leg_r`  | bone-and-muscle   | Ca, P, O, C, H, N                  |

Personality lightly biases mass / basin (curious → bigger head, warm → bigger core, risk-tolerant → larger limbs) without altering chemistry.

## Personality — smooth, original, unique

`PersonalitySeed = { curiosity, empathy, riskTolerance, inventiveHarmony, relationalWarmth }` ∈ `[-1, 1]^5`.

- Built from a string via `seedFromString(s)` — deterministic, reproducible across peers.
- Components drawn from a 4-sample averaged uniform → low-noise bell. Matches the project's "smooth original personality" requirement.
- `npcRegistry.isSeedUnique(seed)` rejects any seed within `PERSONALITY_UNIQUENESS_EPS` of an existing NPC. `reseedUntilUnique` re-rolls deterministically until it fits — guarantees `Self: No NPC can be exactly the same as another`.

## Drives — gradient utility table

`chooseIntent(seed, signals)` (in `npcDrives.ts`) is pure and unit-testable. Each tick the engine samples nine scalars around the body and the argmax wins:

| Drive       | Signal                                          |
|-------------|-------------------------------------------------|
| `drink`     | hydration deficit                               |
| `eat`       | energy deficit                                  |
| `hunt`      | prey gradient × tool-ownership × `riskTolerance`|
| `fish`      | fish gradient × tool-ownership × `curiosity`    |
| `gather`    | resource gradient × `empathy`                   |
| `grow`      | crop-neglect timer × `empathy`                  |
| `craft`     | inventory + workbench × `inventiveHarmony`      |
| `socialise` | best-neighbour alignment × `relationalWarmth`   |
| `rest`      | accumulated curvature exposure (fatigue)        |

## Crafting — assembly only, no new seeds

NPCs combine pre-existing assets (e.g. `stone-tip ⊕ shaft → spear`). New crafted blocks are placed via `placeBlock` with constituents = union of inputs (revalidated against the periodic table). No new compound or element invention — creativity is field evolution, not seed generation.

## Smooth-relations reproduction

`relations.ts` keeps a Welford-smoothed `RelationalEdge` per pair, with a continuous `harmonyStreakSeconds` counter. Reproduction goes through `tryReproduce(args)` and passes only when **all** of the following are true:

1. `harmonyOk(edge)` — sustained `‖[D_μ_i, D_μ_j]‖ ≤ HARMONY_EPS` for `≥ HARMONY_WINDOW_SECONDS`.
2. `socialStandards.canBond(a, b, ctx)` — both parties past `MATURITY_YEARS`, neither already in a gestation. Standards are emergent: extra norms (courtship, pair-bond respect) plug in here once event history persistence ships.
3. Both parents have `≥ GESTATION_RESERVE` H₂O + carbon-rich reserves.

On success `mergeSeeds(a, b, driftSeed)` returns the child's `PersonalitySeed`: component-wise mean + small bell-drift, then re-validated against `npcRegistry.isSeedUnique`. Population cap and uniqueness are enforced at `register`-time — the engine never spawns a 26th NPC.

## Module map (light scaffold)

| File                                             | Role                                  |
|--------------------------------------------------|---------------------------------------|
| `src/lib/brain/npc/npcTypes.ts`                  | Types + constants. No I/O.            |
| `src/lib/brain/npc/personalitySeed.ts`           | Pure: seed / merge / distance.        |
| `src/lib/brain/npc/npcBody.ts`                   | Pure: 6-slot graph, chemistry-validated. |
| `src/lib/brain/npc/npcDrives.ts`                 | Pure: utility-table drive selector.   |
| `src/lib/brain/npc/relations.ts`                 | Pure: Welford-smoothed relational edges. |
| `src/lib/brain/npc/socialStandards.ts`           | Pure: bond gate (predicate + ctx).    |
| `src/lib/brain/npc/reproduce.ts`                 | Pure: combined reproduction gate.     |
| `src/lib/brain/npc/npcSkills.ts`                 | In-memory skill memory (S_NPC).       |
| `src/lib/brain/npc/npcRegistry.ts`               | Singleton: cap + uniqueness + events. |
| `src/lib/brain/npc/seedCommunity.ts`             | INITIAL_NPCS roster (5F + 3M).        |
| `src/lib/brain/npc/npcEngine.ts`                 | API: spawn / despawn / step / subscribe. |

## Not in this scaffold

- No timer or auto-spawn at boot. `npcEngine.step()` is a no-op stub.
- No `BrainUniverseScene` / renderer wiring.
- No persistence — registry is in-memory.
- No social HUD; humans cannot yet trade with NPCs.

These all land in the follow-up patch, with the field-sampling bridge mirroring `chainHealthBridge`'s contract.