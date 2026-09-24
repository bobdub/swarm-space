# Builder Mode — Peer Connection & Content Serving Architecture

## Overview

Builder Mode is the **manual, granular-control P2P mode** in SWARM Space. Unlike SWARM Mesh (automated), Builder Mode gives power users explicit control over every connection, with four toggles governing behavior. Content is currently **working and serving between users** in this mode.

---

## 1. Identity Layer

### Stable Node ID (`p2p-stable-node-id`)
- A **16-character hex string** generated once and stored in `localStorage`
- Persists across tabs, refreshes, and browser restarts
- Source: `getStableNodeId()` in `src/lib/p2p/peerjs-adapter.ts`
- Example: `685cb8ea430d21a3`

### Peer ID (PeerJS Identity)
- Derived deterministically from Node ID: `peer-{nodeId}` (primary)
- On conflict: `peer-{nodeId}-{suffix}` where suffix is persisted in `localStorage` key `p2p-stable-fallback-suffix`
- Stored in `localStorage` under key `p2p-peer-id:{nodeId}`
- This is the ID used to register with PeerJS Cloud signaling

### User ID
- Application-level identity from `getCurrentUser().id`
- Sent as metadata during PeerJS connection handshake
- Used for content attribution and display names

---

## 2. Connection Flow (How Two Users Connect)

### Step-by-Step: User A connects to User B

```
User A                          PeerJS Cloud                    User B
  |                                  |                             |
  |-- 1. Initialize PeerJS -------->|                             |
  |   (peer-{nodeIdA})              |                             |
  |<-- 2. 'open' event -------------|                             |
  |                                  |                             |
  |-- 3. peer.connect(peerIdB) ---->|-- relay SDP offer -------->|
  |                                  |<-- relay SDP answer -------|
  |<-- 4. ICE candidates ---------->|<-- ICE candidates -------->|
  |                                  |                             |
  |<============= Direct WebRTC DataChannel ===================>|
  |                                  |                             |
  |-- 5. Send 'post' message ------>|  (direct, no relay)        |
  |                                  |                             |
```

### Detailed Steps:

1. **PeerJS Initialization** (`peerjs-adapter.ts`)
   - `PeerJSAdapter.initialize()` connects to PeerJS Cloud (`0.peerjs.com:443`)
   - Registers with deterministic peer ID `peer-{nodeId}`
   - On success, fires `readyHandlers` and sets `isSignalingConnected = true`

2. **User Enters Peer ID** (Node Dashboard → wifi icon)
   - User manually enters the other user's Peer ID
   - Calls `P2PManager.connectToPeer(peerId)` → `PeerJSAdapter.connectToPeer(peerId)`
   - PeerJS creates a `DataConnection` with `reliable: true`

3. **WebRTC Handshake** (handled by PeerJS internally)
   - SDP offer/answer exchange via PeerJS Cloud signaling server
   - ICE candidate exchange for NAT traversal (STUN servers: `stun.l.google.com`, `stun.twilio.com`)
   - Once ICE succeeds → direct WebRTC DataChannel opens

4. **Connection Established**
   - `conn.on('open')` fires → peer added to `connections` map
   - `connectionHandlers` notified → P2PManager discovers new peer
   - Post sync, comment sync, PEX, and gossip protocols activate

5. **Content Serving**
   - Posts sent via `postSync.broadcastPost(post)` → `peerjs.sendToPeer(peerId, 'post', message)`
   - Messages flow over the direct WebRTC DataChannel (no server relay)
   - Incoming posts saved to IndexedDB via `store.put('posts', post)`

---

## 3. The Four Builder Mode Toggles

These toggles exist in `StandaloneBuilderMode` (`builderMode.standalone.ts`) but **Builder Mode currently uses `P2PManager` + `PeerJSAdapter` for actual connections** (not the standalone script). The standalone script uses `BroadcastChannel` for same-origin signaling only.

| Toggle | Default | Effect |
|---|---|---|
| **Build a Mesh** | `false` | Enables/disables mesh construction. When off, all peers disconnected |
| **Blockchain Sync** | `false` | Enables/disables chain synchronization between peers |
| **Auto-Connect** | `false` | When on, auto-connects to discovered peers via presence broadcast |
| **Approve Only** | `true` | Requires manual approval for inbound peer connections |

---

## 4. Content Serving Pipeline

### How a Post Gets From User A to User B

```
1. User A creates post
   └── PostComposer.handleSubmit()
       └── createPost() → saved to IndexedDB

2. Post broadcasted to mesh
   └── p2pManager.broadcastPost(post)
       └── postSync.broadcastPost(post)
           └── peerjs.sendToPeer(eachPeer, 'post', { type: 'new', post })

3. User B receives post
   └── peerjs.onMessage('post', handler)
       └── postSync handles 'new' type
           └── Validates post → saves to local IndexedDB
               └── Emits 'p2p-posts-updated' window event

4. User B's feed refreshes
   └── Feed component listens for 'p2p-posts-updated'
       └── Re-queries IndexedDB → displays new post
```

### Cross-Mode Content Bridge (`contentBridge.ts`)

For posts to be visible between Builder Mode and SWARM Mesh users **on the same device**:
- Both modes listen on `BroadcastChannel('swarm-space-content')`
- On new post: `bridgeBroadcastPost(post)` sends to all local tabs
- On receive: `upsertPost()` saves to IndexedDB if newer
- This is **same-origin only** (same browser, different tabs)

