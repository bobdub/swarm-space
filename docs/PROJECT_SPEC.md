# Imagination Network – Technical Specifications

_Version 2.0 | Last Updated: 2025-11-14_

## Overview

**Imagination Network** (Swarm Space) is a decentralized, offline-first collaboration platform built on P2P mesh architecture. Users control their identity, content, and distribution through cryptographic key ownership and content-addressed storage.

---

## Technology Stack

### Frontend
- **Framework**: React 18.3 + TypeScript
- **Build Tool**: Vite
- **Styling**: Tailwind CSS + shadcn/ui components
- **State**: React Query (TanStack Query 5) + Zustand
- **Routing**: React Router 6

### Storage & Crypto
- **Local Storage**: IndexedDB (v6 schema)
- **Cryptography**: Web Crypto API
  - Ed25519 for signing (rendezvous identity)
  - ECDH for key exchange
  - AES-256-GCM for encryption
  - SHA-256 for content addressing

### P2P Networking
- **Transport**: PeerJS (WebRTC) + Integrated Mode (experimental)
- **Signaling**: PeerJS Cloud (default) + self-hostable PeerJS server
- **Discovery**: Rendezvous mesh + peer exchange
- **Experimental**: WebTorrent DHT, GUN.js overlay

---

## Core Features

### 1. Identity & Authentication
- **Ed25519 Key Pairs**: Generated on device, stored encrypted in localStorage
- **Account Export/Import**: Full backup includes identity keys, content keys, peer-id
- **Account Transfer**: Transfer identity to new device using private key + peer-id
- **Handle System**: Username bound to public key via signed payloads with nonce-based replay protection
- **No Central Authority**: Zero-knowledge architecture, keys never leave device

### 2. Content Creation & Storage
- **Posts**: Rich text + file attachments, signed with Ed25519
- **Projects**: Collaborative workspaces with shared content
- **Tasks & Milestones**: Kanban board + calendar planning
- **File Encryption**: 
  - Files chunked into 64KB blocks
  - Each chunk encrypted with AES-256-GCM + unique IV
  - SHA-256 content addressing for deduplication
  - Manifests signed for authenticity

### 3. P2P Mesh Networking
- **WebRTC Data Channels**: Direct peer-to-peer connections
- **Rendezvous Discovery**: Bootstrap via rendezvous beacons
- **Auto-Connect**: Optional automatic connection to moderator/dev peer-id for seamless onboarding
- **Peer Exchange (PEX)**: Peers share known peer lists
- **Gossip Protocol**: Decentralized message propagation
- **Chunk Distribution**: Content-addressed chunk exchange
- **Post Sync**: Signed post broadcast with verification
- **Presence Tickets**: Ed25519-signed presence announcements

### 4. Credits Economy
- **Local Credits**: Non-monetary tokens for activity tracking
- **Earning**:
  - +10 credits per post
  - +2 credits per engagement (planned)
  - +1 credit per MB hosted (planned)
- **Spending**:
  - Hype posts (5 credits: 80% to author, 20% burned)
  - Tips between users
  - Future: project collaboration incentives

### 5. WebRTC Streaming (Live Rooms)
- **Pure P2P Mesh Topology**: No SFU/MCU, direct peer connections
- **Room Types**: 
  - Public (broadcast to feed)
  - Private (invite-only)
  - Project-scoped
- **Features**:
  - Audio/video tracks with mute controls
  - Ban/unban participants (host privileges)
  - Stream-to-post integration
- **Bandwidth**: ~1.8 Mbps per peer for 720p + audio
- **Signaling**: WebSocket-based room coordination

### 6. Security & Privacy
- **Encryption Layers**:
  - Identity: ECDH + AES-GCM wrapped private keys
  - Files: Per-file AES-256-GCM keys
  - Projects: Shared project keys (Phase 4)
- **Content Authenticity**: Ed25519 signatures on posts + manifests
- **Identity Recovery**: Shamir's Secret Sharing (3-of-5 quorum default)
- **Privacy Principles**:
  - No plaintext data on servers
  - Keys stay on device
  - Optional encrypted relays only

---

## Architecture Layers

```
┌─────────────────────────────────────────────────────┐
│                 React UI Layer                      │
│        (Pages, Components, Contexts)                │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────┴───────────────────────────────┐
│           Application Logic Layer                   │
│   • Feed algorithms  • Post creation  • Tasks       │
│   • Credits engine   • Streaming rooms              │
└─────────────────────┬───────────────────────────────┘
                      │
         ┌────────────┼────────────┐
         │            │            │
┌────────▼─────┐ ┌───▼──────┐ ┌──▼────────────┐
│ Crypto Layer │ │ Storage  │ │ P2P Layer     │
│ (Web Crypto) │ │(IndexDB) │ │ (WebRTC)      │
│ • Ed25519    │ │ • Posts  │ │ • Rendezvous  │
│ • AES-GCM    │ │ • Chunks │ │ • Auto-Connect│
│ • SHA-256    │ │ • Users  │ │ • Streaming   │
└──────────────┘ └──────────┘ └───────────────┘
```

---

## Data Flow Examples

### Creating a Post with Files
1. User selects files in FileUpload component
2. Generate unique file key (AES-GCM 256-bit)
3. Chunk file into 64KB blocks
4. For each chunk:
   - Generate random IV (12 bytes)
   - Encrypt with file key + IV
   - Hash ciphertext → chunk ref (SHA-256)
   - Store in IndexedDB
