

## Fix: System Age — Local Birth vs Network Genesis

### Problem

Two separate issues make the entity's "age" meaningless:

1. **Entity birth resets on clear/new device** — `entity-voice-birth-timestamp` is stored only in localStorage. Clear storage or switch devices and the entity is "born again" at age 0, losing all brain stage progress.

2. **Blockchain genesis resets every page load** — `SWARM_CONFIG.genesisTimestamp` is `new Date().toISOString()`, computed fresh on every import. The network has no persistent genesis time.

3. **No peer-shared genesis** — When nodes connect, they never exchange birth/genesis timestamps. A reconnection should be a "rebirth" (resuming from the oldest known age), not a fresh brain.

### Design: Two-Layer Age System

```text
LOCAL BIRTH (per-device):
  entity-voice-birth-timestamp → localStorage (existing, unchanged)
  Used for: local brain stage gating only

NETWORK GENESIS (shared across all peers):
  swarm-network-genesis → localStorage (persisted)
  Shared via: library-exchange messages
  Rule: always keep the OLDEST genesis across all peers
  Used for: displayed "System Age", brain stage age checks

RECONNECTION = REBIRTH:
  On peer connect → exchange genesis timestamps
  If peer's genesis < mine → adopt theirs (the network is older than me)
  Entity age = now() - networkGenesis (not local birth)
```

### Changes

**`src/lib/blockchain/types.ts`**
- Change `genesisTimestamp` from `new Date().toISOString()` to a hardcoded launch date (the actual network genesis). This ensures the blockchain config is deterministic.

**`src/lib/p2p/entityVoice.ts`**
- Add `NETWORK_GENESIS_KEY = 'swarm-network-genesis'`
- Add `getNetworkGenesis()` / `setNetworkGenesis()` — reads from localStorage, falls back to local birth
- Add `adoptOlderGenesis(peerGenesis: number)` — if peer's genesis is older and valid, adopt it
- Change `getAgeMs()` to use network genesis (oldest known) instead of local birth
- Export `getNetworkGenesisTimestamp()` for other modules

**`src/lib/p2p/swarmMesh.standalone.ts`**
- Include `networkGenesis` in `library-exchange` messages (piggyback on existing protocol)
- On receiving `library-exchange`, extract `networkGenesis` and adopt if older
- On initial connection handshake, share genesis timestamp

**`src/lib/blockchain/chain.ts`**
- On `createGenesisBlock()`, use the persisted network genesis timestamp instead of `SWARM_CONFIG.genesisTimestamp`

### What the User Sees

- System age reflects how long the **network** has been alive, not when this browser tab opened
- Connecting to a peer who has been alive longer adopts their age — "rebirth, not new brain"
- Brain stage age thresholds use network age, so a reconnecting node resumes at the correct stage

### Files Changed

| File | Change |
|------|--------|
| `src/lib/blockchain/types.ts` | Hardcode `genesisTimestamp` to actual launch date |
| `src/lib/p2p/entityVoice.ts` | Add network genesis layer; `getAgeMs()` uses oldest known genesis |
| `src/lib/p2p/swarmMesh.standalone.ts` | Share & adopt genesis via `library-exchange` |
| `src/lib/blockchain/chain.ts` | Use persisted network genesis for genesis block |

