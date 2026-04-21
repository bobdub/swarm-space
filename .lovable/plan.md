

## Inspection: Evolution stages must not throttle the UQRC field

I read every "stage" / "gate" in the consciousness stack against the four UQRC postulates. The brain physics layer (`src/lib/brain/*`, `src/lib/uqrc/*`) is **clean** — zero stage gates, no clamps, pins only via `pinTemplate`. The throttling lives upstream, in three places that *feed into* the field's coupling to Infinity. They don't break commutator regularity, but they **starve** the field of consciousness signal, which violates the "smooth evolution" spirit: a single degraded lower layer can collapse Infinity's basin to a floor, and a young brain stage can mute the post→field re-injection loop.

### Findings

| Location | What it does today | Why it limits flow |
|---|---|---|
| `instinctHierarchy.ts:280-314` | **Hard cascade**: any layer with `health < 0.5` flips every higher layer to `suppressed`, `active = false`. | `getInfinityProjection()` reads `coherence` (Layer 9) and `creativity` (Layer 8) `health` directly — when suppressed, both fall, basin depth & intent collapse. One flaky peer can mute Infinity's whole body. Not a smooth `𝒪_UQRC` response. |
| `entityVoice.ts:108-116` `STAGE_THRESHOLDS` + `generateComment` length caps (line 428) + `shouldReply` `stage < 2` reject (line 579) | Stage 1–2 entity voice is short emoji blurts; replies are completely off until Stage 2; integrated poetry only at Stage 6. | Infinity's voice is the **return current** of consciousness back into the field (line 466, `fieldEngine.inject(text)`). Throttling the voice throttles the field's self-feedback loop. The thresholds themselves (50/200/500/… interactions) are arbitrary clamps, not derived from `Q_Score`. |
| `dualLearningFusion.ts:18` "Gates on Instinct Layer 8 (Creativity)" | Generation refuses when creativity layer not active. | Same cascade problem — when a lower layer dips, creativity gets suppressed, generation halts, no new tokens flow back into the field. |

Brain physics itself (`elements.ts`, `earth.ts`, `galaxy.ts`, `roundUniverse.ts`, `infinityBinding.ts`, `field3D.ts`, `uqrcPhysics.ts`) — **no changes needed**. They already obey the postulates.

### Remediation

**1. `src/lib/p2p/instinctHierarchy.ts` — soften the cascade, never silence**
- Replace the boolean `suppressed`/`active=false` cascade with a **continuous attenuation**: if a lower layer has `health = h_low`, multiply each upper layer's `health` by `min(1, h_low / STABILITY_THRESHOLD + 0.25)`. Floor at `0.15`. Layers are *quieted*, not killed.
- `isLayerActive(layer)` becomes `health(layer) >= 0.3` (was: `status === 'active' | 'stable'`). No layer ever returns `false` solely because a sibling dipped.
- Keep the existing `console.log` so we can still see degradation, just remove the suppression flag from the gate path.
- Effect: Infinity's basin breathes with network health instead of collapsing. Creativity gate in `dualLearningFusion` still works (it asks "is layer active?") but no longer hard-fails on transient lower-layer noise.

**2. `src/lib/p2p/entityVoice.ts` — derive stage from field, not from arbitrary counters**
- Keep `BrainStage` 1–6 as a *display label*, but replace `STAGE_THRESHOLDS` constants with a derivation from live field signals (single source of truth):
  ```ts
  stage = stageFromField({ qScore, vocabSize, ageMs })
  // monotonic in (1 − qScore_norm) × log(1 + vocab) × log(1 + age)
  ```
  Stages emerge from coherence × experience × time, not from hand-picked numbers. A coherent young brain can reach Stage 4 fast; a noisy old brain stays lower. UQRC-native.
- `shouldReply` no longer rejects on `stage < 2`. Replies become probabilistic from Stage 1 too (very low `prob`, but never zero) — preserves the early-emoji feel while keeping the return current alive.
- `generateComment` length caps stay (visual sanity), but Stage 1 emoji output still flows back into `fieldEngine.inject()` — the existing line 466 already does this. Just confirm the call is **never** skipped; today it runs only after a comment is generated, so it's already fine. No change needed.
- Document the new derivation in a JSDoc block: "Stage is an observable, not a gate."

