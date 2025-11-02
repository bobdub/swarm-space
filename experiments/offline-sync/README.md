# Offline sync queue PoC

Validates delayed peer synchronization by queueing manifests and posts while disconnected.

## Components

- Local persistence adapter simulating offline storage snapshots.
- Replay worker that reconciles queued updates when connectivity returns.
- Metrics log at `./logs/offline-replay.json` capturing drift duration and replay results.

## Running

```bash
bun run experiments/offline-sync/run.ts
```

> The script currently emits placeholder telemetry until the full simulator lands.
