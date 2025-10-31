# PeerJS Signaling Operations Guide

This guide captures the steps required to point Imagination Network at a self-hosted PeerJS deployment and to verify the connection in production-like environments.

## 1. Provide endpoint configuration

Set the desired endpoints as Vite environment variables before running `npm run dev` or `npm run build`:

```bash
# Basic single-endpoint override
VITE_PEERJS_HOST=peerjs.internal.example
VITE_PEERJS_PORT=443
VITE_PEERJS_SECURE=true
VITE_PEERJS_PATH=/swarm

# Advanced priority list (first healthy endpoint wins)
VITE_PEERJS_ENDPOINTS='[
  { "id": "primary", "label": "fra1", "host": "peer-fra1.example", "port": 443, "secure": true },
  { "id": "backup", "label": "iad1", "host": "peer-iad1.example", "port": 9000, "secure": false, "path": "/signal" }
]'
```

Optional extras:

- `VITE_PEERJS_ICE_SERVERS` – JSON array forwarded to `RTCPeerConnection` (STUN/TURN credentials).
- `VITE_PEERJS_ATTEMPTS_PER_ENDPOINT` – Number of connection attempts before falling back (default: `3`).

## 2. Deploy TURN/STUN credentials (optional)

If you manage TURN servers, export them via `VITE_PEERJS_ICE_SERVERS`. Each entry should match the [`RTCIceServer`](https://developer.mozilla.org/en-US/docs/Web/API/RTCIceServer) shape. Example:

```bash
VITE_PEERJS_ICE_SERVERS='[
  { "urls": "stun:stun1.example.com:3478" },
  { "urls": ["turn:turn1.example.com:3478"], "username": "turn-user", "credential": "secret" }
]'
```

## 3. Runtime verification checklist

1. Enable P2P from the navigation bar.
2. Open the P2P status popover and confirm the **Signaling Endpoint** section lists the expected host and protocol (`wss` or `ws`).
3. Open DevTools → Application → Local Storage and ensure `p2p-signaling-endpoint-id` contains the successful endpoint ID.
4. Check the diagnostics panel (bottom of the popover) for `signaling-endpoint-selected` and `init-success` entries referencing the expected host.

## 4. Smoke test rotation

When rotating hosts or performing failover drills:

1. Set `VITE_PEERJS_ENDPOINTS` with both the new primary and the old host.
2. Clear the `p2p-signaling-endpoint-id` key in local storage to force re-selection.
3. Reload, enable P2P, and confirm diagnostics first log `init-attempt` for the primary host and then `endpoint-exhausted` if it is intentionally offline before selecting the fallback.
4. Once the new host is stable, allow the automatic persistence to prefer it on subsequent sessions.

## 5. Rollback

Unset the custom variables (or restore the previous JSON array) and reload. The adapter automatically falls back to PeerJS Cloud when no overrides are supplied.
