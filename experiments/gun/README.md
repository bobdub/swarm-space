# GUN.js mesh PoC

Investigates using GUN.js for opportunistic peer gossip alongside the rendezvous mesh.

## Components

- Lightweight relay node bridging rendezvous peers into a GUN graph.
- Browser playground for writing manifests/posts into the graph namespace.
- Snapshot export in `./logs/gun-sync.json` summarizing conflict resolution outcomes.

## Running

```bash
bun run experiments/gun/run.ts
```

> The runner currently outputs scaffolding notes; the real adapters will ship alongside the RFC prototype work.
