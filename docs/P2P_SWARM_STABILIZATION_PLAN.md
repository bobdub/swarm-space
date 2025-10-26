# P2P Swarm Stabilization & Resilience Plan

> **Status Update (2025-11-07):** The fully automated discovery flow described in this
> document depends on the PeerJS Cloud `listAllPeers()` endpoint. PeerJS has now
> disabled that API for public clients, causing the original swarm bootstrap
> sequence to fail in production. Please refer to
> [`docs/P2P_RENDEZVOUS_MESH_PLAN.md`](./P2P_RENDEZVOUS_MESH_PLAN.md) for the
> replacement strategy that restores autonomous peer discovery without relying on
> the deprecated PeerJS feature.

## Current State Analysis

### Architecture Overview
- **Signaling**: PeerJS cloud-hosted (zero-config WebRTC discovery)
- **Data Transfer**: Direct P2P via WebRTC data channels
- **Peer Discovery**: Pure P2P via Peer Exchange (PEX) + Gossip Protocol ✅
- **Content Discovery**: Local inventory scanning + broadcast announcements
- **Data Storage**: IndexedDB (local-first)
- **Encryption**: Web Crypto API (AES-GCM for files, ECDH for identity)

### Identified Issues

1. **Stats Showing Zero Despite Active Data** ✅ FIXED
   - Posts created and visible locally
   - Discovery system properly initialized with content at startup
   - Extensive logging added for diagnostics

2. **No Automatic Peer Discovery** ✅ FIXED
   - Implemented Peer Exchange (PEX) protocol
   - Implemented Gossip protocol for continuous peer broadcasting
   - Bootstrap peer registry with localStorage persistence
   - Automatic connection to discovered peers

3. **Content Announcement Gaps** ✅ FIXED
   - Files announced after upload ✅
   - Posts announced on creation ✅
   - All content scanned on startup ✅

4. **Missing Swarm Features** 🔄 IN PROGRESS
   - ✅ Pure P2P peer discovery (PEX + Gossip)
   - ✅ Connection health monitoring and auto-reconnect
   - ✅ Bootstrap peer registry
   - ❌ Distributed authentication
   - ❌ Account recovery mechanism
   - ❌ Data replication strategy
   - ❌ Redundancy guarantees

---

## Pure P2P Discovery Implementation ✅

### Automatic Peer Discovery
**Status**: ✅ Implemented

**NO MANUAL PEER SHARING REQUIRED!**

The swarm now auto-discovers and auto-connects:
1. **PeerJS Network Listing** - Query all active peers on the network
2. **Auto-connection** - Automatically connect to 5 random peers
3. **Periodic Discovery** - Re-scan network every 2 minutes for new peers
4. **PEX + Gossip** - Exponential growth from initial connections

**User Experience:**
- Enable P2P → System automatically finds peers
- No peer IDs to copy/paste
- Swarm grows organically as users come online
- Manual connection still available as fallback

**Implementation:**
- `src/lib/p2p/peerjs-adapter.ts` - Added `listAllPeers()` method
- `src/lib/p2p/manager.ts` - Auto-discovery on startup + periodic scans
- `src/components/P2PStatusIndicator.tsx` - Updated UI messaging

### Peer Exchange (PEX) Protocol
**Status**: ✅ Implemented

BitTorrent-style peer exchange enabling exponential swarm growth:
- When connecting to ANY peer, request their known peer list
- Peers share up to 50 known peers per exchange
- Discovered peers automatically added to bootstrap registry
- Auto-connection to newly discovered peers

**Implementation**:
- `src/lib/p2p/peerExchange.ts` - PEX protocol
- `src/lib/p2p/manager.ts` - Integrated with connection events

### Gossip Protocol
**Status**: ✅ Implemented

Continuous peer broadcasting for network-wide visibility:
- Every 60 seconds, broadcast top 20 known peers to all connections
- Peers re-broadcast received gossip (with TTL=3 for epidemic propagation)
- Ensures eventual consistency of peer knowledge across swarm
- Opportunistic connections to peers with high content availability

**Implementation**:
- `src/lib/p2p/gossip.ts` - Gossip protocol
- Started automatically when P2P manager initializes

