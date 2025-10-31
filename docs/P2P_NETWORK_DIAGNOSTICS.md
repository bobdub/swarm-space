# P2P Network Diagnostics

The P2P stack now exposes live metrics and diagnostics so operators can quickly identify networking regressions. This guide
covers the new counters emitted by the `NodeMetricsTracker`, how they surface in the UI, and the recommended workflows for triage.

## Live Telemetry Snapshots

`P2PManager.getStats()` now publishes a `metrics` snapshot that includes both legacy fields (bytes transferred, relay counts) and
new counters:

| Counter | Description | Typical Remedy |
|---------|-------------|----------------|
| `connectionAttempts` | Total outbound connection dials initiated by the local node. | Verify auto-connect controls and bootstrap inventory. |
| `failedConnectionAttempts` | Attempts that timed out or errored before the data channel opened. | Inspect signaling reachability, TURN/STUN configuration, or remote peer availability. |
| `successfulConnections` | Connections that reached the PeerJS `open` event. | Baseline for measuring failure ratios. |
| `rendezvousAttempts` | Beacon + capsule fetches executed during rendezvous refreshes. | Ensure discovery cadence is expected (roughly every refresh interval). |
| `rendezvousSuccesses` | Fetches that returned at least one valid peer payload. | If consistently zero, review beacon endpoints and signatures. |
| `rendezvousFailures` | Failed or aborted rendezvous requests. | Check diagnostics for per-endpoint errors and raise incidents when streaks climb. |

Additional derived metrics in `P2PStats`:

- `timeToFirstPeerMs` — milliseconds from manager start until the first peer connection completed. Values over 30s warrant a
  review of bootstrapping sources.
- `lastBeaconLatencyMs` — duration of the latest successful beacon fetch. Latencies beyond 10s are treated as degraded.
- `rendezvousFailureStreak` — consecutive rendezvous cycles without success. When this matches the configured failure threshold,
  the mesh automatically disables rendezvous and falls back to bootstrap peers.

## Mesh Health Indicators

### P2P Status Indicator

The header status popover now highlights degraded states:

- A 🔺 icon replaces the Wi-Fi indicator when connection failures exceed 40%, the beacon latency is above 10 seconds, or the
  rendezvous failure streak is non-zero.
- Inline badges display connection failure rate, beacon latency, and rendezvous success percentage.
- The status dot inside the popover includes a "Health degraded" annotation during incident conditions.

Operators should capture a screenshot of this popover when escalating networking incidents—it now summarizes all relevant ratios.

### Connected Peers Panel

The connected peers card surfaces the same metrics alongside peer presence:

- Time-to-first-peer and beacon latency help distinguish bootstrap problems from beacon slowness.
- A destructive "Degraded" badge appears when thresholds are exceeded, accompanied by remediation guidance.

## P2P Debug Panel

`src/components/p2p/P2PDebugPanel.tsx` provides a dedicated diagnostics view:

- **Telemetry history** records the last 12 stats snapshots, flagging entries that were degraded when sampled.
- **Diagnostics filters** allow level (`info`, `warn`, `error`) and source scoping (`manager`, `peerjs`, `rendezvous`, etc.).
- **Reset history** clears local telemetry samples, while **Clear diagnostics** drops buffered events from the global
  `diagnosticsStore`.

Embed the debug panel in operator dashboards or developer tooling to monitor trends during deployments.

## Troubleshooting Workflow

1. **Check mesh health badges** — If degraded, capture connection failure percentage and beacon latency.
2. **Inspect diagnostics feed** — Filter to the relevant source (`peerjs` for handshake failures, `rendezvous` for beacon issues,
   `manager` for control-state blocks).
3. **Correlate telemetry samples** — Use the history timeline to determine when failures began and whether peers were still
   connecting.
4. **Escalate with context** — Share the latest telemetry entry, failure ratios, and any rendezvous streaks when filing incident
   reports.

Maintaining these snapshots enables faster post-mortems and reduces the need to scrape console logs when reproducing issues.
