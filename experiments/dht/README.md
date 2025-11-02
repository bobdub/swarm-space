# DHT membership PoC

Explores a Kademlia-inspired routing table for peer discovery.

## Components

- In-memory DHT simulator with pluggable distance metrics.
- Stress test generating 5k random peers and measuring hop counts.
- Result snapshots written to `./logs/dht-hop-metrics.json`.

## Running

```bash
bun run experiments/dht/simulate.ts
```

Inspect the JSON log for `avgHops`, `maxHops`, and bucket distribution.
