# RFC: GUN overlay integration

## Background

The resilience roadmap calls for a GUN.js overlay to provide signaling relay, state gossip, and persistence when direct
WebRTC channels cannot form. This RFC documents the client-side integration for the first phase.

## Objectives

* Allow the P2P manager to send chunk protocol messages through a GUN graph when PeerJS is unavailable.
* Maintain compatibility with the existing replication orchestrator and diagnostics.
* Surface telemetry for operators so they can observe when the overlay is active.

## Implementation summary

* Adapter: `src/lib/p2p/transports/gunAdapter.ts`
  * Dynamically imports `gun`, falling back to a `BroadcastChannel` shim when the library is absent.
  * Emits transport state updates (`idle`, `ready`, `active`, `degraded`, `error`) consumed by the manager.
  * Uses `graphKey = swarm-space/chunks` by default; messages are deduplicated via `id` to avoid replay loops.
* Manager updates: `src/lib/p2p/manager.ts`
  * Registers the adapter when `featureFlags.gunTransport` is true.
  * Records fallback telemetry in `stats.transportFallbacks` and appends to `stats.transports`.
  * Shares the same chunk protocol bridge as PeerJS, preserving replication semantics.
* Dashboard updates: `NodeStatusOverview` and `P2PDebugPanel` render status badges, peer counts, and recent fallback events.

## Feature flag control

* Build-time: `VITE_FEATURE_GUN=true`.
* Runtime: `updateFeatureFlags({ gunTransport: true })`.
* Flags can be toggled without a page reload because the manager subscribes to `subscribeToFeatureFlags`.

## Data flow

1. `ChunkProtocol` calls the manager’s `sendChunkThroughTransports` helper.
2. PeerJS send fails → manager routes to `GunAdapter.send`.
3. Adapter writes an envelope `{ id, type, payload, from, target }` to the configured graph.
4. Remote adapter observes the update, deduplicates by `id`, and forwards to `P2PManager.handleAlternateChunkMessage`.
5. The manager forwards the payload to `ChunkProtocol.handleMessage`, keeping replication intact.

## Security considerations

* The adapter disables GUN persistence (`localStorage: false`, `radisk: false`) to avoid leaking payloads to disk.
* Messages contain no plaintext chunk data—only protocol-level envelopes.
* Feature flags can disable the overlay instantly, causing the manager to tear down the adapter and zero its counters.

## Telemetry

* `stats.transportFallbacks` counts all fallback events across transports.
* Each transport entry captures `state`, `fallbackCount`, `lastFallbackAt`, and `lastError` for debugging.
* Dashboard badges highlight degraded/error states so operators can pivot into diagnostics.

## Follow-up work

* Add peer auth metadata once the overlay carries signaling offers/answers.
* Implement pruning of stale graph entries to avoid unbounded growth.
* Capture per-transport latency metrics (time from fallback to successful chunk delivery) and expose them via the dashboard.