---

## 5. Signaling Architecture

### Primary: PeerJS Cloud
- Endpoint: `wss://0.peerjs.com:443/`
- Zero configuration — no API keys needed
- Used only for initial WebRTC signaling (SDP + ICE relay)
- Once peers connect, all data flows P2P

### Fallback Strategy
- 3 attempts per endpoint with exponential backoff (1.5s → 5s max)
- If PeerJS Cloud fails, checks for custom endpoints via `VITE_PEERJS_ENDPOINTS`
- On total failure: node starts in "degraded" state, queues connections

### ID Conflict Resolution
- Primary ID: `peer-{nodeId}` (deterministic)
- On "ID is taken" error: generates fallback suffix, persists to `p2p-stable-fallback-suffix`
- All future sessions use `peer-{nodeId}-{suffix}` consistently

---

## 6. Data Flow Summary

```
┌─────────────────────────────────────────────────────────┐
│                    USER INTERFACE                        │
│  PostComposer → Feed → PostCard → Comments              │
└──────────────┬──────────────────────────┬────────────────┘
               │                          │
               ▼                          ▼
┌──────────────────────┐    ┌──────────────────────────────┐
│      IndexedDB       │    │   P2PManager (useP2P hook)   │
│  (local store)       │    │                              │
│  - posts             │◄──►│  PostSyncManager             │
│  - comments          │    │  CommentSync                 │
│  - manifests         │    │  ChunkProtocol               │
│  - connections       │    │  PeerExchange (PEX)          │
└──────────────────────┘    │  GossipProtocol              │
                            └──────────────┬───────────────┘
                                           │
                                           ▼
                            ┌──────────────────────────────┐
                            │    PeerJSAdapter             │
                            │                              │
                            │  - WebRTC DataChannels       │
                            │  - PeerJS Cloud signaling    │
                            │  - Connection lifecycle      │
                            │  - Message routing           │
                            └──────────────────────────────┘
```

---

## 7. Key Files

| File | Role |
|---|---|
| `src/lib/p2p/peerjs-adapter.ts` | PeerJS connection, peer ID generation, signaling |
| `src/lib/p2p/manager.ts` | P2PManager orchestration (3039 lines) |
| `src/hooks/useP2P.ts` | React hook bridging P2P to UI (1524 lines) |
| `src/lib/p2p/knownPeers.ts` | Bootstrap node registry, auto-connect config |
| `src/lib/p2p/postSync.ts` | Post synchronization protocol |
| `src/lib/p2p/commentSync.ts` | Comment synchronization protocol |
| `src/lib/p2p/contentBridge.ts` | Cross-mode BroadcastChannel bridge |
| `src/lib/p2p/builderMode.standalone.ts` | Standalone Builder Mode (BroadcastChannel-only) |
| `src/lib/p2p/swarmMesh.standalone.ts` | Standalone SWARM Mesh script |
| `src/config/featureFlags.ts` | Mode selection (swarmMeshMode flag) |

---

## 8. Plan: From Builder Mode → Stable SWARM Mesh Auto-Connect

### Phase 1: Confirm Peer ID Stability ✅ (Current)
- [x] Make peer ID deterministic: `peer-{nodeId}`
- [x] Persist fallback suffix for conflict resolution
- [ ] **TEST**: Refresh page → same peer ID in console
- [ ] **TEST**: Open two tabs → peer ID resolves correctly
- [ ] **TEST**: Connect two users → content visible in both feeds

### Phase 2: Validate Content Flow (Next)
- [ ] Verify post sync works after peer ID fix
- [ ] Verify comments sync bidirectionally
- [ ] Confirm IndexedDB upsert prevents duplicates
- [ ] Test with 3+ peers for PEX propagation

### Phase 3: Port to SWARM Mesh
Once Builder Mode peer ID + content serving is confirmed stable:
- [ ] Replace SWARM Mesh BroadcastChannel signaling with PeerJS signaling
- [ ] Use same `PeerJSAdapter` for mesh peer discovery
- [ ] Auto-connect to bootstrap nodes using stable peer IDs
- [ ] Enable auto-mining on successful peer connections
- [ ] Add content bridge between standalone mesh and PeerJS-backed mesh

### Phase 4: Cross-Mode Interoperability
- [ ] Builder Mode users and SWARM Mesh users see each other's content
- [ ] ContentBridge handles both same-origin (BroadcastChannel) and cross-origin (WebRTC) delivery
- [ ] Unified feed displays posts from all connected modes

---

## 9. Current Working State (What NOT to Break)

**These work right now and must be preserved:**
1. ✅ Account creation → stable Node ID generated
2. ✅ Open Node Dashboard → wifi icon → enter peer ID → connection established
3. ✅ Posts visible between two connected Builder Mode users
4. ✅ PeerJS Cloud signaling for cross-device WebRTC
5. ✅ IndexedDB persistence of posts and content
6. ✅ BroadcastChannel for same-tab content sharing

**These are being fixed:**
1. 🔧 Peer ID changing on refresh (fixed: now deterministic)
2. 🔧 Peer ID changing across tabs (fixed: localStorage persistence)
