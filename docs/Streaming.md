# WebRTC Audio/Video Streaming

Swarm Space supports ephemeral audio and video rooms that can be created from a profile feed or from inside a collaborative project. Streams can be broadcast as posts on the originating channel, left invite-only, or run as private calls. Rooms support moderation actions (ban, mute) and the media pipeline streams encrypted chunks through the project or creator node mesh.

## Media Topology & Bandwidth Model

### Topology Decision

Swarm Space uses a **pure peer-to-peer (mesh) topology** for real-time audio/video. Every participant maintains WebRTC transports directly with the other active peers in the room. Stable desktop nodes _can_ opt in to pin TURN media relaying for mobile or bandwidth-constrained members, but they never perform server-side mixing or forwarding logic (no SFU/MCU role). This keeps the media layer aligned with the project’s offline-first, community-hosted ethos and allows rooms to continue even when rendezvous infrastructure is unreachable.

```
Participant A ─────┐      ┌───── Participant C
        ╲          │      │          ╱
         ╲         │      │         ╱
          ╲        ▼      ▼        ╱
          Participant B ◀───▶ Participant D
```

- **Mesh fan-out:** each peer publishes a single outbound audio/video stream per enabled track and receives N-1 remote streams.
- **TURN assist:** when a peer cannot achieve direct NAT traversal it relays packets through the closest community TURN node; the stream is still end-to-end encrypted, and the relay never decrypts or mixes.

### Bandwidth Considerations

| Scenario | Uplink per peer | Downlink per peer | Notes |
| --- | --- | --- | --- |
| Audio only (Opus @ 32 kbps) | ~45 kbps × (N-1) | ~45 kbps × (N-1) | Headroom includes SRTP + DTLS overhead. |
| 720p video + audio | ~1.8 Mbps × (N-1) | ~1.8 Mbps × (N-1) | Adaptive bitrate scales per-connection using WebRTC simulcast. |
| Mixed devices w/ TURN | Uplink unchanged; TURN bears ~1.05× relay overhead | Downlink unchanged | TURN usage capped per room; alerts fire when relays exceed 70% utilization. |

Rooms targeting more than 6 simultaneous video publishers are encouraged to schedule a stable node as a voluntary relay for downstream copies (participants subscribe to the relay’s copy instead of N-1 originals), but that relay still consumes and re-publishes encrypted tracks like any other peer. This keeps the system SFU-free while providing a path to reduce aggregate uplink pressure for large broadcasts.

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

## Key Exchange, Encryption, and Access Control

### Session Establishment

- During the `POST /rooms/{roomId}/join` workflow, the server signs a short-lived `meshTicket` that binds the caller’s user identity, room ID, and expiration window. Clients include the ticket in WebRTC offers so peers can verify participation without contacting the server once the room is live.
- Peers execute the existing swarm handshake (`docs/Private-Key.md`) to exchange Ed25519 identities, derive an ephemeral ECDH secret, and attest the invite metadata before accepting media streams. Nodes reject connections whose tickets have expired or whose signature chains fail validation.

### Transport Security

- **DTLS-SRTP:** All WebRTC transports negotiate DTLS-SRTP; media packets are encrypted hop-to-hop even when relayed through TURN. DTLS handshakes incorporate the swarm-derived fingerprints so peers can pin each other’s identity keys. 【F:docs/ARCHITECTURE.md†L12-L39】【F:docs/Private-Key.md†L54-L120】
- **Insertable Streams (optional E2EE):** Rooms marked “private” enable WebRTC insertable streams. Clients inject an additional AES-GCM layer using the shared session secret derived during handshake. This shields media from TURN relays and browser extensions that only see SRTP payloads.
- **Data channel control plane:** Moderation messages, heartbeat signatures, and mesh gossip continue to use the encrypted WebRTC data channel governed by the same DTLS session.

### Access Control for Invite-Only Rooms

1. Invitation tokens issued via REST encode `{ roomId, scope, expiresAt }` and are signed by the signaling service.
2. Upon join, the server validates the token and emits a `meshTicket` plus the peer roster filtered to allowed scopes (host, speaker, listener).
3. Peers validate tickets on receipt; unauthorized offers are dropped and the offending peer is quarantined via a signed moderation notice distributed over the mesh gossip bus.
4. Hosts can revoke a ticket; the revocation propagates as a signed delta that causes peers to tear down the DTLS session automatically.

This layered model ensures only invited participants receive decryption material while keeping enforcement decentralized after the initial join.

## Media Storage, Replication, and Integrity

- **Ephemeral default:** Live rooms stream media ephemerally; no chunks persist after the transports close unless the host toggles recording.
- **Optional recording pipeline:** When recording is enabled, the host’s browser writes SRTP frames to the local chunk store (64 KB AES-GCM encrypted slices) and publishes chunk manifests into the mesh just like file uploads. 【F:docs/ARCHITECTURE.md†L12-L104】
- **Replication:** The chunk manifests include a redundancy factor (default RF=3). The `replication` worker asks the closest peers (XOR distance) to cache encrypted chunks, rebalancing when peers leave. 【F:docs/P2P_SWARM_STABILIZATION_PLAN.md†L300-L367】
- **Integrity validation:** Each stored chunk is addressed by its SHA-256 hash; peers recompute the hash before accepting or replaying a chunk. Manifests contain signed vector clocks so history replays can detect tampering. 【F:docs/ARCHITECTURE.md†L12-L104】【F:docs/P2P_RENDEZVOUS_MESH_PLAN.md†L1-L104】
- **Post-playback retrieval:** When a participant replays a recorded session, their client requests the manifest from the mesh, downloads the encrypted chunks from any replica that still advertises them, verifies the hashes, and decrypts locally using the room’s recording key derived from the host’s private identity.

This approach keeps recordings optional, strongly encrypted, and resilient to peer churn while providing verifiable integrity for post-playback.

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

### Base Starter Needs

- Users should be able to create an audio/video chat on thier profile page and inside projects thats others can join and stream it to thier profile or project feed.

- Can start and hold audio/video chat without steaming.
- Can set audio/video room to invite only
- Can ban, mute channels in audio video
- Stream plays on channel as a post.

Placement: 
Start a audio/video chat from the post creartion box on your profile page or project page.

Stream: Once you have started the audio/video chat you can stream it as a post to your channel or project page depending on where you began the audio/video chat.

Streams are served live using encypted chunks via the projects or creators node mesh.
