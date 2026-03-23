## Plan: Mining as Motion — Network-Stabilizing Block Production

### Concept

Today, mining in SWARM Mesh is a passive reward loop — it increments random counters every 15 seconds and broadcasts a `blockchain-tx` message. The heartbeat system runs separately on an 8-second interval. These are two parallel loops doing overlapping work but not reinforcing each other.

**The idea**: merge mining into the network's connective tissue. Every mined block becomes a "pulse" that actively strengthens the mesh — confirming peer liveness, triggering stale-peer cleanup, propagating discovery, and measuring connection quality. Mining stops being a side effect of being online and becomes the *reason* the network stays healthy.

### What Changes

```text
Current:
  Heartbeat (8s)  ──►  ping/pong, stale check
  Mining (15s)    ──►  random stats, broadcast tx
  (independent, no cross-talk)

Proposed:
  Mining Pulse (15s) ──►  mine block
                     ──►  broadcast block to all peers (= heartbeat)
                     ──►  peers ACK with their peer count + uptime
                     ──►  ACK updates liveness + connection quality
                     ──►  no ACK within 2 cycles = stale peer cleanup
                     ──►  block carries peer list snippet (= passive PEX)
  Heartbeat (8s)    ──►  remains as lightweight keepalive (unchanged)
```

Mining becomes the heavy heartbeat. The lightweight 8s heartbeat stays for fast stale detection, but mined blocks carry richer metadata that actively improves mesh topology.

### Implementation — Single File

**File**: `src/lib/p2p/swarmMineHealth.standalone.ts`

#### 1. Enrich the mining broadcast payload

The current `blockchain-tx` broadcast only carries `{ txCount, mbHosted }`. Extend `meta` to include:

- `peerCount`: number of active connections (lets peers gauge mesh density)
- `librarySnapshot`: array of up to 5 peer IDs from our library (passive PEX — peers learn about nodes they haven't met)
- `uptime`: seconds since `startedAt` (helps peers prioritize stable nodes)
- `blockHeight`: cumulative `blocksMinedTotal` (consistency check across mesh)

#### 2. Handle incoming mining broadcasts as liveness signals

When a peer receives a `blockchain-tx` of type `mining_reward`, treat it as a confirmed heartbeat:

- Update `lastActivity` on the sending peer (same as heartbeat-ack does today)
- If the `librarySnapshot` contains unknown peer IDs, add them to our library and attempt dial (same as library-exchange discovery, but piggybacks on mining — no extra message)
- Track `lastMinedBlock` timestamp per peer in `peerData` — peers actively mining are "energized" and should be prioritized for reconnection

#### 3. Stale peer detection informed by mining

Currently stale peers are detected by heartbeat timeout (30s). Add a secondary signal:

- If a peer hasn't sent a mining broadcast in `3 × MINING_INTERVAL` (45s) AND hasn't responded to heartbeats, they're considered "cold" — deprioritize in reconnection but don't disconnect (they may have mining toggled off)
- If a peer IS mining (we've seen their blocks), they get a longer stale threshold (60s instead of 30s) because their mining broadcasts prove liveness even if a heartbeat packet drops

#### 4. Mining-driven reconnection boost

In the library reconnect loop (runs every 30s), prioritize peers that were previously seen mining:

- Sort reconnection candidates by `lastMinedBlock` timestamp (most recently mining first)
- These peers are proven to be active mesh participants — reconnecting to them has higher success probability

#### 5. Connection quality from mining ACKs

When broadcasting a mined block, peers respond with a lightweight `mining-ack`:

- New message type: `mining-ack` with `{ blockHeight, peerCount, ts }`
- Round-trip time from block broadcast to ack = connection quality metric
- Store as `miningRtt` on `peerData` — surfaced in Node Dashboard connection health

### What Stays the Same

- The 8-second heartbeat loop is untouched (fast keepalive)
- Mining toggle still controls whether blocks are produced
- Mining stats (transactionsProcessed, spaceHosted, blocksMinedTotal) still accumulate the same way
- Builder Mode mining controls are unaffected
- No new files — all changes are within the existing standalone mesh class

### Files Modified

1. `src/lib/p2p/swarmMineHealth.standalone.ts` — enrich mining broadcast, handle mining-ack, prioritize mining peers in reconnection, passive PEX via block metadata

### Why This Works

Mining already requires being online and connected. By embedding network intelligence into every mined block, we turn passive computation into active mesh maintenance. The more peers mine, the more stable and well-connected the network becomes. It's a virtuous cycle: mining → better connections → more peers reachable → more transactions to mine → more blocks → more connection data.