# P2P transport benchmarks

These harnesses stress-test the new WebTorrent and GUN transport adapters introduced in
`src/lib/p2p/transports/`. They simulate peer churn, forced fallbacks, and overlay floods so that
operators can evaluate how resilient the mesh remains when PeerJS is degraded.

## Scenarios

1. **WebTorrent fallback latency** – Measures time-to-first-chunk when PeerJS sends are blocked.
2. **GUN overlay relay** – Exercises overlay replication when a subset of peers are forced offline.
3. **Flood resilience** – Generates burst traffic on both alternate transports to validate throttling heuristics.

Each scenario emits structured JSON so CI or observability pipelines can ingest the results.

## Running

```bash
npx ts-node ops/benchmarks/p2p/fallback-benchmark.ts --scenario webtorrent
npx ts-node ops/benchmarks/p2p/fallback-benchmark.ts --scenario gun
```

The script accepts a `--peers` flag to control the number of simulated peers and `--duration` to adjust the test window.

## Output schema

```json
{
  "scenario": "webtorrent",
  "timestamp": "2025-01-08T00:00:00.000Z",
  "peers": 5,
  "fallbackAttempts": 42,
  "fallbackSuccess": 39,
  "p95FallbackLatencyMs": 380,
  "transport": "webtorrent"
}
```

The harness writes reports under `ops/benchmarks/p2p/results/` (created on demand).
