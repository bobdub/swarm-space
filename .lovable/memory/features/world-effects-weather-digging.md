---
name: World Effects — Tools, Digging, Weather, Lava
description: Held tool mesh, per-material impact particles, shell digging with carved pits, 1Hz water cycle feeding UQRC curvature, volcano lava floor.
type: feature
---

## Rule

Visible world effects are always the trace of an existing predicate — never a
parallel simulation.

- **Tool visuals** — `HeldToolMesh` parents to the avatar; impacts emit through
  `swingFxBus` with an `ImpactMaterial` (`wood | stone | soil | flora | water |
  lava | air`) that selects the particle burst in `ToolSwingFX`.
- **Digging** — ground clicks resolve to a `{ kind: 'shell' }` ToolTarget
  (`toolTargets.ts`) quantised by `carvedCellsStore` (2.5 m arc cells,
  `DIG_STEP_M` per cut, hard floor `DIG_MAX_DEPTH_M`). Cuts go through
  `applyImpact` — same predicate as blocks — then `carveCell` +
  `emitCellCarved`. `CarvedCellsLayer` renders pits with banded shell
  stratigraphy, so Earth layers are verified by digging them.
- **Weather** — `lib/world/weather.ts` runs at 1 Hz: evaporation from ocean/shore,
  cloud drift/charge, rain. `WeatherLayer` renders clouds, rain streaks and
  land splashes.
- **UQRC coupling** — rain injects curvature into the physics field;
  `weatherCurvatureBoost(localNormal)` is added to `curvatureLoad` when digging,
  so storms make the world measurably harder to cut and the Q_Score moves.
- **Volcano** — `VolcanoLavaPool` is a shader disc inside the crater whose crack
  glow tracks `getMantlePressure()`. Lava can never be cut
  (`lava_burns_tool`).

## Constraints

- Never bypass `applyImpact` for world mutation.
- FX components are view-only; all state lives in the stores/modules.
