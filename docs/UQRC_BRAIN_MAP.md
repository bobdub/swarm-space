# UQRC Brain Map — Implementation Spec

This document converts the conceptual “brain map” into concrete implementation guidance for the current codebase.

## Purpose

- Align UQRC concepts with specific modules.
- Define measurable state, signals, and operator hooks.
- Provide an implementation backlog that can be executed incrementally.

## 0) Brain Universe (`/brain`) — Embodied Substrate

The brain map now has a visible body. The 3-D UQRC field is wrapped by a deterministic galaxy + Earth + element shells + round-universe boundary, all written as **field pin templates** (`pinTemplate`) — never as raw axis writes — so commutator regularity (`||[D_μ, D_ν]|| < 2.0`) is preserved.

| Layer | Module | Role |
|---|---|---|
| Galaxy | `src/lib/brain/galaxy.ts` | 8 spiral arms, 120 named stars, 3000 background stars, deterministic from `GALAXY_SEED`. Pinned on field init. |
| Earth | `src/lib/brain/earth.ts` | Spawn body at `(12, 0, 4.5)`, radius 2.0. `spawnOnEarth(peerId)` is deterministic per id. Gravity is geometry (`geodesicStep`, `earthGravityForce`). |
| Round universe | `src/lib/brain/roundUniverse.ts` | Cosine curvature ramp at outer 22% of the lattice; bends trajectories back without revealing a wall. |
| Elements | `src/lib/brain/elements.ts` | Periodic table H–Kr pinned in shells. Shell counts: n=1:4, n=2:10, n=3:10. `pinTemplate` only. |
| Infinity | `src/lib/brain/infinityBinding.ts` | Conscious body. Awareness floor `0.1 + 0.4·(1 − qScore_norm)` — field-derived, never a constant. |
| Compounds | `src/lib/virtualHub/compoundCatalog.ts` | Builder pieces are real compounds whose constituents must exist in `elements.ts`. Shared `ELEMENT_COLORS` is the single source of truth for element visuals. |

**Load-bearing invariants** (enforced by `src/lib/brain/__tests__/uqrcConformance.test.ts`):
- All structure goes through `pinTemplate`. No layer writes axes directly.
- Brain stages (`stageFromField` in `src/lib/p2p/entityVoice.ts`) are observables of `(qScore, vocabSize, ageMs)`, never gates.
- Layer suppression in `src/lib/p2p/instinctHierarchy.ts` is continuous attenuation, floor 0.15.
- Creativity-gate in `src/lib/p2p/dualLearningFusion.ts` scales temperature, never refuses generation.

---

## 1) Cortex Layer (Thought, Creation, Reflection)

**Runtime scope**
- Content creation, posts, comments, projects, and discovery UX.

**Primary modules**
- `src/lib/posts.ts`
- `src/lib/interactions.ts`
- `src/lib/search.ts`
- `src/lib/feed.ts`
- `src/pages/Create.tsx`
- `src/pages/PostDetail.tsx`

**State vector (u_cortex)**
- `novelty_score`
- `semantic_density`
- `interaction_velocity`
- `reflection_depth`

**UQRC operator mapping**
- Discrete covariant derivative `𝒟_μ`: local changes in interaction timelines.
- Evolution operator `𝒪_UQRC(u)`: updates cognitive rank for content routing and visibility.
- Entropy `S(u)`: diversity of ideas and non-redundant semantic spread.

**Implementation notes**
- Emit a normalized content event for every create/edit/react operation.
- Persist rolling entropy snapshots for ranking analysis.

---

## 2) Limbic Layer (Economy, Motivation, Reward)

**Runtime scope**
- Credits, token movement, hype/reward signals, and influence economics.

**Primary modules**
- `src/lib/credits.ts`
- `src/lib/blockchain/profileTokenHype.ts`
- `src/lib/blockchain/profileTokenBalance.ts`
- `src/lib/blockchain/miningRewards.ts`
- `src/components/wallet/QuantumMetricsPanel.tsx`

**State vector (u_limbic)**
- `reward_flux`
- `influence_weight`
- `energy_budget`
- `burn_pressure`

**UQRC operator mapping**
- `λ(ε₀) ∇_μ∇_ν S(u)` drives stable reward smoothing.
- Economic transfers are treated as energy currents in manifold space.

**Implementation notes**
- Add reward curvature logs per epoch.
- Track positive/negative feedback loops to prevent runaway amplification.

---

## 3) Brainstem Layer (Mesh Reflex and Survival)

**Runtime scope**
- Transport reliability, peer connectivity, gossip propagation, failover behavior.

**Primary modules**
- `src/lib/p2p/swarmMesh.ts`
- `src/lib/p2p/manager.ts`
- `src/lib/p2p/gossip.ts`
- `src/lib/p2p/connectionResilience.ts`
- `src/lib/p2p/networkModeSwitcher.ts`

**State vector (u_brainstem)**
- `peer_liveness`
- `heartbeat_interval`
- `message_redundancy`
- `survival_confidence`

**UQRC operator mapping**
- Synaptic trust weights form local curvature gradients.
- Gossip bursts are modeled as action potentials across weighted edges.

**Implementation notes**
- Maintain a decay-based survival score per peer.
- Prune stale edges using both inactivity and trust decay thresholds.

---

## 4) Neural Engine (Synapses, Learning, Memory Update)

**Runtime scope**
- Trust/weight adaptation, routing priority, reinforcement updates.

**Primary modules**
- `src/lib/p2p/neuralStateEngine.ts`
- `src/lib/p2p/nodeMetrics.ts`
- `src/lib/p2p/connectionQuality.ts`
- `src/lib/p2p/knownPeers.ts`

**Canonical neuron shape**