### Bootstrap Registry Enhancement
**Status**: ✅ Implemented

Persistent peer storage with reliability tracking:
- Stores up to 100 known peers in localStorage
- Tracks connection success/failure rates
- Reliability scoring (success rate + recency)
- Auto-connect to best peers on startup
- Support for hardcoded seed peers (empty initially, ready for community seeds)

**Implementation**:
- `src/lib/p2p/bootstrap.ts` - Enhanced with seed peer support

### Connection Health Monitoring
**Status**: ✅ Implemented

Proactive connection management:
- Tracks peer activity and heartbeats
- Auto-reconnect on connection loss
- Stale peer cleanup

**Implementation**:
- `src/lib/p2p/connectionHealth.ts` - Health monitor

### Discovery Flow
```
┌─────────────────────────────────────────────────────────────┐
│ User enables P2P → System auto-discovers peers             │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ PeerJS.listAllPeers() finds all active peers on network    │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Auto-connect to 5 random peers (bootstrap)                  │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ PEX Request → Each peer shares their 50 known peers        │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Auto-connect to discovered peers via PEX                    │
│ Each connection triggers more PEX exchanges                 │
└───────────────────────────┬─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Gossip protocol broadcasts peer updates every 60s           │
│ Network achieves eventual consistency                        │
│ Every 2 min: Re-scan for new peers joining network         │
└─────────────────────────────────────────────────────────────┘

Result: Fully autonomous swarm! 🚀
No manual peer sharing needed - just enable P2P and join the swarm!
```

---

## Phase 1: Core Stability ✅ COMPLETE

### 1.1 Fix Discovery System ✅
**Goal**: Ensure local content is properly counted and announced

**Completed**:
- ✅ Scan both files AND posts in `discovery.scanLocalContent()`
- ✅ Announce posts when created in `Create.tsx`
- ✅ Update file announcement in `FileUpload.tsx`
- ✅ Force discovery rescan when P2P enabled
- ✅ Extensive debug logging for diagnostics

**Code Locations**:
- `src/lib/p2p/discovery.ts` (scanLocalContent)
- `src/lib/p2p/manager.ts` (start method)
- `src/hooks/useP2P.ts` (enable method)

### 1.2 Peer Connection UI ✅
**Goal**: Enable users to discover and connect to peers

**Completed**:
- ✅ Display local peer ID prominently
- ✅ Add "Copy Peer ID" button
- ✅ Add "Connect to Peer" input field
- ✅ Show connection status with loading states
- ✅ User-friendly error messages

**Code Locations**:
- `src/components/P2PStatusIndicator.tsx`
- `src/hooks/useP2P.ts` (expose getPeerId, isConnecting state)

### 1.3 Connection Diagnostics ✅
**Goal**: Understand and handle connection issues

**Completed**:
- ✅ Connection health monitoring
- ✅ Automatic reconnection logic
- ✅ Bootstrap peer registry
- ✅ Retry logic with exponential backoff (3 attempts, up to 45s timeout)
- ✅ Toast notifications for connection status

**Code Locations**:
- `src/lib/p2p/peerjs-adapter.ts` (retry logic)
- `src/lib/p2p/manager.ts` (health monitoring)
- `src/lib/p2p/connectionHealth.ts`

---

## Phase 1: Core Stability (Immediate)

### 1.1 Fix Discovery System
**Goal**: Ensure local content is properly counted and announced

**Tasks**:
- ✅ Scan both files AND posts in `discovery.scanLocalContent()`
- ✅ Announce posts when created in `Create.tsx`
- ✅ Update file announcement in `FileUpload.tsx`
- 🔄 **NEW**: Force discovery rescan when P2P enabled
- 🔄 **NEW**: Add debug logging to trace content scanning

**Code Locations**:
- `src/lib/p2p/discovery.ts` (scanLocalContent)
- `src/lib/p2p/manager.ts` (start method)
- `src/hooks/useP2P.ts` (enable method)

### 1.2 Fix Peer Connection UI
**Goal**: Enable users to discover and connect to peers

**Current Gap**: Users don't know their peer ID or how to share it

