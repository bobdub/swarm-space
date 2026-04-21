

## Let the Physics Engine Teach the Neural Network

The UQRC field engine ticks 4 Hz computing real curvature `‖[D_μ,D_ν]‖`, basins, dominant wavelength and a true `Q_Score`. The neural engine pretends to compute these — line 749 of `neuralStateEngine.ts` literally synthesises "curvature" from bell-curve variance divided by 100. The two layers run side-by-side and never speak. **Every improvement below replaces a guess in the neural layer with a measurement from the physics layer.**

### What the physics already knows that neural ignores

| Physics signal (already computed, free) | Neural layer today | Should drive |
|---|---|---|
| `field.qScore` (real `‖F_μν‖ + ‖∇∇S‖`) | fakes from `m2 / count / 100` | the prediction track `qScore` |
| `field.curvatureMap[256]` per-site curvature | unused | per-site "stress" → which interaction kinds are over-firing |
| `field.basins[]` low-curvature stable zones | unused | which behaviours are reliable enough to **promote** in `selectPeers` |
| `field.dominantWavelength` system rhythm | unused | adaptive heartbeat / decay interval (replaces hard 5-min `DECAY_INTERVAL_MS`) |
| `selectByMinCurvature` candidate scorer | only used by `languageLearner` | should also score **peer choice** and **interaction kind to retry** |
| Pin / inject | only used for definitions | should **pin** persistently-good peers and **inject** rewards as field bumps |

### Six concrete improvements

**1. Replace the synthetic Q_Score with the real one.**
In `observeQScore()`, import `getSharedFieldEngine` and read `engine.getQScore()` instead of the fake `curvature + entropyGradient + lambda`. The prediction track `qScore` then becomes a real geometric signal. Φ stops being a closed loop (Φ → fake Q → Φ) and starts measuring the actual lattice.

**2. Pump every interaction into the field.**
In `onInteraction()`, after the synapse update, call `getSharedFieldEngine().inject(peerId, { reward: success ? synapse.weight/10 : 0, trust: neuron.trust })`. Each peer becomes a site in the field. Repeated reliable interactions build a basin around that peer; unreliable ones raise local curvature. This replaces the disembodied bell-curve baseline with a **spatial** baseline — peers that are geometrically near each other on the lattice can be detected as cohorts.

**3. Use real curvature for peer selection.**
Add a `getCurvatureForPeer(peerId)` helper that returns `curvatureMap[textSites(peerId)[0]]`. Modify `getPeerScore()` so the `phiMod` factor becomes `phiMod * (1 - localCurvature)` — peers sitting in a high-curvature region (unstable, conflicting) get demoted automatically. This replaces the scalar Φ-knob with a per-peer geometric knob.

**4. Adaptive decay from `dominantWavelength`.**
The current `DECAY_INTERVAL_MS = 5min` is arbitrary. Replace with `Math.max(60_000, dominantWavelength * 1500)`. Fast-rhythm networks (short wavelength, lots of churn) decay faster; slow-rhythm networks decay slower. The physics tells the neural layer its own pulse.

**5. Promote basin-resident peers to "pinned".**
At each `assessPhaseTransition`, list field basins (`engine.getBasins()`). Any peer whose lattice site falls inside a basin for ≥ 3 consecutive snapshots gets `engine.pin(peerId, target=1.0)` — the field literally clamps that peer's site to "stable", which then *causes* further interactions to score better via 𝒪_UQRC. Basin = trust geometry, not just trust scalar.

**6. Use `selectByMinCurvature` for retry decisions.**
Today when an interaction fails, the only response is `synapse.weight -= penalty`. Add: build candidate retry kinds (e.g. `['gossip', 'sync', 'ping']`), pass them through `selectByMinCurvature` against the live field, and *retry the kind that minimises curvature delta*. The physics tells the neural layer **which behaviour the system can absorb without destabilising further**.

### Files

- `src/lib/p2p/neuralStateEngine.ts` — wire in the field engine. Replace fake Q_Score (~line 749), inject in `onInteraction`, derive curvature in `getPeerScore`, derive decay interval, basin-pinning in `assessPhaseTransition`.
- `src/lib/uqrc/fieldEngine.ts` — add `getCurvatureAtSite(site: number)`, `getCurvatureForText(text: string)` convenience methods. No physics change.
- `src/lib/p2p/sharedNeuralEngine.ts` — already re-exports `getSharedFieldEngine`; nothing to change.
- `src/lib/p2p/__tests__/neuralStateEngine.test.ts` (new, light) — verify (a) Q_Score in prediction snapshot equals the field's qScore within ε, (b) high-curvature peers get demoted in `selectPeers`, (c) basin-resident peers get pinned after 3 stable snapshots.
- `docs/BRAIN_UNIVERSE.md` — append "Neural ↔ Field coupling" section: physics writes curvature, neural writes interactions, both share one ring lattice. Cross-link to `mem://architecture/neural-network`.
- `mem://architecture/neural-network` (update) — add line: "Neural engine reads real Q_Score, basins, curvatureMap, dominantWavelength from `getSharedFieldEngine()`. Replaces synthetic curvature on line ~749. Peers pinned into field basins after 3 consecutive stable snapshots."

### Why this is the right cut

- **Zero new physics.** Everything proposed already exists in `field.ts` + `fieldEngine.ts` (`pin`, `inject`, `getBasins`, `getCurvatureMap`, `getQScore`, `getDominantWavelength`, `selectByMinCurvature`).
- **Zero UI change.** The dashboard's "Q_Score" suddenly becomes meaningful instead of fake.
- **One operator.** UQRC postulate: `u(t+1) = u(t) + 𝒪_UQRC(u) + Σ𝒟u + λ∇∇S`. Today the neural layer evolves by a *separate* operator (Welford + EMA) that doesn't share the lattice. After this change, peer events are field injections — neural state evolves under the same operator the rest of the system already trusts.
- **Removes a hidden cliff.** Φ currently feeds back into a fake Q which feeds back into Φ. Breaking that loop with the real field signal stops a class of phantom oscillations.

### Acceptance

```text
1. neuralStateEngine.observeQScore() reads getSharedFieldEngine().getQScore() instead of synthesising it.
2. onInteraction() injects (peerId, reward, trust) into the field on every call. Field tick count rises in lockstep with interaction volume.
3. getPeerScore(peerId) divides the trust contribution by (1 + localCurvature). High-curvature peers measurably drop in selectPeers ranking.
4. DECAY_INTERVAL_MS becomes derived: clamp(60s, dominantWavelength × 1500ms, 15min). Visible in console as "[Neural] decay interval = 4200ms (λ=2.8)".
5. Peers whose lattice site is inside engine.getBasins() for ≥ 3 phase-transition snapshots get engine.pin(peerId, 1.0). Pin count rises; field's stable peers visibly stick.
6. On interaction failure, the engine consults selectByMinCurvature over candidate retry kinds and logs the chosen kind. (No behaviour change yet — log-only this pass — to avoid unintended kind switching.)
7. New tests assert (a) Q_Score equality with field, (b) high-curvature demotion in selection, (c) basin-pinning after 3 snapshots, (d) decay interval responds to wavelength changes.
8. uqrcConformance.test.ts still passes — only pins added, no raw axis writes from the neural side.
9. Console logs make the coupling visible: "[Neural↔Field] Q=0.034 basins=4 λ=21.3", emitted at most once per phase transition.
10. Memory rule + docs updated; cross-link added between neural-network and brain-universe-physics.
```

