# P2P Protocol Documentation

## Overview

This document describes the peer-to-peer (P2P) protocol used in Swarm Space for building an always-online, decentralized network. This specification is designed to enable external implementations (e.g., Electron apps, native daemons) that can interoperate with the web and mobile clients.

---

## Architecture

### Core Components

```
┌─────────────────────────────────────────────────┐
│            Application Layer                    │
│  (Posts, Files, User Profiles, Auth)           │
└─────────────────┬───────────────────────────────┘
                  │
┌─────────────────┴───────────────────────────────┐
│         P2P Manager (Orchestration)             │
│  - Connection lifecycle                         │
│  - Peer discovery                               │
│  - Message routing                              │
└─────────────────┬───────────────────────────────┘
                  │
┌─────────────────┴───────────────────────────────┐
│          Transport Layer                        │
│  - PeerJS (WebRTC signaling)                    │
│  - WebRTC Data Channels                         │
│  - Gossip Protocol                              │
└─────────────────────────────────────────────────┘
```

---

## Node States

Each node follows a state machine:

| State | Description | Transitions |
|-------|-------------|-------------|
| **offline** | No P2P activity | → connecting (on user enable) |
| **connecting** | Connecting to signaling server | → waiting (signaling established)<br>→ offline (connection failed) |
| **waiting** | Connected to signaling, discovering peers | → online (first peer connects)<br>→ connecting (signaling lost) |
| **online** | Active in swarm with ≥1 peer | → waiting (all peers disconnect)<br>→ connecting (signaling lost) |

---

## Message Types

### 1. Heartbeat
```typescript
{
  type: 'heartbeat',
  payload: {
    peerId: string,        // Sender's peer ID
    timestamp: number,     // Unix timestamp
    nodeInfo: {
      userId?: string,     // Optional user ID (if authenticated)
      capabilities: string[] // ['post-sync', 'file-chunk', 'gossip']
    }
  }
}
```

### 2. Peer Exchange (PEX)
```typescript
{
  type: 'peer-exchange',
  payload: {
    peers: Array<{
      peerId: string,
      lastSeen: number,
      reputation?: number  // Optional trust score
    }>
  }
}
```

### 3. Post Sync
```typescript
{
  type: 'post-sync',
  payload: {
    action: 'announce' | 'request' | 'response',
    posts?: Post[],       // For response
    postIds?: string[],   // For announce/request
    since?: number        // Timestamp filter
  }
}
```

### 4. File Chunk Request
```typescript
{
  type: 'chunk-request',
  payload: {
    chunkHash: string,    // SHA-256 hash of chunk
    manifestHash?: string // Optional parent manifest
  }
}
```

### 5. File Chunk Response
```typescript
{
  type: 'chunk-response',
  payload: {
    chunkHash: string,
    data: Uint8Array,     // Raw chunk data
    success: boolean
  }
}
```

### 6. Gossip
```typescript
{
  type: 'gossip',
  payload: {
    messageId: string,    // Unique message ID
    ttl: number,          // Time to live (hop count)
    origin: string,       // Original sender peer ID
    data: unknown         // Application-specific payload
  }
}
```

---

## Discovery & Bootstrap

### Initial Connection Flow

```
1. Node starts → Connect to PeerJS signaling server
   ↓
2. Obtain unique peer ID from signaling server
   ↓
3. Broadcast heartbeat to known bootstrap peers
   ↓
4. Receive peer lists via PEX
   ↓
5. Establish WebRTC connections to discovered peers
   ↓
6. Enter 'online' state, begin data synchronization
```

### Bootstrap Peers

Currently using PeerJS cloud signaling (`peerjs.com`). For production:

- Deploy custom PeerJS signaling server
- Use DHT (Distributed Hash Table) for peer discovery
- Implement local network discovery (mDNS/Bonjour)

---

## Authentication & Identity

### Keypair Management

Each node generates an ECDH P-256 keypair:

