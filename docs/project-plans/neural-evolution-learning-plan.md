# Project Plan: Neural Network Evolution & Learning Mapping

_Created: 2026-03-27_

## Goal

Improve the evolution and learning system so the neural network builds **reliable baselines**, reinforces **stable patterns**, adapts to disruption, and develops a **self-aware feedback loop** that evaluates whether experiences are worth learning from.

---

## Phase 1: Φ-Driven Adaptive Behavior

### Tasks
- [ ] Wire Φ `tighten` recommendation into mining heartbeat: reduce interval from 15s → 10s
- [ ] Wire Φ `relax` recommendation: extend mining interval to 20s for efficiency
- [ ] Add Φ-aware peer selection during reconnection — prefer stable peers when Φ is low
- [ ] Log Φ transitions with context tags (peer-join, peer-leave, network-partition, recovery)

### Files
- `src/lib/p2p/neuralStateEngine.ts` — Φ recommendations
- `src/lib/blockchain/mining.ts` — adaptive heartbeat intervals
- `src/lib/p2p/swarmMesh.standalone.ts` — Φ-aware peer selection

---

## Phase 2: Bell Curve Intelligence Routing

### Tasks
- [ ] Route gossip outliers (|z| > 2) through high-trust peers before wide broadcast
- [ ] Integrate bell curve scoring into torrent chunk priority — reliable peers get more requests
- [ ] Add per-synapse decay tied to peer inactivity (configurable half-life)
- [ ] Build "learning confidence" metric: how many interactions before the baseline is reliable

### Acceptance Criteria
- Outlier messages are relayed through trust-filtered paths before broadcast
- Inactive peers lose synapse weight over time (decay half-life: 1 hour)
- Learning confidence reaches "stable" after ~50 interactions per kind

---

## Phase 3: Memory & Reconstruction Learning

### Tasks
- [ ] Add reconstruction-path tracing for chunk recall failures — which path failed?
- [ ] Prioritize chunk rebroadcast by `trust × availability` scoring
- [ ] Build synapse audit trail visualization for Node Dashboard
- [ ] Store bell curve snapshots in memory coins for cross-session persistence

---

## Dependencies
- Neural State Engine with Bell Curves (✅ delivered)
- Φ Transition Quality (✅ delivered)
- Torrent Swarm with dead-seed cleanup (✅ delivered)
