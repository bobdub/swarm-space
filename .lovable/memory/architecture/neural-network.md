---
name: neural-network
description: 9-layer Instinct Hierarchy with continuous attenuation (no hard cuts), Phi transition, Welford-derived bell curves
type: architecture
---
The network functions as a learning organism governed by a 9-layer Instinct Hierarchy (localSecurity → networkSecurity → connectionIntegrity → consensus → torrentTransfers → decentralization → exploration → creativity → coherence). Layer 3 (connectionIntegrity) gates upper layers via its connectionHealth signal.

**Layer suppression is continuous attenuation, never a hard cut.** When a lower layer's health dips below `STABILITY_THRESHOLD` (0.5), upper layers are *quieted* by a multiplicative factor `min(1, h_low / 0.5 + 0.25)` — never silenced. Floor: `ATTENUATION_FLOOR = 0.15`. A layer is considered `active` when `health ≥ 0.3`. This preserves smooth evolution under `𝒪_UQRC` — no discrete cliffs that drop terms out of the master equation. Lower-layer degradation is logged but no longer flips upper layers to `active = false`.

The engine uses Welford-derived bell curves to track interaction stats and Φ phase transitions to summarize coherence. See `mem://features/network-entity` for how stages are derived from this state.
