# P2P Rendezvous Mesh Plan

## 1. Why the Previous Plan Failed
- **Dependency Removed:** The PeerJS Cloud team has permanently disabled the public `listAllPeers()` endpoint. The original swarm strategy depended on this call to gather the initial peer set, so the bootstrap phase now returns an empty list.
- **Operational Impact:** New devices stall at “searching for peers,” stable nodes cannot grow the swarm, and background reconnection loops spin without ever discovering fresh peers.
- **Takeaway:** We need a discovery layer that we control, operates within browser constraints, and preserves the offline-first, privacy-preserving ethos of the project.

## 2. Goals for the Replacement Strategy
1. **Autonomous Discovery:** Nodes must regain the ability to find peers without manual ID exchange.
2. **Resilience:** Loss of any single rendezvous source should not partition the network.
3. **Low Overhead:** Keep infrastructure simple enough for community hosting (edge workers / static hosting) with open-source tooling.
4. **Privacy:** No plaintext metadata beyond what is already exposed through PeerJS signaling. All announcements are signed and expire quickly.

## 3. Proposed Architecture Overview
```
┌────────────────────────────────────────────────────────────────┐
│ Browser Client                                                  │
│ 1. Load cached peers from IndexedDB                             │
│ 2. Query Rendezvous Beacons (HTTP)                              │
│ 3. Query Static Peer Capsules (public JSON bundle)              │
│ 4. Connect via PeerJS + continue PEX/Gossip                     │
└────────────────────────────────────────────────────────────────┘
                     ▲                     ▲
                     │                     │
      ┌──────────────┴──────────────┐ ┌────┴──────────────────────┐
      │ Edge Rendezvous Beacons     │ │ Static Peer Capsules      │
      │ (Durable Object/WebSocket)  │ │ (Git, IPFS, CDN)          │
      │ - Accept signed presence    │ │ - Rotating peer snapshots │
      │ - Return freshest peer set  │ │ - Published by maintainers│
      └─────────────────────────────┘ └───────────────────────────┘
```

### Components
- **Edge Rendezvous Beacons** (`services/rendezvous-beacon`): A tiny Cloudflare Worker (or similar) storing ~200 recent presence tickets per community. Nodes `POST /announce` their PeerJS ID + signature, receive a curated peer list via `GET /peers`.
- **Static Peer Capsules** (`ops/scripts/publish-capsule.ts`): Signed JSON bundles hosted on GitHub Pages, S3, or IPFS. Each capsule contains ≥20 recently verified peers and rotates every 5 minutes. Browsers fetch multiple capsules from different hosts to avoid single points of failure.
- **Stable Nodes** (`docs/Stable-Node.md`): Encouraged to publish their availability via both channels, ensuring long-lived peers stay discoverable.

## 4. Protocol Flow
1. **Local Warm Start**
   - Use existing bootstrap registry (`src/lib/p2p/bootstrap.ts`) to attempt cached peers first.
2. **Beacon Announce**
   - Client generates a signed presence ticket `{ peerId, userId, ttl, signature }` using the device’s Ed25519 identity key.
   - `POST /announce` to each configured beacon. Beacons validate signature, store ticket in Durable Object with TTL (default 3 minutes), and reply with `peers: PresenceTicket[]` prioritised by freshness.
3. **Capsule Fetch**
   - In parallel, fetch static JSON capsules (e.g., `https://capsule1.swarm.space/peers.json`). Capsules are signed by maintainers; the client verifies signatures using a baked-in public key set.
4. **Connect + Gossip**
   - Merge beacon and capsule results, de-duplicate against cached peers, then initiate PeerJS connections as before. Once a handful of peers are connected, the existing PEX and gossip layers disseminate fresh entries as usual.
5. **Self-Healing**
   - Every minute the client re-announces if it remains online, refreshes beacon/capsule lists when fewer than `MIN_ACTIVE_PEERS` are connected, and prunes expired tickets from the bootstrap registry.

