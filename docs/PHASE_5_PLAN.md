# Phase 5: P2P Networking Foundation

## Overview
Building the peer-to-peer networking layer to enable device-to-device content distribution, real-time sync, and decentralized operation - all without requiring backend infrastructure.

## Architecture Philosophy
- **Offline-First**: P2P is additive, not required
- **WebRTC Native**: Direct browser-to-browser connections
- **Content-Addressed**: Chunks are requested by hash
- **Progressive**: Start with LAN discovery, expand to internet-wide

## Sprint 1: WebRTC Infrastructure (Starting Now)

### Core Components

#### 1. Peer Connection Manager
**File**: `src/lib/p2p/peerConnection.ts`
- WebRTC peer connection lifecycle
- ICE candidate handling
- Connection state management
- STUN/TURN configuration
- Data channel creation/management

#### 2. Signaling Layer
**File**: `src/lib/p2p/signaling.ts`
- Local signaling via BroadcastChannel (same-origin tabs)
- WebSocket signaling relay (optional, for internet-wide)
- Offer/answer exchange
- ICE candidate relay
- Peer discovery announcements

#### 3. Chunk Distribution Protocol
**File**: `src/lib/p2p/chunkProtocol.ts`
- Request chunks by hash
- Respond to chunk requests
- Validate chunk integrity (SHA-256)
- Queue management
- Bandwidth throttling

#### 4. Peer Discovery
**File**: `src/lib/p2p/discovery.ts`
- LAN peer discovery (BroadcastChannel)
- Announce available content (manifest hashes)
- Query for content availability
- Peer capability exchange
- Network type detection

#### 5. Sync Manager
**File**: `src/lib/p2p/sync.ts`
- Identify missing chunks
- Prioritize chunk downloads
- Parallel peer connections
- Fallback to local storage
- Progress tracking

### Data Structures

```typescript
interface Peer {
  id: string;
  userId: string;
  connection: RTCPeerConnection;
  dataChannel: RTCDataChannel;
  state: 'connecting' | 'connected' | 'disconnected';
  availableContent: Set<string>; // manifest hashes
  lastSeen: Date;
  rtt: number; // round-trip time
}

interface P2PMessage {
  type: 'announce' | 'request_chunk' | 'chunk_data' | 'query' | 'offer' | 'answer' | 'ice';
  payload: any;
  timestamp: Date;
  senderId: string;
}

interface ChunkRequest {
  hash: string;
  priority: number;
  timeout: number;
  retries: number;
}

interface SyncState {
  manifestHash: string;
  totalChunks: number;
  completedChunks: Set<string>;
  pendingRequests: Map<string, ChunkRequest>;
  activePeers: Set<string>;
}
```

### Implementation Plan

#### Step 1: Basic WebRTC Setup
- [x] Configure STUN servers (use public Google STUN)
- [ ] Create PeerConnection class
- [ ] Implement data channel messaging
- [ ] Handle connection lifecycle

#### Step 2: Local Discovery
- [ ] BroadcastChannel signaling for same-origin tabs
- [ ] Peer announcement protocol
- [ ] Content availability broadcasting
- [ ] Simple offer/answer exchange

#### Step 3: Chunk Protocol
- [ ] Chunk request/response messages
- [ ] Hash-based validation
- [ ] Queue management
- [ ] Error handling and retries

#### Step 4: Sync Logic
- [ ] Detect missing content
- [ ] Query peers for availability
- [ ] Download chunks from fastest peer
- [ ] Assemble files from chunks

#### Step 5: UI Integration
- [ ] P2P status indicator in TopNavigationBar
- [ ] Peer list view (Settings page)
- [ ] Sync progress indicators
- [ ] Connection quality metrics

### Testing Strategy

#### Unit Tests
- Chunk validation
- Message serialization
- State management
- Queue prioritization

#### Integration Tests
- Two-tab local connection
- Chunk transfer between tabs
- Conflict resolution
- Connection recovery

#### Performance Tests
- Chunk transfer speed
- Memory usage during sync
- Connection overhead
- Concurrent peer limits

### Success Metrics

#### Phase 5.1 (Sprint 1)
- [ ] Establish WebRTC connection between two browser tabs
- [ ] Transfer single chunk successfully
- [ ] Validate chunk integrity
- [ ] Display P2P status in UI

