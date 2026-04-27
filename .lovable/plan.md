## Neural Network Bus — Smoothness Scoring + Waiting-Pair Resolution

Extend the existing **Global Cell Bus cycle** (`src/lib/p2p/globalCell.ts → runConnectionBusCycle`) so no node — especially a fresh login — can complete a full Bus loop while still in the **Waiting** state. The Bus already runs every 15 s and already tracks waiting nodes; we add (1) richer smoothness scoring, (2) a deterministic **waiting-pair fallback (Option B)**, (3) a per-node **Synapse memory layer**, and (4) the doc/source-of-truth alignment.

No structural changes. No new timers. No new transports. Bus continues to be observation-only — never mines.

---

### What changes (user view)

- New users and reconnecting users move from **Waiting → Connected (Mining)** within one Bus cycle (≤15 s, often immediate via the existing fast-emit path).
- Stable, historically reliable peers naturally rise to the top of the candidate list over time.
- "Two waiting nodes find each other" is now an explicit, deterministic outcome instead of relying on luck.
- The doc `docs/NEURAL_NETWORK_BUS.md` is updated to reflect the three-state axiom (Connected / Waiting / Offline) and the smoothness model.

---

### Technical changes

**1. `src/lib/p2p/synapseLayer.ts` (new, ~80 LOC)**
Lightweight per-peer memory with no extra timers:
- `recordHandshake(peerId, success: boolean, rttMs?: number)` — called from existing connect callbacks.
- `getSmoothness(peerId, now)` returns `S_smooth = exp(-Δt/τ) · successRate` with `τ = 5 min`.
- Persists to `localStorage` under `swarm-bus-synapse` (≤ 64 bytes per entry, capped at 256 entries via LRU).
- Pure functions; covered by a small unit test.

**2. `src/lib/p2p/globalCell.ts` — extend `runConnectionBusCycle`**

a. **Smoothness score** (replaces current `trustScore`-only sort):
```
smoothness = 0.45·trustScore
           + 0.25·S_smooth(peer)            // synapse memory
           + 0.20·(1 − normalizedRtt)        // latency proxy from connectionQuality
           + 0.10·(1 − normalizedLoad)       // 1 / (1 + connectedPeers/target)
```
Latency comes from `connectionQuality.ts` (already imported elsewhere); load comes from `mesh.getStats().connectedPeers`. All inputs already exist in the codebase.

b. **Two-mode resolution** (matches user spec):
- **Local Connected** → pick the longest-waiting candidate first, smoothness as tiebreaker (current behavior, kept for fairness).
- **Local Waiting** → pick the smoothest Connected peer first; if none visible in this Bus slice, fall back to **Option B**.

c. **Option B — waiting-pair fallback** (new):
- If we are Waiting AND no Connected peer is in `livePeers`, deterministically pair with the longest-waiting *other* Waiting node whose `peerId` sorts lexicographically lower than ours (prevents both sides dialing simultaneously). The other side will see us as the longest-waiting candidate and accept.
- Emits a `cell-bus-pair` diagnostic so the dashboard can surface it.

d. **One-loop guarantee**:
- Track `lastBusCycleResolvedAt`. If a full beacon interval has elapsed without any resolution while `waitingNodes.size > 0`, force one extra `pulsePresence('bus-loop-guarantee')` to trigger immediate re-emit. Costs nothing when the mesh is healthy.

**3. `src/lib/p2p/swarmMesh.standalone.ts` — minimal hook**
Wire success/failure of `connectToPeer` into `synapseLayer.recordHandshake(...)`. Two call sites: the existing `onopen` and `onerror`/`onclose` paths. ~6 LOC.

**4. `src/lib/p2p/__tests__/busCycle.test.ts` (new)**
Three deterministic cases:
- Local Connected + one long-waiting peer → that peer is selected.
- Local Waiting + no Connected peers + one other Waiting peer with lower peerId → Option B pair triggered.
- Smoothness ordering: peer with higher synapse memory beats higher-trust newcomer.

**5. `docs/NEURAL_NETWORK_BUS.md` — rewrite to source-of-truth wording**
- Three-state axiom (Connected / Waiting / Offline).
- Smoothness formula and synapse field definition.
- Option A / Option B resolution.
- Explicit non-goal: Bus never mines, never wraps Gun.js cell.

**6. `.lovable/memory/architecture/` — new `bus-resolution-layer.md`**
Records the smoothness formula and Option-B rule so future changes don't regress the contract.

---

### Files touched

- new: `src/lib/p2p/synapseLayer.ts`
- new: `src/lib/p2p/__tests__/busCycle.test.ts`
- new: `.lovable/memory/architecture/bus-resolution-layer.md`
- edit: `src/lib/p2p/globalCell.ts` (extend `runConnectionBusCycle`, add Option B, smoothness, loop guarantee)
- edit: `src/lib/p2p/swarmMesh.standalone.ts` (record handshake outcomes into synapse — ~6 LOC)
- edit: `docs/NEURAL_NETWORK_BUS.md` (full rewrite to spec)
- edit: `MemoryGarden.md` (caretaker reflection extension, per project ritual)

---

### Why this is safe

- No new timers, no new transports, no Gun.js changes.
- All inputs (`trustScore`, latency, peer count, handshake events) already exist.
- Synapse layer is bounded (256 entries LRU, ≤64 B each) and persisted locally only.
- Bus stays observation-only; mining gate (`mineHealthValidator` / hard peer gate) is untouched.
- Existing tests in `p2pBootHardening.test.ts` continue to pass; new test covers the resolution matrix.