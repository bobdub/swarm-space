# P2P Networking Diagnostics Guide

The peer-to-peer stack now streams rich diagnostic events that make it easier
to understand why a node is failing to join the mesh, which timeouts are
triggering, and what the underlying PeerJS adapter is experiencing.

## Where diagnostics originate

Events are emitted from multiple layers of the networking stack:

- **`useP2P` hook** – lifecycle actions such as enable/disable requests,
  environment pre-flight checks, and fatal errors are recorded so UI surfaces
  can show contextual feedback to the user.
- **Manager layer** – startup, shutdown, rendezvous mesh initialisation and
  connection gating decisions emit events to capture when discovery is being
  skipped or peers are blocked by controls.
- **PeerJS adapter** – reports initialisation attempts, handshake timeouts,
  connection errors and listAllPeers diagnostics to highlight signaling or
  NAT issues.
- **Chunk protocol** – chunk and manifest requests now log send failures,
  verification problems, and timeout escalations to pinpoint stalled content
  transfers.
- **Connection health monitor** – marks when connections degrade or go stale
  so that reconnect logic and UI warnings can be correlated with measured
  inactivity windows.

All of these events are funneled through a lightweight event bus exported by
`src/lib/p2p/diagnostics.ts`.

## Capturing diagnostics in React

The `useP2P` hook exposes two new fields:

- `diagnostics` – an ordered array of the most recent diagnostic events.
- `clearDiagnostics()` – wipes the current buffer (the next action will start
  the stream anew).

Every event contains:

| Field | Description |
| ----- | ----------- |
| `id` | Unique identifier (timestamp + sequence). |
| `timestamp` | Epoch milliseconds when the event was recorded. |
| `level` | `info`, `warn`, or `error`. |
| `source` | Component emitting the event (`peerjs`, `manager`, `chunk-protocol`, etc.). |
| `code` | Short machine-readable identifier (e.g., `handshake-timeout`). |
| `message` | Human-readable explanation. |
| `context` | Optional structured metadata (peer ID, chunk hash, retry count, ...). |

To render a debug panel you can consume the hook directly:

```tsx
const {
  diagnostics,
  clearDiagnostics,
} = useP2P();

return (
  <aside>
    <button onClick={clearDiagnostics}>Clear</button>
    <ul>
      {diagnostics.map((event) => (
        <li key={event.id}>
          <strong>[{event.level}] {event.code}</strong>
          <div>{event.message}</div>
          {event.context ? <pre>{JSON.stringify(event.context, null, 2)}</pre> : null}
        </li>
      ))}
    </ul>
  </aside>
);
```

## Debugging workflow

1. **Clear the buffer** (`clearDiagnostics()`) before attempting a connection
   to focus on the latest session.
2. **Trigger the action** (e.g., enable P2P) and observe the ordered stream of
   events. Timeouts from the PeerJS adapter are interleaved with connection
   health updates and chunk protocol retries, making causal chains visible.
3. **Review context payloads** – look for repeated `handshake-timeout`
   entries for the same peer, or `manifest-request-timeout` sequences to spot
   unresponsive nodes.
4. **Adjust controls** (pause, isolation, manual accept) and confirm the
   manager reports `connect-auto-suppressed` or related signals when
   connections are intentionally blocked.

The diagnostics buffer keeps the latest 200 events, striking a balance between
retaining history and preventing runaway growth during long sessions.