```typescript
// Generate identity
const { publicKey, privateKey } = await genIdentityKeyPair();

// Derive user ID from public key
const userId = await computeUserId(publicKey); // SHA-256(publicKey)[0:16]
```

### Passphrase Protection

Private keys are encrypted with user passphrase using PBKDF2 + AES-GCM:

```typescript
const { wrapped, salt, iv } = await wrapPrivateKey(privateKey, passphrase);
// Store wrapped key in localStorage
```

### Username Claims

```typescript
{
  type: 'username-claim',
  payload: {
    username: string,
    publicKey: string,    // Base64-encoded SPKI
    signature: string,    // Sign(username + timestamp)
    timestamp: number
  }
}
```

Conflict resolution:
1. Earliest timestamp wins
2. Require 2/3 quorum for acceptance
3. Peers cache claims in local auth ledger

---

## Data Persistence

### Local Storage Schema

```
localStorage:
  - p2p_enabled: boolean
  - p2p_userId: string
  - p2p_publicKey: string (base64)
  - p2p_privateKey: { wrapped, salt, iv } (encrypted)
  - p2p_username?: string
  - auth_ledger: { [username]: { publicKey, timestamp, quorum } }
  - peer_cache: { [peerId]: { lastSeen, reputation } }
```

### Content-Addressed Storage

Files are chunked and stored by hash:

```
chunk_hash = SHA-256(chunk_data)
manifest_hash = SHA-256(JSON.stringify({
  chunks: [chunk_hash_1, chunk_hash_2, ...],
  metadata: { filename, size, mime }
}))
```

---

## Implementation Checklist for External Apps

### Phase 1: Core Node (Always-On Daemon)

- [ ] WebRTC connection handling
- [ ] PeerJS adapter or custom signaling
- [ ] Heartbeat broadcasting (30s interval)
- [ ] Peer discovery and connection management
- [ ] Message routing and handling
- [ ] Local SQLite/LevelDB for peer cache
- [ ] Auto-reconnect on network change

### Phase 2: Authentication

- [ ] ECDH keypair generation
- [ ] PBKDF2 key wrapping
- [ ] Username claim broadcast
- [ ] Auth ledger synchronization
- [ ] Signature verification

### Phase 3: Data Sync

- [ ] Post synchronization protocol
- [ ] File chunking and content addressing
- [ ] Chunk request/response handling
- [ ] Gossip protocol for message propagation
- [ ] Merkle tree validation (optional)

---

## Testing Protocol Compatibility

To verify interoperability with web/mobile clients:

1. **Connect Test**: External node connects to same PeerJS server
2. **Heartbeat Test**: Exchange heartbeat messages with web client
3. **PEX Test**: Request and receive peer lists
4. **Post Sync Test**: Sync posts between external node and web client
5. **Chunk Test**: Request file chunk from web client
6. **24h Stability Test**: Maintain connection for 24 hours

---

## Security Considerations

- **No central authority**: All trust is peer-based
- **End-to-end encryption**: Use ECDH for key exchange, AES-GCM for data
- **Replay protection**: Include timestamps in signed messages
- **Sybil resistance**: Reputation scoring + proof-of-uptime challenges
- **Private key protection**: Never transmit private keys, always wrapped

---

## Future Enhancements

- DHT for serverless peer discovery
- NAT traversal with STUN/TURN fallback
- Onion routing for anonymity
- Merkle-DAG for verifiable history
- Proof-of-Uptime consensus for username claims
- Mobile push notifications via background sync

---

## Reference Implementation

Current web implementation files:
- `src/lib/p2p/manager.ts` - P2P orchestration
- `src/lib/p2p/peerjs-adapter.ts` - PeerJS transport
- `src/lib/p2p/gossip.ts` - Gossip protocol
- `src/lib/p2p/postSync.ts` - Post synchronization
- `src/lib/p2p/chunkProtocol.ts` - File chunking
- `src/lib/crypto.ts` - Cryptographic primitives
- `src/hooks/useP2P.ts` - React integration

---

## Contact & Contribution

For questions or to contribute to external implementations, see project repository or open an issue.
