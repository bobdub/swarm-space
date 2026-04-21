

## Let the Physics Engine Teach the Learning Manifold

The neural↔field coupling pass replaced fake `Q_Score` with the real lattice. The **learning manifold** (PatternLearner + LanguageLearner + DualLearningFusion) still leans on classical Shannon entropy + EMA scoring and only consults the field at one point: `selectByMinCurvature` over generation candidates. Six concrete couplings replace guesses with measurements — same playbook, this time on learning.

### What the field already knows that learning ignores

| Physics signal (already free) | Learning today | Should drive |
|---|---|---|
| `field.qScore` (real curvature) | not consulted during ingestion | reward shaping — high-curvature ingestion = costly = penalised |
| `field.curvatureMap[256]` | not consulted | per-token "stress" → demote tokens whose lattice region is unstable |
| `field.basins[]` | not consulted | promote tokens / patterns living in stable basins → "crystallised vocabulary" |
| `field.dominantWavelength` | not consulted | adaptive `EXPLORATION_RATE` (fast rhythm → explore more; slow → exploit) |
| `selectByMinCurvature` | only fusion candidates | also: pattern selection, intent selection, phrase-merge decisions |
| `inject` / `pin` | language only (`isDefinitionText`) | also: pattern events as field bumps (behaviour ↔ geometry) |

### Six concrete improvements

**1. Pump pattern events into the field.**
In `PatternLearner.ingestEvent`, after scoring, call `field.inject(event.type, { reward: event.reward, trust: event.trustScore })`. Behavioural events become lattice perturbations on the same ring vocabulary already uses. Repeated reward-bearing patterns build basins; toxic patterns raise local curvature. Behaviour and language now share **one geometry**.

**2. Curvature-weighted reward in fusion.**
In `DualLearningFusion.computeReward`, multiply by `1 / (1 + field.getCurvatureForText(event.text))`. Content that destabilises the lattice when injected gets a smaller reward — even if it engages well — because it's geometrically corrosive. This replaces the static `SIMILARITY_PENALTY_WEIGHT` with a real signal.

**3. Basin-resident tokens become "crystallised" (auto-pin).**
At each `LanguageLearner.ingestText`, after the normal flow, scan top-N high-frequency tokens. Any token whose lattice site has been inside a basin for ≥ 3 consecutive ingestions gets `field.pin(token, 1.0, 0)`. Crystallised vocabulary stops drifting; the field itself enforces lexical stability. Cap pinned tokens at 64 to prevent lattice saturation.

**4. Adaptive exploration from `dominantWavelength`.**
Replace constant `EXPLORATION_RATE = 0.05` with a getter: `clamp(0.02, 1 / (1 + λ), 0.25)`. Short wavelength (turbulent network) → explore more to find new basins; long wavelength (stable) → exploit known patterns. Same trick that fixed neural decay — the physics tells learning its own rhythm.

**5. Curvature-scored pattern selection.**
In `DualLearningFusion.selectPattern`, when more than one stored pattern matches the intent template, pass them through `selectByMinCurvature` (representing each pattern as `pattern.steps.join(' ')`) and pick the one that least destabilises the current field. Pattern choice becomes geometric, not just score-greedy.

**6. Phrase-merge guarded by basin membership.**
In `LanguageLearner` (`PHRASE_MERGE_THRESHOLD`), only promote a bigram to a merged phrase if **either** (a) its count ≥ 5 (existing rule) **and** (b) `field.isTextInBasin(bigram)` returns true. Phrases crystallise only when the field agrees they're stable. Removes a class of brittle merges that today survive purely by frequency noise.

### Files

- `src/lib/p2p/patternLearner.ts` — inject every event into the field; add a curvature getter on top patterns for diagnostics.
- `src/lib/p2p/languageLearner.ts` — basin-pinning for top-N tokens (with pin-cap), phrase-merge gated by `isTextInBasin`.
- `src/lib/p2p/dualLearningFusion.ts` — curvature-weighted reward, adaptive `EXPLORATION_RATE` getter, `selectByMinCurvature` over candidate patterns.
- `src/lib/uqrc/fieldEngine.ts` — small helper `getPinCount()` (for the cap check). No physics change.
- `src/lib/p2p/dualLearningFusion.test.ts` (new) — verify (a) curvature damping reduces reward for high-curvature text, (b) adaptive exploration responds to wavelength, (c) basin-resident tokens get pinned after 3 ingestions, (d) phrase-merge respects basin gate.
- `docs/BRAIN_UNIVERSE.md` — append "Learning ↔ Field coupling" section after the existing neural section. Cross-link to `mem://architecture/neural-network`.
- `mem://architecture/neural-network` (update) — add line: "Learning manifold (PatternLearner + LanguageLearner + DualLearningFusion) reads curvature/basins/wavelength from the shared field. Pattern events injected, top tokens basin-pinned (cap 64), phrase merges gated by basin membership, exploration rate derived from dominantWavelength."

### Why this is the right cut

- **Zero new physics, zero UI change.** Everything proposed already exists on `FieldEngine` (`inject`, `pin`, `getCurvatureForText`, `isTextInBasin`, `getDominantWavelength`, `getQScore`, `selectByMinCurvature`).
- **One operator, end-to-end.** With pattern events also injected, every learnable signal — peer interactions (already done), language ingestion (already done), behavioural patterns (this pass) — evolves under `𝒪_UQRC`. The lattice is now the single source of truth across all three learners.
- **Removes a hidden cliff.** Today fusion's diversity penalty is a constant; pattern selection is greedy; phrase merging is frequency-only. Each is a plausible heuristic; together they create a bias the field can't see. Coupling them to curvature replaces three independent guesses with one measured signal.
- **Same shape as the neural pass.** Pin cap (64) prevents lattice saturation; gated by `isWarmedUp()` so cold-start behaviour is unchanged; existing `try/catch` pattern means field outages never break ingestion.

### Acceptance

```text
1. PatternLearner.ingestEvent injects (event.type, reward, trust) into the shared field on every call. Field tick count visibly correlates with event volume.
2. DualLearningFusion.computeReward divides engagement reward by (1 + getCurvatureForText(event.text)). High-curvature posts measurably score lower than equivalently-engaging low-curvature posts.
3. LanguageLearner pins top-N basin-resident tokens after 3 consecutive ingestions where the token's site is inside a basin. Total pinned tokens never exceed 64; oldest-pinned evicted past cap.
4. EXPLORATION_RATE becomes a derived getter, clamped to [0.02, 0.25] from 1/(1+λ). Visible in console as "[Fusion] exploration=0.08 (λ=11.5)" once per generation.
5. selectPattern, when ≥ 2 stored patterns satisfy the intent template, consults selectByMinCurvature and picks the lowest ΔQ pattern. Falls back to score-sorted top when field not warmed up.
6. Phrase merge requires count ≥ 5 AND isTextInBasin(bigram). Pre-warm phase (field.ticks < COLD_START_TICKS) uses count-only rule for backward compat.
7. New tests assert (a) curvature damping reduces reward, (b) adaptive exploration responds to wavelength, (c) basin-pinning after 3 ingestions, (d) phrase-merge basin gate.
8. uqrcConformance.test.ts still passes — only inject/pin used, no raw axis writes from learning side.
9. Console log emitted at most once per ingestion: "[Learning↔Field] Q=0.034 pinnedTokens=12 explore=0.08".
10. Memory rule + docs updated; cross-link added between neural-network and brain-universe-physics.
```