**Tasks**:
- 🔄 Display local peer ID prominently in P2P status indicator
- 🔄 Add "Copy Peer ID" button
- 🔄 Add "Connect to Peer" input field
- 🔄 Show connection status and errors

**Code Locations**:
- `src/components/P2PStatusIndicator.tsx`
- `src/hooks/useP2P.ts` (expose getPeerId)

### 1.3 Connection Diagnostics
**Goal**: Understand why peers aren't connecting

**Tasks**:
- 🔄 Add connection state logging (ICE candidates, STUN/TURN)
- 🔄 Detect and report NAT/firewall issues
- 🔄 Add reconnection logic for dropped peers
- 🔄 Implement connection health monitoring

**Code Locations**:
- `src/lib/p2p/peerjs-adapter.ts`
- `src/lib/p2p/manager.ts`

---

## Phase 2: Distributed Authentication (Foundation)

### 2.1 Identity & Key Management
**Goal**: Create recoverable, P2P-compatible identity system

**Design**:
```
User Identity = ECDH Key Pair
├── Public Key → User ID (SHA-256 hash, first 16 chars)
├── Private Key → Encrypted with passphrase (PBKDF2 + AES-GCM)
└── Stored in: IndexedDB + Distributed Backup Shards
```

**Tasks**:
- 🔄 Generate identity key pair on first login
- 🔄 Derive user ID from public key
- 🔄 Encrypt private key with user passphrase
- 🔄 Store encrypted identity locally
- 🔄 Implement identity export/import

**Code Locations**:
- `src/lib/crypto.ts` (already has ECDH generation)
- `src/lib/auth.ts` (integrate P2P identity)
- NEW: `src/lib/p2p/identity.ts`

### 2.2 Distributed Account Backup
**Goal**: Enable account recovery without central servers

