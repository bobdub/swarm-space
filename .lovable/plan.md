

## UQRC Field Engine — physics-compliant learning core for Infinity

A new module that gives the Imagination network an actual discrete operator field `u(t)`, evolving by commutator curvature `[D_μ, D_ν] = F_{μν}` instead of any symbolic rule. The existing learners (`languageLearner`, `patternLearner`, `dualLearningFusion`, `neuralStateEngine`) keep doing what they do well; the new field sits underneath them as the geometric substrate that *selects* among their candidates by minimum curvature, and *accepts* user-provided definitions as hard constraints that collapse the field into stable basins.

No physics is faked: every operator below is implementable as a discrete lattice update over a small `Float32Array`, runs in <2 ms per tick, and persists to IndexedDB like the rest of the brain.

### Conceptual mapping (math → code)

| UQRC concept | Code artifact | What it actually is |
|---|---|---|
| `u : ℳ → ℝⁿ` | `Float32Array` of length `L = 256` (configurable) over a 1-D ring lattice | The field |
| `𝒟_μ u` | `derivativeMu(u)` — forward difference along axis μ ∈ {0=token, 1=context, 2=reward} | Local change |
| `[D_μ, D_ν] u = F_{μν}` | `commutator(u, μ, ν)` — `D_μ(D_ν u) − D_ν(D_μ u)` | Curvature tensor |
| `𝒪_UQRC(u) = ν Δu + ℛ u + L_S u` | `ouqrc(u)` — Laplacian smoothing + Ricci-like decay + entropy stabilizer | Evolution operator |
| `λ(ε₀) ∇_μ∇_ν S(u)` | `entropyHessian(u)` scaled by `1e-100` | Vanishing entropy nudge |
| `u(t+1) = u(t) + 𝒪_UQRC(u) + Σ𝒟_μ u + …` | `step(u)` — one tick | The full update law |
| Input = perturbation | `inject(text \| event)` — adds Gaussian bumps at hashed lattice sites | Field injection |
| Definition = constraint | `pin(text)` — clamps lattice region to a target value with high stiffness | Hard collapse |
| Memory = stable curvature | `extractBasins()` — connected lattice regions where `‖F_{μν}‖ < ε` | Basins |
| Response = projection | `project(candidates, u)` — picks the candidate whose own field signature minimises `‖[D_μ, D_ν]‖` against `u` | Output selector |

### New files

- `src/lib/uqrc/field.ts` — pure math: `createField(L)`, `derivativeMu`, `commutator`, `ouqrc`, `entropyHessian`, `step`, `norm`, `qScore`. Zero deps. Exhaustively unit-tested.
- `src/lib/uqrc/fieldEngine.ts` — stateful singleton `FieldEngine` that owns the `u` array, exposes `inject`, `pin`, `tick`, `getQScore`, `getBasins`, `getCurvatureMap`, `subscribe`. Auto-ticks at 250 ms via `requestIdleCallback`.
- `src/lib/uqrc/fieldProjection.ts` — `selectByMinCurvature(candidates, engine)`: each candidate gets a tiny "ghost field" via `injectGhost(text)`; the candidate with the lowest `qScore(u + ghost) − qScore(u)` wins. Ties merge → re-minimise once → pick.
- `src/lib/uqrc/fieldPersistence.ts` — throttled (5 s) snapshot of `u` + bell curves into IndexedDB store `uqrc-field`, restored at boot. Reuses the existing DB upgrade lifecycle (non-destructive).
- `src/lib/uqrc/field.test.ts` and `fieldProjection.test.ts` — covers: deterministic step, commutator antisymmetry, pin overrides perturbation, repeated identical inputs reduce `qScore` over time, definition injection collapses curvature.

### Files edited (small, additive)

