# WebTorrent mesh PoC

Explores seeding file manifests and encrypted payloads over WebTorrent swarms.

## Components

- Browser-side seeding harness that joins a static info-hash.
- CLI leecher measuring chunk availability and swarm health.
- Diagnostic output stored in `./logs/webtorrent-metrics.json`.

## Running

```bash
bun run experiments/webtorrent/run.ts
```

> The current script boots a stub harness and prints TODO notes until the WebTorrent bindings are integrated.