**Design**: Secret Sharing Scheme (Shamir's Secret Sharing)
```
Private Key → Split into N shards (e.g., 5 shards, need any 3 to recover)
├── Shard 1 → Peer A
├── Shard 2 → Peer B
├── Shard 3 → Peer C
├── Shard 4 → Peer D
└── Shard 5 → Peer E
```

**Tasks**:
- 🔄 Implement Shamir's Secret Sharing
- 🔄 Split private key into N shards
- 🔄 Distribute shards to trusted peers
- 🔄 Implement shard request protocol
- 🔄 Implement key reconstruction from shards

**Code Locations**:
- NEW: `src/lib/p2p/secretSharing.ts`
- NEW: `src/lib/p2p/accountRecovery.ts`

### 2.3 Authentication Packets
**Goal**: Sign and verify actions across the swarm

**Design**:
```
Authenticated Action = {
  data: { ... },
  signature: ECDSA(privateKey, hash(data)),
  publicKey: base64(publicKey),
  timestamp: ISO8601
}
```

**Tasks**:
- 🔄 Sign posts with private key
- 🔄 Sign file manifests with private key
- 🔄 Verify signatures on incoming data
- 🔄 Reject unsigned/invalid data

**Code Locations**:
- NEW: `src/lib/p2p/signing.ts`
- `src/lib/p2p/postSync.ts` (add verification)
- `src/lib/p2p/chunkProtocol.ts` (add verification)

---

## Phase 3: Swarm Data Replication

### 3.1 Content Replication Strategy
**Goal**: Ensure content survives peer churn

**Design**: Redundancy Factor (RF)
```
Each content chunk replicated to RF peers (e.g., RF=3)
├── Original peer
├── Replica peer 1
└── Replica peer 2

Selection: Closest peers by XOR distance of peer ID
```

**Tasks**:
- 🔄 Implement XOR distance metric for peer selection
- 🔄 Auto-replicate chunks to RF peers on upload
- 🔄 Monitor replica health
- 🔄 Re-replicate if peer goes offline
- 🔄 Implement replication protocol messages

**Code Locations**:
- NEW: `src/lib/p2p/replication.ts`
- `src/lib/p2p/discovery.ts` (add XOR distance)
- `src/lib/p2p/chunkProtocol.ts` (add replication requests)

### 3.2 Dynamic Rebalancing
**Goal**: Adapt to network changes

**Triggers**:
- Peer joins → Offer to store replicas
- Peer leaves → Re-replicate orphaned chunks
- Peer storage full → Migrate chunks elsewhere

**Tasks**:
- 🔄 Implement storage capacity tracking
- 🔄 Add chunk migration protocol
- 🔄 Periodic health checks for replicas
- 🔄 Auto-rebalance on network topology changes

**Code Locations**:
- `src/lib/p2p/replication.ts`
- `src/lib/p2p/manager.ts` (orchestrate rebalancing)

### 3.3 Eventual Consistency
**Goal**: Handle conflicting updates across peers

**Design**: Last-Write-Wins with Vector Clocks
```
Post Update = {
  data: Post,
  version: VectorClock,
  timestamp: number
}

Conflict Resolution:
1. If version1 > version2 → Keep version1
2. If concurrent → Keep latest timestamp
3. Store conflict history for manual resolution
```

**Tasks**:
- 🔄 Implement vector clock system
- 🔄 Attach vector clocks to posts/files
- 🔄 Detect conflicts on merge
- 🔄 Auto-resolve with LWW + timestamp
- 🔄 Log conflicts for user review

**Code Locations**:
- NEW: `src/lib/p2p/vectorClock.ts`
- `src/lib/p2p/postSync.ts` (add conflict resolution)

---

## Phase 4: Swarm Intelligence

### 4.1 Peer Reputation System
**Goal**: Trust scoring for reliable peers

**Metrics**:
- Uptime percentage
- Data availability (successful chunk requests)
- Response time
- Invalid data attempts (security)

**Tasks**:
- 🔄 Track peer reliability metrics
- 🔄 Compute reputation scores
- 🔄 Prefer high-reputation peers for critical data
- 🔄 Isolate malicious/unreliable peers

**Code Locations**:
- NEW: `src/lib/p2p/reputation.ts`
- `src/lib/p2p/discovery.ts` (integrate with peer selection)

### 4.2 Smart Peer Selection
**Goal**: Optimize network efficiency

**Strategy**:
```
Peer Selection = f(
  reputation,
  proximity (network latency),
  availability,
  storage capacity,
  connection stability
)
```

**Tasks**:
- 🔄 Measure RTT to peers
- 🔄 Track connection stability
- 🔄 Implement weighted scoring algorithm
- 🔄 Update `getBestPeerForContent()` with smart selection

**Code Locations**:
- `src/lib/p2p/discovery.ts` (enhance getBestPeerForContent)
- NEW: `src/lib/p2p/peerScoring.ts`

### 4.3 Network Topology Awareness
**Goal**: Optimize swarm structure

**Design**: Hybrid Topology
- Full mesh for small swarms (< 10 peers)
- Structured overlay (DHT-like) for large swarms
- Supernode election for high-capacity peers

**Tasks**:
- 🔄 Detect swarm size
- 🔄 Elect supernodes based on capacity/uptime
- 🔄 Route through supernodes for distant peers
- 🔄 Implement DHT-style content routing

**Code Locations**:
- NEW: `src/lib/p2p/topology.ts`
- `src/lib/p2p/manager.ts` (coordinate topology changes)

---

## Phase 5: Long-Term Resilience

### 5.1 Persistent Peer Registry
**Goal**: Reconnect to known peers after restart

**Design**:
```
Peer Registry = {
  peerId: string,
  userId: string,
  lastSeen: Date,
  knownAddresses: string[],
  reliability: number
}

Storage: IndexedDB + periodic backup to trusted peers
```

**Tasks**:
- 🔄 Store peer info in IndexedDB
- 🔄 Auto-reconnect to last-seen peers on startup
- 🔄 Sync registry with trusted peers
- 🔄 Prune stale peers (not seen in X days)

**Code Locations**:
- NEW: `src/lib/p2p/peerRegistry.ts`
- `src/lib/p2p/manager.ts` (auto-reconnect on start)

### 5.2 Bootstrap Nodes
**Goal**: Help new peers find the swarm

**Options**:
1. **Static Bootstrap List**: Hardcoded reliable peer IDs
2. **Dynamic Discovery**: Public DHT for peer advertising
3. **Hybrid**: Static + advertise in public registry

**Tasks**:
- 🔄 Maintain list of known stable peers
- 🔄 Connect to bootstrap nodes on first start
- 🔄 Implement DHT-style peer advertising
- 🔄 Fallback to PeerJS discovery if no bootstrap nodes

**Code Locations**:
- NEW: `src/lib/p2p/bootstrap.ts`
- `src/lib/p2p/manager.ts` (integrate bootstrap)

### 5.3 Offline-First Guarantees
**Goal**: Full functionality without internet

**Requirements**:
- ✅ Read local posts/files (already works)
- ✅ Create new posts/files (already works)
- 🔄 Queue changes for sync when peers reconnect
- 🔄 Detect and show offline status

**Tasks**:
- 🔄 Implement sync queue for offline changes
- 🔄 Detect online/offline transitions
- 🔄 Batch sync on reconnection
- 🔄 Show pending sync status in UI

**Code Locations**:
- NEW: `src/lib/p2p/syncQueue.ts`
- `src/hooks/useP2P.ts` (expose sync status)

---

## Implementation Priority

### Immediate (Fix Critical Issues)
1. ✅ Fix content counting (discovery scan)
2. 🔄 Add peer ID display and connection UI
3. 🔄 Add connection diagnostics
4. 🔄 Force discovery rescan on P2P enable

### Short-Term (Core Swarm Features)
5. 🔄 Distributed identity system
6. 🔄 Content signatures and verification
7. 🔄 Basic replication (RF=2)
8. 🔄 Peer registry persistence

### Medium-Term (Enhanced Resilience)
9. 🔄 Secret sharing for account recovery
10. 🔄 Conflict resolution with vector clocks
11. 🔄 Reputation system
12. 🔄 Smart peer selection

### Long-Term (Advanced Swarm Intelligence)
13. 🔄 Supernode topology
14. 🔄 DHT-style routing
15. 🔄 Bootstrap node system
16. 🔄 Offline sync queue

---

## Technical Debt & Refactoring

### Current Issues
1. **Large files**: `peerjs-adapter.ts` (315 lines), `discovery.ts` (256 lines)
   - Should split into focused modules

2. **Missing error boundaries**: P2P errors can crash the app
   - Need React error boundaries around P2P components

3. **No retry logic**: Failed connections don't retry
   - Add exponential backoff

4. **Manual peer discovery**: Users must exchange peer IDs
   - Need better UX or discovery mechanism

### Refactoring Plan
- Split `peerjs-adapter.ts`:
  - `connection-manager.ts` (connection lifecycle)
  - `message-router.ts` (message handling)
  - `signaling.ts` (PeerJS wrapper)

- Split `discovery.ts`:
  - `peer-tracker.ts` (peer state)
  - `content-inventory.ts` (content tracking)
  - `local-scanner.ts` (IndexedDB scanning)

---

## Success Metrics

### Stability
- ✅ P2P stats accurately reflect reality
- ✅ Peers can connect and maintain connections
- ✅ Content transfers successfully
- ✅ System survives peer churn

### Decentralization
- ✅ No central servers required (except PeerJS signaling)
- ✅ Account recovery without central authority
- ✅ Data persists across peer restarts
- ✅ New peers can join and discover content

### User Experience
- ✅ Clear P2P status visibility
- ✅ Easy peer discovery and connection
- ✅ Seamless offline → online transitions
- ✅ Fast content access (< 2s for chunks)

---

## Next Steps

**Immediate Action Items**:
1. Debug and fix stats reporting
2. Implement peer ID sharing UI
3. Add connection diagnostics logging
4. Test with 2-3 peers in different networks

**Week 1 Goals**:
- Basic peer connectivity working reliably
- Content properly announced and discovered
- Stats accurately reflecting network state

**Month 1 Goals**:
- Distributed identity system operational
- Content replication (RF=2) implemented
- Peer registry persistence working

**Quarter 1 Goals**:
- Account recovery via secret sharing
- Full swarm resilience (survives 50% peer churn)
- Smart peer selection and topology optimization