## 5. Security & Privacy Considerations
- **Signed Presence:** Prevents malicious actors from injecting arbitrary peer IDs. Announcements without a valid device signature are rejected.
- **Minimal Metadata:** Beacons store only `{peerId, signature, expiresAt}`. User handles remain peer-to-peer only.
- **Rate Limits:** Beacons enforce 1 announcement per peer per 45 seconds and cap list responses to 50 entries. Durable Objects handle per-IP throttling automatically.
- **Transport Security:** All beacon endpoints require HTTPS with HSTS. Capsules are fetched over HTTPS and verified via detached Ed25519 signatures before use.

## 6. Implementation Plan
### Phase A – Foundations (1-2 days)
- [x] Add `src/lib/p2p/presenceTicket.ts` for ticket creation and signature verification.
- [x] Extend `src/lib/p2p/bootstrap.ts` with fetch helpers for beacons and capsules.
- [x] Ship feature flags in `src/contexts/P2PContext.tsx` to toggle the rendezvous mesh.

### Phase B – Edge Beacon Service (2-3 days)
- [x] Scaffold Cloudflare Worker at `services/rendezvous-beacon/index.ts` with Durable Object storage.
- [x] Implement `/announce` and `/peers` handlers plus signature validation using the shared crypto module (`src/lib/crypto/ed25519.ts`).
- [ ] Add integration tests using Miniflare to validate TTL pruning and rate limits.

### Phase C – Static Capsule Pipeline (1 day)
- [x] Create script `ops/scripts/publish-capsule.ts` that queries beacons, verifies signatures, and writes `peers.json` + `peers.json.sig`.
- [x] Automate publishing via GitHub Actions workflow (`.github/workflows/capsule.yml`).

### Phase D – Client Integration & Rollout (2 days)
- [x] Wire new fetchers into `src/lib/p2p/manager.ts` so the discovery loop calls `fetchBeaconPeers()` and `fetchCapsulePeers()` before falling back to manual entry.
- [x] Update UI copy in `src/components/p2p/P2PStatusIndicator.tsx` to reflect the new rendezvous mesh status.
- [x] Feature flag progressive rollout: enable for internal testers, then default-on once metrics confirm stability.

## 7. Migration Strategy
1. Ship the client-side presence ticket code behind a hidden flag; verify signatures locally.
2. Deploy a single beacon instance in staging and run smoke tests with 3-5 devices.
3. Add at least two community-maintained beacon endpoints before turning on the feature for everyone.
4. Continue to honour manual peer ID entry as a fallback until the mesh reaches >95% success during daily health checks.

## 8. Metrics & Observability
- **Primary KPIs:** average time-to-first-peer, successful peer connections per session, beacon response latency.
- **Instrumentation:**
  - Send anonymized success/failure counters to the local analytics module (remains client-side for now).
  - Capture beacon status in the existing P2P diagnostics panel (`src/components/p2p/P2PDebugPanel.tsx`).
- **Alerting:** Page maintainers if capsule publishing fails twice consecutively or if beacon success rates drop below 80% over 15 minutes.

## 9. Risk Matrix
| Risk | Impact | Mitigation |
|------|--------|------------|
| Beacon endpoint blocked by corporate firewalls | Medium | Maintain multiple edge providers (Cloudflare, Fly.io, Fastly Compute). Capsules remain fetchable via HTTPS. |
| Compromised beacon leaking peer IDs | Low | Tickets contain only PeerJS IDs; rotate signing keys and publish revocation lists in capsules. |
| Edge outage | Medium | Capsules + cached peers keep swarm reachable. Encourage stable nodes to republish frequently. |
| Implementation delay | Medium | Phased delivery allows partial wins: cached peers + capsules can ship before edge worker is production-ready. |

## 10. Definition of Done
- ≥90% of reconnect attempts find ≥1 peer within 30 seconds in nightly smoke tests.
- Beacon and capsule infrastructure open-sourced with deployment docs.
- Manual peer entry usage drops below 5% of total connections over 14-day rolling window.

This rendezvous mesh preserves the zero-config ethos while removing the dependency on a single third-party API, giving the swarm a sustainable path forward.
