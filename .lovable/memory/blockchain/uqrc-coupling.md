---
name: blockchain-uqrc-coupling
description: SWARM blockchain bridges to UQRC field via chainHealthBridge — smoothed tip pin on axis 2, curvature-scored fork resolution, observable reorgs
type: feature
---
The SWARM blockchain couples to the UQRC field engine through a single seam:
`src/lib/blockchain/chainHealthBridge.ts`. All chain↔field interaction goes
through this bridge — no other blockchain file may call `fieldEngine.inject`
or `pinSite` directly.

**Axis:** Reward axis (μ=2) — long-memory of rewarded events.

**Behavior:**
- `recordBlockAccepted(block)` — called from `chain.ts` after append. Injects
  `{reward: 0.4 + 0.6 * txWeight, axis: 2}` and EWMA-smooths the tip pin
  (factor 0.25) toward the new block-hash site on the lattice ring.
- `resolveFork(local, candidate)` — called from `p2pSync.ts` instead of
  longest-chain comparison. Picks the tip in the *flatter* curvature region.
  Cold-start (<50 ticks) → longest-chain fallback. Reorg depth >32 → reject.
  Ties broken by length, then lexicographic hash.
- `bootstrapChainBridge(tip)` — called once from `main.tsx` at boot.

**Observability:** `useChainBridgeStatus()` exposes `smoothedTipSite`,
`pinAgeMs`, `acceptedBlocks`, `acceptedForks`, `rejectedForks`, and
`lastReorg` ({fromHash, toHash, depth, deltaQ}). Surfaced in `AppHealthBadge`.

**Why:** Replaces "hidden weight" longest-chain with observable physics.
Transient reorgs no longer whip the lattice (smoothing). Aligns blockchain
with PROJECT_SOURCE_OF_TRUTH §3 axis-2 contract.