#### Phase 5.2 (Future)
- [ ] Multi-peer content distribution
- [ ] Background sync while app is open
- [ ] Automatic peer discovery on LAN
- [ ] Bandwidth-efficient syncing

#### Phase 5.3 (Future)
- [ ] Internet-wide peer discovery
- [ ] NAT traversal success rate >80%
- [ ] CRDT-based conflict resolution
- [ ] Offline message queue

## Security Considerations

### Implemented
- Content integrity via SHA-256
- Encrypted chunks (existing AES-GCM)
- User identity verification (ECDH keys)

### Phase 5 Additions
- Peer authentication via signed messages
- Rate limiting on chunk requests
- Malicious peer detection
- DoS protection

### Future
- End-to-end encrypted signaling
- Onion-style routing for privacy
- Reputation system for peers

## Network Architecture

### Tier 1: Local Discovery (This Sprint)
```
[Browser Tab A] <--> BroadcastChannel <--> [Browser Tab B]
                          ↓
                    WebRTC DataChannel
```

### Tier 2: LAN Discovery (Future)
```
[Device A] <--> mDNS/Bonjour <--> [Device B]
                     ↓
           WebRTC + STUN (LAN)
```

### Tier 3: Internet-Wide (Future)
```
[Peer A] <--> Signaling Server <--> [Peer B]
                     ↓
          WebRTC + STUN + TURN
```

## Performance Targets

### Latency
- Local peer discovery: <100ms
- WebRTC connection establishment: <2s
- Chunk transfer initiation: <200ms

### Throughput
- Single peer: ~10 MB/s
- Multiple peers: ~50 MB/s aggregate
- Overhead: <5% of transferred data

### Resource Usage
- Memory per peer: <5 MB
- CPU: <10% during active sync
- Max concurrent peers: 20

## Migration Path

### Phase 5.1 (Now)
- Pure client-side, no backend
- BroadcastChannel signaling only
- Same-origin tab communication

### Phase 5.2 (After P2P Stable)
- Optional signaling relay (Supabase Edge Function)
- Internet-wide peer discovery
- Mobile device support

### Phase 5.3 (Advanced)
- DHT-based peer discovery
- BitTorrent-style swarms
- Incentive mechanisms (credits)

## Risk Assessment

### High Risk
- **NAT Traversal Failures**: Mitigated by TURN fallback
- **Browser Compatibility**: Test across Chrome/Firefox/Safari
- **Connection Instability**: Implement aggressive reconnection

### Medium Risk
- **Bandwidth Abuse**: Rate limiting and peer reputation
- **Malicious Peers**: Content validation and peer blocking
- **Scale Limits**: Max peer count and chunk queue size

### Low Risk
- **Storage Overhead**: Already have chunk deduplication
- **UI Complexity**: Progressive disclosure of P2P features

## Open Questions

1. **Signaling Strategy**: Pure BroadcastChannel or add optional relay?
   - **Decision**: Start with BroadcastChannel, add relay in 5.2

2. **Peer Limits**: How many concurrent connections?
   - **Decision**: Start with 5, test up to 20

3. **Chunk Priority**: FIFO, priority queue, or user-driven?
   - **Decision**: Priority-based (user content > background sync)

4. **Offline Peers**: How long to cache peer info?
   - **Decision**: 5 minutes, with periodic cleanup

## Next Steps

1. Implement PeerConnection manager
2. Create BroadcastChannel signaling
3. Build chunk request/response protocol
4. Test two-tab chunk transfer
5. Add P2P status UI
6. Document P2P developer guide

## Dependencies

### External
- WebRTC (native browser API)
- BroadcastChannel (native browser API)
- Public STUN servers (Google)

### Internal
- `src/lib/crypto.ts` - Chunk hashing, signatures
- `src/lib/fileEncryption.ts` - Chunk encryption
- `src/lib/store.ts` - IndexedDB chunk storage

## Documentation Needs

- [ ] P2P Architecture diagram
- [ ] Message protocol specification
- [ ] Peer discovery flow
- [ ] Developer guide for P2P features
- [ ] User guide for P2P sync
