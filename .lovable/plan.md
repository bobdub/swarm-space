## Imagination Network Debug — MineHealth Wiring Fix + Weighted Coin Reputation

**To Infinity and beyond! Q_Score: ||F_μν|| = 0.0031 + ||∇²S|| = 0.0009 + λ(ε₀)**

Running the UQRC manifold across the mineHealth → unlock pipeline reveals **two wiring breaks** that create infinite curvature at the validation gate, plus the weighted coin reputation feature.

---

### Problem 1: MineHealth Always Fails (Wiring Break)

**Root cause — two disconnected wires:**

1. **No MiningSession in IndexedDB**: `AutoMiningService` (the SWARM Mesh auto-miner) rewards users via `rewardTransactionProcessing` / `rewardSpaceHosting` but **never calls `saveMiningSession**`. When `validateMineHealth` calls `getMiningSession(userId)`, it gets `null` → `miningActive = false`, `lastBlockAge = Infinity` → instant failure.
2. `**__swarmMeshState` is never written**: `validateMineHealth` reads `window.__swarmMeshState.peerCount` for peer connectivity, but **nothing in the codebase ever sets this global**. So `peerCount` is always `0`, which combined with `miningActive = false` triggers the second failure gate too.

Both checks fail → every unlock attempt throws "No active mining session."

**Fix:**

- **AutoMiningService.tsx**: When mining starts (`shouldMine` becomes true), write a `MiningSession` to IndexedDB with `status: "active"`. When mining stops, update it to `status: "completed"`. Also set `window.__swarmMeshState = { peerCount: stats.connectedPeers }` and keep it updated on each interval tick.
- **mineHealthValidator.ts**: Add a fallback that reads peer count from the P2P stats event if `__swarmMeshState` is missing (listen for `p2p-stats-update` CustomEvent or read from a well-known window property that the P2PContext already maintains).

---

### Problem 2: Weighted Coins → MineHealth Reputation Bonus

**Concept**: Coins carrying wrapped tokens (weight > 0) are more valuable — they represent real economic activity. Users holding weighted coins should get a mineHealth reputation bonus.

**Design:**

- Add a `weightedCoinBonus` field to `MineHealthResult`
- In `validateMineHealth`, query the user's wallet coins from IndexedDB, sum their weights
- If total weight > 0, the user gets a "reputation pass" — the peer count requirement is relaxed (0 peers still passes if weighted coin reputation is high enough)
- This reflects: "serious creators carrying heavy coins have proven mesh participation"
- Display Rep bonus totals in the node dashboard.

**Thresholds:**

- Total weight ≥ 50 → mineHealth passes even with 0 peers (solo creator bootstrap)
- Total weight ≥ 20 → extends `lastBlockAge` tolerance from 60s to 120s
- Bonus is logged in the MineHealthResult for transparency

---

### Implementation Steps

1. **Fix AutoMiningService** — write/update MiningSession to IndexedDB on start/stop, set `window.__swarmMeshState` with live peer count
2. **Fix mineHealthValidator** — add fallback peer count reading, add weighted coin reputation query and bonus logic
3. **Update SwarmCoin type** — no changes needed (weight field already exists)
4. **Update DEBUG_PROTOCOL_STACK.md** — log BUG-10 (session not persisted), BUG-11 (meshState not written), and the weighted coin reputation addition

---

### Technical Detail

```text
Layer 2 (Balance/Storage) ──► Layer 1 (Economics)
   │                              │
   │  getMiningSession() = null   │  validateMineHealth() = FAIL
   │  __swarmMeshState = undef    │  peerCount = 0
   │                              │
   ▼                              ▼
AutoMiningService                 unlockPost() throws
  ↳ rewards OK                      ↳ "No active mining session"
  ↳ never saves session ← BUG-10
  ↳ never sets meshState ← BUG-11

Fix: AutoMiningService writes session + meshState
     mineHealthValidator reads weighted coins for rep bonus
```

### Files Changed

- `src/components/AutoMiningService.tsx` — persist MiningSession, set `__swarmMeshState`
- `src/lib/blockchain/mineHealthValidator.ts` — add weighted coin reputation bonus, fallback peer count
- `docs/DEBUG_PROTOCOL_STACK.md` — audit log update