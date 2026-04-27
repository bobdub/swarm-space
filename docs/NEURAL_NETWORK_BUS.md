# Neural Network Bus — UQRC-Aligned Source of Truth

## Objective

The Bus is the network's native spacetime fabric. It already traverses the
full known network through beacon + prune cycles. This document defines how
the Bus deterministically lifts every new or reconnecting user from the
**Waiting** basin into a **Connected (Mining)** state within a single Bus
cycle, so no node can remain stalled inside the Gun.js cell.

No structural changes; no new transports; no new timers. The Bus stays
**observation-only** — it never mines, never wraps the Gun.js cell, only
resolves peer links during its natural cadence.

## Three-State Axiom (Immutable)

Every node is always in exactly one of three conditions:

1. **Connected (Mining)** — ≥ 1 live peer link. Mining proceeds.
2. **Waiting (Ready)** — Gun.js cell instantiated, 0 live peers. Primed to
   mine the moment a link is resolved. No additional placement step.
3. **Offline** — not attempting to mine or connect.

A node is ontologically placed onto the Bus the moment its Gun.js cell
exists. The Bus simply becomes self-aware of Waiting states during its
heartbeat.

## Bus Cycle (Per Prune Tick)

Implemented by `runConnectionBusCycle` in `src/lib/p2p/globalCell.ts`.

1. Build the waiting candidate set from live presence beacons that are not
   yet locally connected.
2. Compute a **smoothness score** per candidate (see below).
3. Apply deterministic resolution:
   - **Local Connected → Option A:** prefer the longest-waiting candidate
     (fairness gradient), smoothness as tiebreaker.
   - **Local Waiting → Option A:** prefer the smoothest visible Connected
     peer.
   - **Local Waiting → Option B (fallback):** if no Connected peer is
     visible in this Bus slice, deterministically pair with the
     longest-waiting Waiting partner whose `peerId` sorts lower than ours
     (lower id initiates; higher id passively accepts → no mutual dial).
4. **One-loop guarantee:** if a full beacon interval elapses with waiting
   nodes still present and no resolution, force a presence pulse so the
   next cycle re-evaluates immediately.

## Smoothness Score

```
smoothness = 0.45·trust + 0.25·S_smooth + 0.20·(1 − rttNorm) + 0.10·(1 − loadNorm)
```

- `trust` — beacon-supplied trust score ∈ [0,1]
- `S_smooth(peer, t) = exp(−Δt / τ) · successRate`, τ = 5 min — the
  **Synapse Layer** (per-peer handshake memory in
  `src/lib/p2p/synapseLayer.ts`)
- `rttNorm` — smoothed RTT clamped to 600 ms then normalized
- `loadNorm` — local mesh fullness = `connectedPeers / target`

The Synapse Layer is updated from the existing SwarmMesh `open` /
`error` callbacks. It is bounded (256 entries LRU, ≤ 64 B per entry) and
stored only in `localStorage`.

## Execution Constraints (Non-Negotiable)

- Nodes MUST NOT mine unless **Connected**.
- The Bus performs only connection-state observation and routing decisions.
- The Bus never executes mining logic.
- The Bus never replaces or wraps the Gun.js cell — it only "lights" the
  cell by resolving peer links.
