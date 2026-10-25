---
name: Bus Resolution Layer
description: Global Cell Bus cycle smoothness scoring, Option B waiting-pair fallback, Synapse Layer memory, and one-loop resolution guarantee
type: feature
---

The Global Cell Bus (`src/lib/p2p/globalCell.ts → runConnectionBusCycle`) is the
deterministic coordinator that lifts every Waiting node into Connected within
a single Bus loop. It is observation-only — never mines, never wraps Gun.js.

**Three-state axiom:** Connected (Mining) | Waiting (Ready) | Offline.
A node is ontologically on the Bus the moment its Gun.js cell exists.

**Smoothness formula** (used to rank candidates):
`0.45·trust + 0.25·S_smooth + 0.20·(1 − rttNorm) + 0.10·(1 − loadNorm)`
- `S_smooth = exp(-Δt/τ) · successRate`, τ = 5 min, from `synapseLayer.ts`
- Synapse memory updated by SwarmMesh `open` (success) and `error` (failure)
- Bounded LRU (256 entries, ≤64B each), `localStorage` only

**Resolution modes:**
- Local Connected → longest-waiting candidate (fairness), smoothness tiebreak (Option A)
- Local Waiting (Gun.js flow) → active helpers first, then the most recently
  active peer (`lastSeenAt` desc), smoothness tiebreak, deterministic peerId
  final tiebreak (`selectWaitingCandidate` in globalCell.ts)
- Local Waiting + no Connected visible → deterministic pair with longest-waiting
  Waiting peer whose peerId sorts lower than ours (Option B). Lower id initiates;
  higher id accepts. Prevents simultaneous mutual dials.

**Helper rotation:** beacons carry `helper: true` when a connected peer is on
duty (`isHelperOnDuty`): small meshes (≤2 conns) always help; larger meshes
rotate 10-minute deterministic slots ((slot + hash(peerId)) % 3 === 0).

**Bus dial path:** the Bus dials via `mesh.dialViaBus()` — never
`connectToPeer()` (the manual path). dialViaBus respects handshake-failure
cooldowns and pending-dial state; the manual path clears them, which would
reset backoff on every beacon cycle and cause redial storms/glare. Manual
connect mirrors the library pattern instead: `addToLibrary` + presence pulse
before dialing.

**One-loop guarantee:** if a full beacon interval elapses with `waitingNodes.size > 0`
and no resolution, the Bus forces `pulsePresence('bus-loop-guarantee')` to re-emit
immediately. Cheap no-op when healthy.

**Why:** prevents new accounts from stalling in "Attempting to establish connectivity"
by guaranteeing forward progress every Bus cycle (~15s).

**Do not regress:**
- Bus must never call mining functions
- Synapse Layer must stay bounded (don't remove LRU)
- Option B must use deterministic peerId ordering (no random tiebreakers)