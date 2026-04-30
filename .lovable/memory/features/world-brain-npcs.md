---
name: world-brain-npcs
description: NPCs as living UQRC field beings — six-block compound bodies routed through BuilderBlockEngine, low-noise PersonalitySeed with global uniqueness ε, gradient drives, smooth-relations reproduction (harmony+standards+resources), cap 25, seed 5F+3M, lifespan 30y
type: feature
---
World Brain NPCs are biology, not animation. Each is a persistent `u(t)` configuration whose body is a graph of real chemical compounds.

- Engine stack: `NpcEngine → BuilderBlockEngine → UqrcPhysics`. NpcEngine NEVER writes `field.axes` / `body.pos` / pin templates; every body slot is placed via `builderBlockEngine.placeBlock`.
- Body = 6 slots (`core`, `head`, `arm_l`, `arm_r`, `leg_l`, `leg_r`) each with constituents validated against `SHELL_DEFS ∪ INNER_SYMBOLS` at module load.
- `PersonalitySeed` = 5 traits in [-1,1] from a 4-sample smoothed bell. `npcRegistry` rejects any seed within `PERSONALITY_UNIQUENESS_EPS` (0.18) of an existing NPC — guarantees the "no two alike" rule.
- Population: `NPC_CAP=25`, seed `5 females + 3 males` (`seedCommunity.INITIAL_NPCS`), default lifespan `30` brain-years.
- Drives: pure `chooseIntent(seed, signals)` argmax over drink/eat/hunt/fish/gather/grow/craft/socialise/rest, weighted by personality.
- Crafting = assembly of existing assets only; new placed blocks reuse `placeBlock` with union-of-inputs constituents (no new elements).
- Reproduction (`tryReproduce`): requires sustained `‖[D_μ_i,D_μ_j]‖ ≤ HARMONY_EPS` for `≥ HARMONY_WINDOW_SECONDS` (600 s) + `socialStandards.canBond` + `≥ GESTATION_RESERVE` reserves per parent. Child seed = `mergeSeeds` (mean + small bell-drift) re-validated for uniqueness.
- Skills `S_NPC(t)` Welford-smoothed in [0,1] per `(npcId, key)`; throttled persistence lands with boot wiring.
- Scaffold ships pure modules + singleton API (`spawnNpc`, `despawnNpc`, `step`, `subscribe`, `previewSeed`); no timer auto-start, no renderer, no IndexedDB writes yet — same discipline as `coinFillScheduler`.
- See `docs/WORLD_BRAIN_NPCS.md` for the full module map and follow-ups.