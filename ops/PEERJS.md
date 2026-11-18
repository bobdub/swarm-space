# PeerJS Signaling Operations Guide

This guide captures the steps required to point Imagination Network at a self-hosted PeerJS deployment and to verify the connection in production-like environments.

## 0. Local PeerServer for development and CI

PeerJS Cloud (`0.peerjs.com`) is shared and throttles sockets, which makes local meshes and two-peer checks flaky. Run your own PeerServer next to the dev server instead. `scripts/local-peer-server.mjs` fetches the `peer` package on demand (pinned, via `bunx`, or `npx` when Bun is missing), so it adds nothing to the app's dependencies.

| Command | What it does |
| --- | --- |
| `bun run dev:mesh` | Starts a PeerServer on `ws://127.0.0.1:9000/` and then Vite with `VITE_PEERJS_HOST=127.0.0.1`, `VITE_PEERJS_PORT=9000`, `VITE_PEERJS_SECURE=false`, `VITE_PEERJS_PATH=/`. Extra args go to Vite (`bun run dev:mesh --host 127.0.0.1`). |
| `bun run peer:server` | PeerServer only. Pair it with a `.env.development.local` copied from `.env.example` and plain `bun run dev`. |
| `bun run peer:smoke` | Starts a PeerServer, registers two peers, relays an OFFER from one to the other, and exits 0 on success. A fast CI check that signaling works. |
| `bun run peer:with -- <command>` | Starts a PeerServer, runs `<command>` with the `VITE_PEERJS_*` variables exported, and exits with its code. For CI: `bun run peer:with -- bun run build` or a browser test runner. |

Overrides: `PEERJS_LOCAL_PORT` (default `9000`), `PEERJS_LOCAL_BIND` (default `127.0.0.1`; set `0.0.0.0` to reach it from a phone or another machine on your LAN, then set `PEERJS_LOCAL_HOST` to this machine's LAN IP so browsers dial the right address).

Notes:

- Every peer in a test must use the same server. Signaling servers do not share peer registries, so a tab on the local server cannot find a tab on PeerJS Cloud.
- PeerJS Cloud stays last in the endpoint list, so if the local server is down the app still fails over to it. Stop the app or watch the P2P status popover if you need to be sure a run stayed local.
- The Swarm Mesh and the room-discovery beacons both use the configured server. Test Mode (`testMode.standalone.ts`) is marked foundational and still dials PeerJS Cloud directly.
- Production builds are unchanged: with no `VITE_PEERJS_*` set, everything uses PeerJS Cloud as before.

GitHub Actions example step:

```yaml
- uses: oven-sh/setup-bun@v2
- run: bun install
- run: bun run peer:smoke
- run: bun run peer:with -- bun run build
```

## 1. Provide endpoint configuration

Set the desired endpoints as Vite environment variables before running `bun run dev` or `bun run build` (or copy `.env.example` to `.env.development.local`):

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
