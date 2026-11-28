# Gun.js in the Swarm Mesh

Gun.js is a coordination graph, not a store for media or bulk data (`localStorage: false`, `radisk: false`). It runs beside WebRTC/PeerJS and does three jobs, plus one operating rule.

```text
Application (Brain, Chat, Feeds, Calls, Profiles)
        |                               |
 Direct P2P data + media        Discovery + fallback setup
        |                               |
 WebRTC / PeerJS mesh            Gun.js graph overlay
 - data channels                 - Global Cell presence
 - audio/video (RTP)             - room graph adjacency
 - ledger sync                   - stalled-dial relay inbox
```

## 1. Auto-connect beacons for new users

`src/lib/p2p/globalCell.ts`, `src/lib/p2p/transports/gunAdapter.ts`

- Each beacon is written to its own soul (`<graphKey>/<slot>`) and linked into the parent graph. A plain `graph.get(slot).put(envelope)` did not reach subscribers.
- Invite knocks use their own slot (`inviteKnockSlot(from, to)`) so presence heartbeats never overwrite them.
- Knock-back: a node that sees an unknown peer in `recordPresence` pulses its own beacon at once.
- Helpers on duty (`isHelperOnDuty`) dial isolated newcomers after a short grace.

## 2. Router hairpinning between devices on the same network

`src/lib/p2p/meshRelayLink.ts`, `meshRelayPolicy.ts`, `stalledDials.ts`

- Many routers do not loop traffic back to their own public IP, and browsers hide LAN host candidates, so two devices on one Wi-Fi can fail to connect directly.
- A new dial stalled for `DIAL_STALL_MS` (8 s) gets a per-peer Gun relay at `swarm-space/mesh-relay/<targetPeerId>`.
- Only lightweight traffic (chat, presence, profiles, post announcements) uses it. The direct dial keeps trying and the relay drops once a data channel opens. Open connections are never touched.
- Audio and video never cross Gun.

## 3. Audio/video room graph (no "out of loop" users)

`src/lib/streaming/roomGraph.ts`

- Four users need six direct links. If peers form a line (A-B-C-D), an edge user can miss call setup.
- Members heartbeat `swarm-space/rooms/<roomId>/peers/<peerId>` (30 s TTL), so everyone sees the full room.
- The lower mesh ID dials any member it has no call with, avoiding glare.
- A pair with no open data channel also sends setup strings (offer, answer, candidate, with `mid`) to `swarm-space/rooms/<roomId>/inbox/<peerId>`. Media then flows directly over WebRTC.
- Tests inject a mock transport via `setRoomGraphTransportFactory`.

## 4. Bot protection: Cloudflare "failures" are usually false

- Relays such as `relay.peer.ooo` sit behind Cloudflare. Datacenter probes (curl, CI, sandbox scripts) often get 403 challenges; real browsers pass.
- Removing `relay.peer.ooo` on that basis broke presence and invite knocks before. Never prune it from a datacenter probe.
- `GunAdapter` must use the browser's native `WebSocket`. Wrapping it in backoff proxies broke Gun's wire loop and silenced beacons.

## Boundaries

- Gun carries discovery, presence and setup strings only, never media or bulk payloads.
- Manual and bus dials follow the existing backoff and dial-budget rules in `src/lib/p2p/AGENTS.md`.
