

## Plan: CREATOR Proof — Block Honesty & Content-Verified Mining

### Concept

Today, mining produces blocks on a timer and rewards accumulate locally without any verification. The user asked for two things:

1. **Missing UI displays** — last block found timestamp, block height, and other stats currently absent from the Mining Panel
2. **CREATOR proof** — a new proof mechanism where blocks must be validated by content activity (seeding/receiving) and confirmed by peers before the user earns them

CREATOR = **C**ontent **R**endering **E**mpowering **A**ction **T**hrough **O**ur **R**ealm

### What Changes

```text
Current:
  Mine block → instantly count it → broadcast → earn

Proposed:
  Mine block → CREATOR proof check → broadcast to mesh
  → peers ACK with their view of your block height
  → consensus reached (majority agree) → block CONFIRMED
  → only CONFIRMED blocks earn SWARM tokens
  → UI shows pending vs confirmed blocks + last block timestamp
```

### Implementation

#### 1. Add CREATOR Proof to Mining Loop (`swarmMesh.standalone.ts`)

Before a mined block is counted, run a local "CREATOR proof" that checks:

- **Content activity**: Is the node seeding OR receiving torrents? Query `getTorrentSwarm()?.getTotalStats()` for `activeTorrents > 0` or `chunksServed > 0`. If neither, the block is still mined but marked as a "hollow block" (lower reward weight).
- **Seeding transfer rate**: Track `chunksServed` delta since last block — nodes actively serving content get a "content multiplier" on the block.
- **Next block prediction**: Use current mesh density (peerCount) + content activity to estimate time to next block (displayed in UI).

New fields on `MiningStats`:
- `confirmedBlocks: number` — blocks that passed peer consensus
- `pendingBlocks: number` — blocks mined but awaiting peer confirmation
- `hollowBlocks: number` — blocks without content activity (reduced reward)
- `lastConfirmedAt: number | null` — timestamp of last consensus-confirmed block
- `contentMultiplier: number` — current content activity bonus (1.0 = base, up to 2.0)
- `seedingActive: boolean` — whether node is currently seeding content
- `chunksServedSinceLastBlock: number` — content work since last mine tick

#### 2. Block Honesty — Mesh Consensus (`swarmMesh.standalone.ts`)

When a block is mined and broadcast:

- Add `pendingBlockId` and `minerBlockHeight` to the payload
- Peers receiving the block respond with `block-vote` (new message type) containing:
  - Their view of the miner's block height (from previous ACKs)
  - Whether they agree (height matches expected sequence)
  - Their own content stats (cross-validation)
- Miner collects votes: if **majority of connected peers** (≥50%+1) agree, block moves from `pendingBlocks` → `confirmedBlocks`
- If no consensus within 2 mining cycles (30s), block expires as unconfirmed (no reward)
- Log every stage: `CREATOR PROOF`, `BLOCK PENDING`, `VOTE RECEIVED`, `CONSENSUS REACHED` / `CONSENSUS FAILED`

#### 3. Updated Mining Panel UI (`MiningPanel.tsx`)

Add missing displays:
- **Last Block Found**: exact timestamp with relative time (`formatDistanceToNow`)
- **Block Height**: total confirmed blocks (prominent display)
- **Pending Blocks**: blocks awaiting mesh consensus (amber indicator)
- **Hollow vs Full Blocks**: show content-verified vs hollow ratio
- **Content Activity**: seeding status, chunks served, content multiplier
- **Next Block Estimate**: based on mining interval + mesh density
- **Consensus Health**: % of blocks that achieve peer agreement

Replace earnings calculation to only count `confirmedBlocks` (not `blocksMinedTotal`).

#### 4. AutoMiningService Updates (`AutoMiningService.tsx`)

Change reward logic to only credit `confirmedBlocks` deltas (not raw `blocksMinedTotal`). Hollow blocks earn 50% of normal rate. This ensures rewards match honest, verified mesh work.

### Files Modified

1. **`src/lib/p2p/swarmMesh.standalone.ts`** — CREATOR proof check in mining loop, `block-vote` message handler, consensus logic, new MiningStats fields, content activity tracking
2. **`src/components/wallet/MiningPanel.tsx`** — Complete UI refresh with all missing displays (last block, height, pending, content activity, consensus health)
3. **`src/components/AutoMiningService.tsx`** — Reward only confirmed blocks, hollow block discount
4. **`src/lib/p2p/swarmMineHealth.standalone.ts`** — Add CREATOR proof types and constants

### Why This Works

Blocks now follow both blockchain rules (sequential height, broadcast to mesh) and mesh rules (peer consensus required). Content activity proof ensures miners are actually contributing to the network (seeding files, serving chunks) — not just idling with a connection open. The mesh becomes self-policing: peers validate each other's work before anyone earns.