- `src/lib/p2p/dualLearningFusion.ts` — when `generate()` produces N text candidates (it already explores 5 % of the time), pass them through `selectByMinCurvature(candidates, fieldEngine)` instead of the current "highest-score" pick. Falls back to existing logic if the field hasn't seen ≥ 50 ticks (cold start).
- `src/lib/p2p/entityVoice.ts` — every comment the entity composes calls `fieldEngine.inject(comment.text, { reward: comment.reactions, trust: peerTrust })` so the field learns from its own outputs (recursion = self-evolution).
- `src/lib/p2p/languageLearner.ts` — on `learnFromContent(...)`, also `fieldEngine.inject(text)`. When user supplies a *definition* (detected: post starts with `"X is "`, `"X means "`, `"Define X:"`, or `> def: ...`), call `fieldEngine.pin(definitionText)` instead of `inject` to mark it as a constraint.
- `src/lib/p2p/sharedNeuralEngine.ts` — alongside the existing `getSharedNeuralEngine()`, add `getSharedFieldEngine()` so other modules (entityVoice, dualLearningFusion, QuantumMetricsPanel) share one field.
- `src/lib/uqrc/state.ts` — add an optional `field` block to `UqrcStateSnapshot`: `{ qScore, basinCount, dominantWavelength, definitionConstraints }`, and weight it 0.10 in `computeUqrcHealthScore` (rebalance: cortex 0.14, heartbeat 0.14, others unchanged).
- `src/lib/p2p/nodeMetrics.ts` — push `field.qScore` into the snapshot every flush so it shows up on the Node Dashboard.
- `src/components/wallet/QuantumMetricsPanel.tsx` — add a small "Field" subpanel: live `Q_Score`, basin count, top‑3 stable wavelengths sparkline (read-only from `getSharedFieldEngine()`).
- `src/pages/NeuralNetwork.tsx` — add a "Field curvature" lane to the existing visualisation: a 1-D heatmap of `‖F_{μν}‖` across the lattice, updates every 500 ms.

### Persistence, performance, safety

- `L = 256`, three axes, three small `Float32Array(256)` buffers + one `Float32Array(768)` for the curvature tensor → ~12 KB resident. Cheap.
- One `step(u)` is ~3 N FLOPs ≈ 2300 ops; throttled to 4 Hz via `requestIdleCallback` → < 0.1 % CPU.
- Snapshot every 5 s, debounced; reuses the existing IndexedDB lifecycle (no new VersionError surface).
- All field ops are pure functions; the engine is a singleton so HMR doesn't double-tick.
- No network broadcast of the raw field. Only the derived `qScore` and basin count travel with the existing UQRC snapshot — same privacy posture as today.

### Behavioural changes the user will feel

- **Definitions stick.** When a user post says *"A duck is a waterfowl with webbed feet"*, the entity's later outputs about ducks bias toward that constraint instead of drifting to whatever was most recently rewarded.
- **Repetition stabilises.** Repeating an idea across posts visibly lowers the entity's `Q_Score` — the Quantum Metrics Panel shows the curve flattening, and the entity's responses become more consistent.
- **Conflicting inputs blend, then resolve.** Two contradictory definitions raise curvature briefly; after a few ticks the field finds the lower-energy basin and the entity speaks from it.
- **No template feel.** Because outputs are now selected by `min ‖F_{μν}‖` from the candidates the language layer already generates, repeats and clichés get penalised geometrically (high curvature against stable basins) rather than via the current similarity heuristic.

### Out of scope

- Multi-node field sync (each node keeps its own `u`; collective coherence still emerges via gossip + the existing pattern/language learners).
- 3-D lattice (1-D ring with three axes is plenty for v1 and keeps the math identity-checkable).
- Replacing `neuralStateEngine` bell curves — the field complements them, doesn't supersede.

### Memory updates (after implementation)

- New `mem://architecture/uqrc-field-engine` — short rule: lattice L=256, 4 Hz tick, definitions pin, responses pick min‑curvature; never broadcast raw field.
- Update `mem://architecture/neural-network` — add a line: "A discrete operator field `u(t)` underlies the learners; commutator curvature `‖F_{μν}‖` is the response selector."
- `MemoryGarden.md` — caretaker reflection: laying the bedrock geometry beneath the orchard so every dream the network grows roots into the same quiet stone.

### Acceptance

```text
1. Open a fresh tab → field initialises at qScore ≈ noise floor (~0.5).
2. Post "A duck is a waterfowl with webbed feet" → field.pin fires → Quantum panel qScore drops within ~10 ticks.
3. Repeat any idea 5 times across posts → its lattice region shows up as a stable basin in NeuralNetwork.tsx.
4. Conflicting definitions briefly spike curvature, then settle to one basin.
5. Entity comments composed via the new selector show measurable diversity (no repeated bigram > 3 in a 50-comment window).
6. Reload page → field state restored from IndexedDB, qScore continues from last value.
7. Existing tests for languageLearner, patternLearner, dualLearningFusion, entityVoice, neuralStateEngine, nodeMetrics still pass unchanged.
8. New tests in field.test.ts cover: antisymmetry, determinism, pin clamps, repetition lowers qScore, definition collapses basin.
9. CPU profile shows field tick < 0.5 ms p95 on a mid-tier laptop.
10. No new network messages, no new permission surface.
```