5. Create manifest with chunk refs + metadata
6. Sign manifest with Ed25519 rendezvous key
7. Create post with manifest IDs
8. Sign post with Ed25519
9. Store post locally + broadcast to mesh

### Auto-Connect Flow
1. User enables P2P networking
2. System checks for auto-connect preference (default: enabled)
3. Attempts connection to known moderator/dev peer-id
4. **Success** → Connected to main mesh
5. **Failure** → Prompt for manual peer connection or retry in 5 hours
6. User can disable auto-connect anytime for custom mesh building

### Account Transfer
1. Export account from Device A (includes private key + peer-id)
2. On Device B, import account backup
3. Ed25519 identity restored from private key
4. Peer-id retained for P2P mesh recognition
5. Auto-connect resumes using original peer-id

---

## IndexedDB Schema (v6)

### Stores
- **users**: User profiles, encrypted identity keys
- **posts**: Signed posts with manifest references
- **projects**: Collaborative workspace metadata
- **tasks**: Task definitions with assignments
- **milestones**: Calendar events
- **fileChunks**: Encrypted chunk data (ref → ciphertext + IV)
- **fileManifests**: Signed file metadata + chunk refs
- **comments**: Post comments with threading
- **reactions**: Emoji reactions on posts
- **connections**: Peer connections (follow graph)
- **credits**: Credit balance + transaction history
- **notifications**: User notifications queue

---

## P2P Transport Modes

### PeerJS Mode (Default)
- Uses PeerJS Cloud signaling
- WebRTC data channels for mesh
- Automatic NAT traversal with STUN/TURN
- Zero-config for end users

### Integrated Mode (Experimental)
- **WebTorrent DHT**: Distributed peer discovery
- **GUN.js Overlay**: Gossip-based signaling mesh
- **WebRTC**: Direct data channels (final hop)
- Resilient to signaling server failures

---

## Configuration

### Rendezvous Beacons
Configured in `index.html`:
```json
{
  "beacons": [
    "https://beacon1.swarm-space.network",
    "https://beacon2.swarm-space.network"
  ],
  "capsules": [],
  "trustedCapsulePublicKeys": []
}
```

### Auto-Connect Settings
- Default: **Enabled**
- Retry Interval: 5 hours
- Target: Moderator/dev peer-id (configurable)
- User can disable in P2P settings

---

## Performance Characteristics

### Local Operations (Offline)
- Post creation: <50ms
- Feed pagination (100 posts): <100ms
- File chunk encryption (64KB): ~5ms
- Manifest signing: <2ms

### P2P Operations (Online)
- Peer connection establishment: 2-5s (STUN) / 5-15s (TURN)
- Chunk request/response: 50-500ms (LAN) / 200-2000ms (WAN)
- Post broadcast propagation: 1-3 hops to reach mesh

### Streaming
- Audio-only uplink: ~45 kbps per peer
- 720p video uplink: ~1.8 Mbps per peer
- Recommended max participants: 6 simultaneous video streams

---

## File Locations

### Core Libraries
- `src/lib/auth.ts` - Identity management
- `src/lib/crypto.ts` - Encryption utilities
- `src/lib/fileEncryption.ts` - Chunk encryption
- `src/lib/store.ts` - IndexedDB wrapper
- `src/lib/p2p/manager.ts` - P2P mesh orchestrator
- `src/lib/p2p/rendezvousIdentity.ts` - Ed25519 signing
- `src/lib/p2p/bootstrap.ts` - Auto-connect logic
- `src/lib/webrtc/manager.ts` - Streaming rooms
- `src/lib/credits.ts` - Credits engine

### UI Components
- `src/pages/` - Route pages
- `src/components/` - Reusable components
- `src/contexts/` - React contexts (P2P, Streaming, Auth)

---

## Deployment

### Frontend
- Build: `npm run build`
- Output: `dist/` (static files)
- Hosting: Any static host (Vercel, Cloudflare Pages, IPFS)

### Self-Hosted Infrastructure (Optional)
- **PeerJS Server**: For custom signaling
- **Rendezvous Beacons**: Cloudflare Workers for peer discovery
- **TURN Servers**: For NAT traversal assistance

---

## Development

### Setup
```bash
npm install
npm run dev
```

### Testing
```bash
npm test                    # Unit tests
npm run test:e2e           # E2E tests
```

### Build
```bash
npm run build              # Production build
npm run preview            # Preview production build
```

---

## Browser Support

### Required Features
- IndexedDB
- Web Crypto API (SubtleCrypto)
- Ed25519 signing (Chrome 113+, Firefox 126+)
- WebRTC data channels
- ES2020+ JavaScript

### Tested Browsers
- Chrome/Edge 113+
- Firefox 126+
- Safari 16.4+ (Ed25519 support via polyfill)

---

## Known Limitations

### Current
- No multi-device sync (single device per identity)
- No conflict resolution for concurrent edits
- P2P connectivity depends on NAT traversal success
- Browser storage quotas vary (typically 10% of available disk)

### Planned Improvements
- Multi-device sync with change queue
- CRDT-based conflict resolution
- Enhanced NAT traversal strategies
- Storage quota monitoring + warnings

---

## Related Documentation
- [GOALS_VISION.md](./GOALS_VISION.md) - Mission and objectives
- [SECURITY_MODEL.md](./SECURITY_MODEL.md) - Security architecture
- [ROADMAP_PROJECTION.md](./ROADMAP_PROJECTION.md) - Future plans
