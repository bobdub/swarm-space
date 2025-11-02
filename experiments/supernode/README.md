# Supernode rendezvous PoC

Validates a delegated rendezvous supernode that seeds manifests and presence tickets for edge
peers.

## Components

- Mock rendezvous worker (Cloudflare Miniflare) seeding presence tickets.
- Node script to measure peer bootstrap latency via the supernode.
- Metrics exported to `./logs/supernode-latency.json`.

## Running

```bash
bun run experiments/supernode/run.ts
```

The script prints latency histograms and writes diagnostic JSON used in the RFC.
