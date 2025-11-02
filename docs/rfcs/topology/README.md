# RFC: Swarm topology evolution

This RFC collects the integration plan for supernodes, DHT routing, offline sync queues, WebTorrent
bridges, and GUN.js overlays. The goal is to let Swarm Space maintain availability when the primary
rendezvous mesh is congested or intermittently offline.

## Goals

1. **Preserve authenticity guarantees** – all alternate transports must respect Ed25519 signatures
   for manifests and posts.
2. **Improve discovery latency** – peer bootstrap should remain <2s even when the primary rendezvous
   worker is saturated.
3. **Enable opportunistic sharing** – offline clients should reconcile manifests/posts without manual
   intervention once connectivity returns.
4. **Offer modular experiments** – each transport experiment should be runnable in isolation under
   `experiments/` and publish telemetry to feed future milestones.

## Experiments

### Supernode rendezvous

- Dedicated supernode caches rendezvous tickets and seeds manifests for cold peers.
- Planned metrics: bootstrap latency histogram, cache hit ratio.
- Prototype entry point: `experiments/supernode/run.ts` (placeholder script today).

### DHT membership

- Kademlia-inspired routing table for distributing rendezvous pointers.
- Planned metrics: hop count distribution, routing table churn.
- Prototype entry point: `experiments/dht/simulate.ts` (placeholder script today).

### Offline sync queues

- Local persistence buffers manifests/posts with tombstones and replay metadata.
- Planned metrics: replay duration, conflict rates, staleness windows.
- Prototype entry point: `experiments/offline-sync/run.ts`.

### WebTorrent bridge

- WebTorrent swarm distributes encrypted payloads referenced by manifests.
- Planned metrics: swarm size, piece availability, seeding duration.
- Prototype entry point: `experiments/webtorrent/run.ts`.

### GUN.js overlay

- Opportunistic gossip overlay that mirrors manifest/post metadata into a GUN graph.
- Planned metrics: eventual consistency lag, conflict resolution frequency.
- Prototype entry point: `experiments/gun/run.ts`.

## Proof-of-concept validation

Each experiment will emit structured logs under `experiments/<name>/logs/` (stubs today). The logs
feed into comparative dashboards to decide which transports graduate into production.

Immediate next steps:

- Flesh out placeholder runners with real simulations/harnesses.
- Document the telemetry schema expected from each experiment.
- Evaluate security implications of bridge transports (e.g., WebTorrent peers verifying signatures).

## Integration milestones

1. Wire supernode caching into the existing rendezvous worker as an optional tier.
2. Introduce DHT-assisted peer discovery when supernodes are unreachable.
3. Allow offline clients to replay queue bundles automatically on reconnect.
4. Offer WebTorrent/GUN.js bridging behind experimental feature flags for operators.

Progress will be tracked in this RFC alongside telemetry exports from the experiments.
