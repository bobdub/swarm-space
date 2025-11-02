# Threat model: alternate P2P transports

## Context

WebTorrent and GUN overlays introduce new network surfaces beyond the baseline PeerJS data channels described in `content-authenticity.md`. They are guarded by feature flags and are currently opt-in experiments.

### Assets

* Integrity of replicated chunks and manifests.
* Privacy of user-generated content.
* Availability of the mesh during rendezvous outages.

### Adversaries

* **Passive observer:** Can join the swarm or overlay and capture metadata.
* **Active manipulator:** Injects forged envelopes or replays stale data to poison replication.
* **Flooder:** Spams fallback channels to exhaust bandwidth or storage quotas.

## Attack surface

| Surface | Vector | Impact | Existing controls | Residual risk |
| --- | --- | --- | --- | --- |
| WebTorrent BroadcastChannel fallback | Same-origin script injects forged messages | Replication of malicious payload metadata | Manifest/chunk signatures are still verified before storage. Diagnostic logging surfaces anomalous fallback usage. | If a malicious extension runs in the same origin it can already tamper with local storage. |
| WebTorrent extension frames | Peers that do not understand the `swarm-space` extension drop frames silently | Delayed fallback, possible repeated attempts | Manager marks transport as `degraded` and continues to next fallback. | No authenticity leak; only availability hit. |
| GUN overlay graph | Replay of old envelopes or injection of bogus IDs | Replay could trigger redundant chunk requests | Adapter deduplicates messages via `id` and chunk protocol verifies signatures. | Without message authentication the overlay can be used for metadata enumeration (peer IDs). |
| Fallback telemetry | Diagnostics reveal transport states | Operator visibility only; no end-user exposure | Stats surfaced locally via dashboard. | None. |

## Mitigations & recommendations

1. **Signature checks remain mandatory** – replication continues to verify manifests and posts before storage regardless of transport.
2. **Telemetry alerts** – the manager emits `transport-fallback` diagnostics. Operators should alert on unexpected spikes once telemetry is wired into ops pipelines.
3. **Optional message signing** – when the overlay starts carrying signaling offers/answers, add Ed25519 signatures to envelopes to prevent tampering.
4. **Rate limiting** – benchmark scripts simulate flood conditions so we can size client-side debounce logic before promoting the feature.

## Monitoring

* Dashboard exposes transport states, fallback counts, and last error messages.
* Benchmark harness (`ops/benchmarks/p2p/`) records throughput under forced fallbacks and can be extended to emit synthetic alerts.

## Outstanding tasks

* Evaluate CSP/Trusted Types policies for the BroadcastChannel fallback to ensure only the bundled code can toggle the feature.
* Once WebTorrent extension messaging is implemented, audit extension handshake metadata for PII leaks.
* Decide on per-message authentication for GUN if it graduates from experiment to production.
