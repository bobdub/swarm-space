# WebRTC Audio/Video Streaming

Swarm Space supports ephemeral audio and video rooms that can be created from a profile feed or from inside a collaborative project. Streams can be broadcast as posts on the originating channel, left invite-only, or run as private calls. Rooms support moderation actions (ban, mute) and the media pipeline streams encrypted chunks through the project or creator node mesh.

## Entry Points and Signaling Service API

The signaling layer exposes a small REST surface for room lifecycle operations and a persistent WebSocket for real-time signaling payloads and presence updates.

### REST endpoints

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/signaling/rooms` | Creates a new room or rehydrates a soft-deleted one. Requires an authenticated session token. Returns the `roomId`, creator peer ID, and short-lived invitation secrets. |
| `POST` | `/api/signaling/rooms/{roomId}/join` | Validates that the caller can enter the room (invitation token or host approval) and issues WebRTC bootstrap metadata (peer IDs, TURN hints). |
| `POST` | `/api/signaling/rooms/{roomId}/invitations` | Allows hosts or co-hosts to mint additional invitations or revoke existing ones. Responses include invitation state snapshots so UIs can stay in sync. |
| `GET` | `/api/signaling/rooms/{roomId}/participants` | Returns a cached participant roster with audio/video mute states, moderator flags, and the last heartbeat timestamp for each peer. Used to rebuild UI state on refresh. |
| `DELETE` | `/api/signaling/rooms/{roomId}` | Closes a room explicitly. Marks the room as drained so the mesh prunes the metadata immediately instead of waiting for TTL expiry. |

All REST endpoints accept and return JSON. Errors follow the problem+json schema with machine-readable `code` fields such as `room-not-found`, `invite-required`, or `room-closed`.

### WebSocket endpoint

* **URL:** `wss://<signaling-host>/ws`
* **Handshake:**
  1. Client opens the WebSocket and immediately sends `{ "type": "authenticate", "token": "<JWT>" }` using the same user session token used for REST requests.
  2. The server replies with `{ "type": "authenticated", "userId": "...", "scopes": [...] }` or `{ "type": "error", "code": "auth-failed" }`.
  3. Once authenticated, the client may send room commands and WebRTC signaling messages.

#### Core message types

| Direction | Type | Payload |
| --- | --- | --- |
| Client → Server | `room:create` | `{ roomId?, projectId?, visibility, invitees[] }` — create or upgrade a room. If `roomId` provided, request re-open. |
| Client → Server | `room:join` | `{ roomId, invitationToken? }` — joins the requested room. |
| Client ↔ Server | `signal:offer` / `signal:answer` / `signal:candidate` | Standard WebRTC SDP/ICE envelopes routed to target peer IDs. |
| Server → Client | `room:update` | `{ roomId, participants, invites }` — broadcast whenever metadata changes. |
| Server → Client | `room:ended` | `{ roomId, reason }` — indicates the room has closed and all transports should be released. |
| Client ↔ Server | `heartbeat` | `{ roomId, peerId, ts }` — client pings every 20 seconds; server echoes to confirm liveness. |

Unrecognised types are rejected with `{ "type": "error", "code": "unsupported-message" }` and rate limits (50 messages / 10 seconds) protect the relay.

## Authentication, Room Creation, and Join Flow

1. **User authentication** – UI requests a short-lived JWT via the existing account session API. The token scope includes `stream:create` and/or `stream:join` capabilities.
2. **Room creation (profile or project)**
   - Client calls `POST /api/signaling/rooms` with `{ context: "profile" | "project", visibility, title }`.
   - Service allocates a `roomId`, stores creator metadata in the rendezvous mesh, and returns invitation tokens plus TURN credentials scoped to the room.
   - Client optionally promotes the room to a channel post by calling the existing post creation endpoint with `streamRoomId` for cross-linking.
3. **Invitation management**
   - Host uses `POST /api/signaling/rooms/{roomId}/invitations` to create named invites (`{ handle, role, expiresAt }`). Revoking an invite triggers a `room:update` push.
4. **Joining**
   - Invitees or public users call `POST /api/signaling/rooms/{roomId}/join` with a valid invitation token (or none for public rooms).
   - Server validates capacity/moderation policies and, on success, returns the peer bootstrap bundle (`peerId`, `roomId`, `meshTicket`, STUN/TURN list).
   - Client opens the WebSocket, sends `room:join`, and begins exchanging SDP/ICE via `signal:*` messages.
5. **Moderation actions** (ban, mute) are REST-driven (`PATCH /participants/{peerId}`) but mirrored into the WebSocket `room:update` payload so UIs reconcile instantly.

## Session Metadata Storage and Propagation

Room metadata lives in the existing node mesh that powers peer discovery:

- **Authoritative store:** the rendezvous beacon Durable Object keeps an in-memory map keyed by `roomId` with the current participant roster, invitation hashes, and last heartbeat per peer. Entries expire automatically 90 seconds after the final heartbeat unless explicitly closed.
- **Replication:** every signaling node publishes `room-metadata` diffs onto the mesh gossip channel carried over the WebRTC data mesh. Messages are CRDT-style patches `{ roomId, version, delta }` so peers can merge without conflicts.
- **Edge caching:** regional nodes persist a copy of active room descriptors in Redis (TTL 5 minutes) to accelerate cold starts and allow HTTP endpoints to respond without blocking on the Durable Object.
- **Client hydration:** when a browser reconnects it receives the latest metadata snapshot from REST (`GET /participants`) and then streams incremental updates via WebSocket `room:update` broadcasts sourced from gossip events.

This hybrid approach ensures that no single region or node failure loses invitation state, while keeping the metadata lightweight and ephemeral.

## Reconnection, Heartbeats, and Room Lifecycle

- **Heartbeats:** clients send a `heartbeat` message every 20 seconds per active room. Signaling nodes mark the peer as alive and broadcast the refreshed timestamp. Missing 3 consecutive heartbeats (≈60 seconds) transitions the peer to a `suspect` state; if no WebRTC data arrives for another 30 seconds the peer is removed.
- **Graceful reconnection:**
  - When the WebSocket closes unexpectedly, the client immediately retries using exponential backoff capped at 30 seconds while continuing any direct peer connections already negotiated.
  - On reconnect, the client replays `room:join` with its last `meshTicket`. If the room is still live, the server restores participant state and resends outstanding invitations. If the room expired during the outage the client receives `room:ended`.
  - WebRTC transports that survived are retained; otherwise renegotiation occurs using cached SDP.
- **Room closure:**
  - If all peers are absent for 90 seconds (no heartbeats and no pending invites), the Durable Object marks the room as closed and publishes a `room:ended` event across the mesh. Redis cache entries drop immediately.
  - Hosts can close rooms manually (`DELETE /rooms/{roomId}`); the server notifies all connected peers, flushes metadata, and prevents further joins.
  - When a room is promoted to a recorded stream, the closure routine also triggers archival workflows for captured media while leaving the signaling metadata cleared.

These rules keep rooms active while participants are present, support resilient reconnections during transient network loss, and ensure abandoned rooms are pruned promptly so the mesh remains healthy.