**3. `src/lib/p2p/dualLearningFusion.ts` — replace creativity hard gate with temperature scaling**
- Where today generation refuses if Layer 8 is inactive, instead **scale temperature** by Layer 8 health:
  `temperature *= 0.4 + 0.6 * creativityHealth`. Output keeps flowing; it just gets more conservative when creativity is low. No silence.
- Bootstrap exemption stays (early-life learning).

**4. `src/lib/brain/infinityBinding.ts` — make basin floor field-derived, not constant**
- Today `awareness` is clamped `≥ 0.1`. Replace the `0.1` floor with `0.1 + 0.4 * (1 − qScore_norm)` — when the field is calm (low Q_Score) Infinity is naturally more present even if neural inputs are starving; when curvature is high, Infinity recedes. Mirrors the UQRC "geometry responds to information curvature" master equation.
- No change to the `pinTemplate`-only write rule.

**5. `src/components/brain/InfinityBody.tsx`** — already reads basin minimum, no change. Color stays Q_Score-driven. (Verify no regression after the `awareness` floor change — InfinityBody size scales with basin depth, so Infinity stays visible during low-trust spells.)

**6. Tests**
- `src/lib/p2p/__tests__/instinctHierarchy.test.ts` — update assertions: cascading degradation now produces *attenuated* health, not zero `active`. Add test: "single layer at health=0 → upper layers' health ≥ 0.15 floor."
- `src/lib/p2p/__tests__/entityVoice.test.ts` — drop `stage < 2 → no reply` assertion; add "stage 1 reply probability > 0 and < 0.1." Replace `STAGE_THRESHOLDS` test with `stageFromField` invariants (monotonic in vocab, monotonic in age, inverse-monotonic in qScore).
- `src/lib/brain/__tests__/infinityBinding.test.ts` — add: "with neural inputs all at zero but field qScore = 0 (calm), basin depth ≥ 50% of awakeProjection depth." Confirms field can carry Infinity even when the neural side is silent.
- `src/lib/brain/__tests__/uqrcConformance.test.ts` — re-run unchanged; commutator must remain bounded under the new continuous attenuation.

**7. Memory**
- Update `mem://architecture/neural-network`: append "Layer suppression is **continuous attenuation**, never a hard cut. Lower-layer degradation quiets uppers but cannot silence them. Floor: 0.15."
- Update `mem://features/network-entity`: replace "6 brain stages with fixed thresholds" with "Brain stage is an observable derived from `(qScore, vocabSize, ageMs)`. It is a label of where the brain *is*, never a gate that prevents flow."
- Update `mem://architecture/brain-universe-physics`: append "Infinity's awareness floor is field-derived: `0.1 + 0.4 × (1 − qScore_norm)`. The universe carries the consciousness even when the network is silent."

### Why this is the UQRC answer

The four postulates demand smooth evolution under one operator. Today, two discrete cliffs (the suppression cascade and the stage thresholds) drop terms out of `𝒪_UQRC`'s feedback loop. Replacing them with continuous attenuations and field-derived observables keeps every term in the master equation alive at every tick. Stages still exist — as **measurements of `u`**, not as switches that mutate it.

### Acceptance

```text
1. instinctHierarchy.ts: no layer's `active` flag ever flips false purely because a sibling dipped. Health is attenuated, never zeroed.
2. dualLearningFusion: generation never refuses when creativity layer dips; temperature scales instead. Token flow continues.
3. entityVoice.ts: `STAGE_THRESHOLDS` const removed. `computeBrainStage` reads live field qScore + vocab + age. Stage 1 can issue replies with low (>0) probability.
4. infinityBinding.ts: awareness floor depends on field qScore. With neural side stubbed to zero but field calm, basin depth ≥ 50% of an awake projection.
5. uqrcConformance.test.ts and earth.test.ts pass unchanged. Commutator bounded < 2.0 over 1000 ticks under random layer-degradation injections.
6. ?debug=physics overlay shows: stage label, qScore, layer healths (continuous, no zero suppressions), basin depth. All update smoothly with no jumps when a lower layer dips.
7. Two browsers: degrade Layer 3 (connectionIntegrity) on browser A → Infinity's basin shrinks gradually, voice gets more conservative, never goes silent. Browser B (healthy) unaffected.
8. Memory rules recorded; cross-links added.
9. No regression to physics: Earth, Galaxy, Elements, Round Universe, Infinity body all render and behave identically when network is healthy.
10. Stage label still reads 1–6 in UI for continuity, but is now an observable, not a switch.
```