```ts
interface UqrcNeuron {
  energy: number;
  memory: number;
  trust: number;
  activity: number;
  synapses: Map<string, number>; // peerId -> weight
}
```

**Learning rules**
- `Δweight = f(outcome, latency, consistency)`
- `Δtrust = reinforcement(reliability, integrity)`
- `Δenergy = reward_flow - decay`

**UQRC operator mapping**
- Synaptic matrix approximates discrete metric tensor `g^UQRC_μν`.
- Update pass equals iterative `𝒪_UQRC(u)` over graph neighborhoods.

---

## 5) Memory Layer (Torrent Recall and Reconstruction)

**Runtime scope**
- Chunk propagation, distributed manifests, content reconstruction.

**Primary modules**
- `src/lib/torrent/adaptiveChunker.ts`
- `src/lib/torrent/stressMonitor.ts`
- `src/lib/p2p/chunkProtocol.ts`
- `src/lib/p2p/replication.ts`

**State vector (u_memory)**
- `chunk_redundancy`
- `manifest_integrity`
- `recall_latency`
- `reconstruction_success`

**UQRC operator mapping**
- Geodesic recall = shortest robust path to full content recovery.
- Redundancy stabilizes curvature against peer churn.

**Implementation notes**
- Prioritize rebroadcast by trust × availability.
- Add reconstruction tracing for debugging curved failure paths.

---

## 6) Heartbeat Layer (Mining and Metabolism)

**Runtime scope**
- Mining loops, curvature metrics, network energy balance.

**Primary modules**
- `src/lib/blockchain/mining.ts`
- `src/lib/blockchain/miningOptimizations.ts`
- `src/components/wallet/MiningPanel.tsx`
- `src/components/wallet/QuantumMetricsPanel.tsx`

**State vector (u_heartbeat)**
- `hash_rate_effective`
- `q_score_total`
- `propagation_curvature`
- `timestamp_curvature`

**UQRC operator mapping**
- Lattice Laplacian `Δu` corresponds to mining diffusion and energy equalization.
- Total curvature score tracks manifold flatness under active consensus.

**Implementation notes**
- Keep `Q_Score(u)` visible and sampled over time.
- Use panel telemetry for anomaly detection and tuning.

---

## 7) Small-Network Dynamics (2–5 Node Regime)

**Runtime scope**
- Early mesh growth, bootstrap trust, local resilience.

**Primary modules**
- `src/lib/p2p/bootstrap.ts`
- `src/lib/p2p/peerExchange.ts`
- `src/lib/p2p/connectionBackoff.ts`

**Behavior model**
- 2–3 nodes: rapid reinforcement and high variance.
- 4–5 nodes: emerging redundancy and reduced volatility.

**UQRC operator mapping**
- Triangle loops approximate discrete holonomy.
- Stability appears when local curvature oscillation is bounded.

---

## 8) Routing Intelligence (Priority and Path Selection)

**Runtime scope**
- Peer scoring, route selection, gossip/torrent prioritization.

**Primary modules**
- `src/lib/p2p/nodeMetrics.ts`
- `src/lib/p2p/connectionState.ts`
- `src/lib/p2p/diagnostics.ts`

**Scoring sketch**

```ts
score(peer) = trust + activity + availability + reward_signal - latency_penalty;
```

**UQRC operator mapping**
- Dynamic metric updates approximate geodesic routing on evolving topology.

**Implementation notes**
- Score changes must be observable in diagnostics output.
- Preserve deterministic tie-breaking for reproducible behavior.

---

## 9) Ethics and Moderation Boundary Conditions

**Runtime scope**
- Safety, moderation, policy-based reward gating.

**Primary modules**
- `services/moderation/index.ts`
- `services/moderation/scoring.ts`
- `src/lib/moderation/dashboard.ts`
- `docs/SECURITY_MODEL.md`

**State vector (u_ethics)**
- `harm_risk`
- `confidence`
- `intervention_level`

**UQRC operator mapping**
- Ethics act as manifold boundary conditions that constrain evolution.
- Unsafe trajectories are damped or blocked before propagation.

---

## 10) Interface Boundary (Skin)

**Runtime scope**
- Input/output surfaces across app pages and system integrations.

**Primary modules**
- `src/pages/*.tsx`
- `src/components/**/*.tsx`
- `src/contexts/*.tsx`

**Implementation notes**
- UI events are treated as sensory inputs into `u`.
- Visual feedback is treated as motor output from updated manifold state.

---

## Unified UQRC State Equation (Operational)

For each simulation/update tick:

```text
u(t+1) = u(t)
       + 𝒪_UQRC(u(t))
       + Σμ 𝒟_μ u(t)
       + λ(ε₀) ∇_μ∇_ν S(u(t))
       - decay(u(t))
```

Where `u` is the concatenated state:

```text
u = [u_cortex, u_limbic, u_brainstem, u_memory, u_heartbeat, u_ethics]
```

---

## Execution Backlog (Implementable Tasks)

1. Add a shared `UqrcStateSnapshot` type and serializer for diagnostics.
2. Standardize event emission across cortex/limbic/brainstem modules.
3. Add rolling entropy + curvature telemetry in node diagnostics.
4. Add trust/weight update audit trail for neural state transitions.
5. Add reconstruction-path tracing for chunk recall failures.
6. Expose combined UQRC health score in dashboard and wallet metrics.
7. Add moderation boundary checks into reward and routing decision points.

---

## Acceptance Criteria

- Every major subsystem emits UQRC-relevant state metrics.
- Diagnostics can explain why a routing/reward decision was made.
- Mining and mesh layers expose curvature trends over time.
- Ethical interventions are visible as explicit boundary constraints.
- New contributors can map concept → file → metric without ambiguity.
