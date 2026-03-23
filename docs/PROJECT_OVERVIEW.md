# Imagination Network – Project Overview & Status

_Last Updated: 2026-03-23_

## 🎯 Mission

Build a **decentralized, offline-first social architecture** where users own their identity, content, and distribution. Zero central servers, zero data harvesting — just peer-to-peer creativity and sovereignty through the Imagination Network.

---

## 📊 Current State

### What's Working (Production-Ready)

#### Core Infrastructure
- ✅ **Local-First Foundation**: IndexedDB persistence, encrypted storage, offline-capable
- ✅ **Identity & Crypto**: ECDH key generation, AES-GCM encryption, Ed25519 signing, passphrase-protected keys (PBKDF2 200k iterations)
- ✅ **Encryption V2 Pipeline**: 4-stage pipeline — Sign/Encrypt → Chunk for Mesh → ECDH Transport → Local Signed Plaintext
- ✅ **Content Creation**: File chunking (64 KB), manifest storage, encrypted attachments, Merkle proof integrity

#### Three-Tier P2P Architecture
- ✅ **SWARM Mesh (Production)**: Three-phase Cascade Connect (Bootstrap → Library → Manual), PEX, Triangle Gossip, 10s presence broadcasts, Phase 1b retry for peer-unavailable errors
- ✅ **Builder Mode (Manual)**: Seven interlocked controls (Build a Mesh, Blockchain Sync, Auto-connect, Approve Only, Torrent Serving, Mining, Swarm Accept)
- ✅ **Test Mode (Stability Cornerstone)**: Dynamic reconnection lifecycle (15s → 30s → 60s), Connection Library, reference architecture for all modes
- ✅ **Never-Rotate Identity**: Persistent `peer-{nodeId}` across sessions, 2500ms mode-transition cooldown
- ✅ **Mutual Exclusivity**: Only one P2P mode runs at a time to prevent PeerJS ID collisions

#### Multi-Chain Blockchain
- ✅ **SWARM Main Chain**: SHA-256 blocks, Merkle roots, 30s block time, difficulty 4, 50 SWARM reward, halving at 210k blocks, 21M max supply
- ✅ **User-Deployed Sub-Chains (Coins)**: Deploy for 10,000 SWARM, independent ledger with chain ID tagging
- ✅ **Creator Tokens**: One per account, 10,000 max supply, 1,000 credits to deploy, 10 tokens per credit earned unlock rate
- ✅ **Credit Wrapping**: 100 credits = 1 SWARM via community pool
- ✅ **Cross-Chain Swaps**: 1:1 between sub-chains, 2:1 to SWARM
- ✅ **NFT Minting**: Posts, images, achievements, and badges wrappable as on-chain NFTs with rarity attributes
- ✅ **CREATOR Proof Mining**: Honest Mining gated by connectivity and content activity, hollow block 50% penalty, enriched broadcasts with mining-ack RTT
- ✅ **Auto-Mining Service**: Background mining while app is open
- ✅ **Quantum Metrics Panel**: Mining curvature visualization, daily burn tracking

#### Content & Social
- ✅ **Social Features**: Posts, comments, reactions, notifications, credit system, peer transfers
- ✅ **Blog/Book Classification**: Automatic — 1k+ chars with media/links = Blog, 250k+ chars = torrent-wrapped Book. Persistent `blogLocked` flag prevents reversion across peer sync
- ✅ **Blog Post Cards**: Hero image support, rich typography, sync-aware image loading with P2P retry
- ✅ **Streaming Rooms**: WebRTC live audio/video with invite controls, recording, torrent-seeded replay
- ✅ **Content Discovery**: Trending algorithms, explore feeds with filtering, peer-synced search
- ✅ **Project Management**: Tasks, milestones, kanban boards, calendar — encrypted and mesh-synced

#### Security & Onboarding
- ✅ **Dream Match Verification**: Gamified human verification without centralized CAPTCHA
- ✅ **Moderation Dashboard**: Peer scoring, alert summary cards, content flagging, node isolation
- ✅ **Onboarding Walkthrough**: Multi-step guided flow with browser detection and storage health checks
- ✅ **Account Recovery**: Passphrase backup, mesh backup protocol, full account export/import
- ✅ **Cookie Consent**: GDPR-compliant banner with granular storage preferences
- ✅ **Achievement Gallery**: Sigils, badge strips, NFT wrapping for accomplishments

### Planned (Not Started)
- 🔐 **Group Encryption**: Project key distribution, shared encryption for private channels
- 🌐 **Multi-Device Sync**: CRDT-based conflict-free editing across devices
- 📱 **Platform Expansion**: Desktop (Tauri), mobile PWA optimization with background sync
- 🌉 **External Bridges**: Cross-chain bridge to Ethereum, Solana
- 🖥️ **Persistent Relay Supernodes**: High-availability bootstrap infrastructure

---

## 🏗️ Architecture

### Tech Stack
- **Frontend**: React 18 + Vite + TypeScript + Tailwind CSS
- **State**: React Query, IndexedDB (local-first), Context API
- **Crypto**: Web Crypto API (ECDH P-256, AES-256-GCM, PBKDF2, Ed25519)
- **P2P**: PeerJS Standalone Scripts (WebRTC), Ed25519 presence tickets
- **UI**: Radix UI primitives (shadcn/ui)
- **Blockchain**: Custom client-side multi-chain (SWARM + user sub-chains)

### Three-Tier P2P Architecture

```
┌─────────────────────────────────────────────────────┐
│  Application Layer (Posts, Files, Streams, Mining)   │
└────────────────────┬────────────────────────────────┘
                     │
     ┌───────────────┴────────────────┐
     │     Mode Selection Gate        │
     │  (mutual exclusivity enforced) │
     └───────────────┬────────────────┘
                     │
    ┌────────────────┼────────────────┐
    │                │                │
┌───▼────┐     ┌────▼─────┐    ┌─────▼─────┐
│ SWARM  │     │ Builder  │    │   Test    │
│  Mesh  │     │   Mode   │    │   Mode    │
│(prod)  │     │(manual)  │    │(corner-   │
│        │     │          │    │ stone)    │
└───┬────┘     └────┬─────┘    └─────┬─────┘
    │               │                │
    └───────────────┴────────────────┘
         PeerJS WebRTC DataChannel
      Never-Rotate Identity (peer-{nodeId})
```

**SWARM Mesh Connectivity:**
- Cascade Connect: Bootstrap → Library → Manual
- PEX (Peer List Exchange) protocol
- Triangle Gossip for mesh density
- Phase 1b retry for signaling inconsistencies
- Hardcoded bootstrap nodes with hourly silent retry

### Encryption V2 Pipeline

```
Content → [Stage A: Sign + ECDH Encrypt]
        → [Stage B: 64KB Chunk + Merkle Proof]
        → [Stage C: Per-Peer ECDH Transport]
        → [Stage D: Local Signed Plaintext in IndexedDB]

Public content: Skip Stage A encryption, retain signing + chunking
```

### CREATOR Proof Mining

```
Mining Reward Gate:
  ├── Online + Active Peers?  → YES → Continue
  │                           → NO  → "Not Mining" status
  ├── Content Activity?       → YES → Full reward
  │                           → NO  → Hollow block (50% penalty)
  ├── Mesh Consensus?         → Majority peer votes confirm block
  └── 5% Pool Tax deducted from gross reward
```

---

## 🔐 Security Model

### Encryption Layers
1. **Identity Keys**: ECDH P-256, private key wrapped with PBKDF2 (200k iterations)
2. **File Encryption**: AES-GCM 256-bit per file, 64 KB chunks with unique IVs
3. **Content Addressing**: SHA-256 hashes for chunk references, Merkle proof verification
4. **Presence Tickets**: Ed25519 signatures for mesh identity
5. **Transport Encryption**: Per-peer ECDH key agreement for transit security

### Privacy Principles
- Keys never leave device unless explicitly exported
- No plaintext user data on servers
- End-to-end encryption for all private content
- Optional rendezvous beacons see only signed PeerJS IDs
- Blog/Book flags persist locally — classification data never leaked

---

## 📂 Code Organization

### Key Modules
- **`src/lib/auth.ts`**: Identity, passphrase, key wrapping
- **`src/lib/crypto.ts`**: Crypto primitives (ECDH, AES-GCM, hashing)
- **`src/lib/fileEncryption.ts`**: Chunk encryption pipeline
- **`src/lib/store.ts`**: IndexedDB wrapper
- **`src/lib/p2p/testMode.standalone.ts`**: Test Mode (stability cornerstone)
- **`src/lib/p2p/swarmMesh.standalone.ts`**: SWARM Mesh production mode
- **`src/lib/p2p/builderMode.standalone.ts`**: Builder Mode manual orchestration
- **`src/lib/p2p/postSync.ts`**: P2P post synchronization with blog flag normalization
- **`src/lib/blockchain/`**: Multi-chain blockchain, mining, tokens, NFTs, swaps
- **`src/lib/blogging/awareness.ts`**: Blog/Book classification with persistent flags
- **`src/lib/credits.ts`**: Economic system (rewards, transfers, wrapping)
- **`src/lib/projects.ts`**: Collaboration, tasks, milestones

### UI Structure
- **`src/pages/`**: Top-level routes (Index, Explore, Profile, Wallet, NodeDashboard, etc.)
- **`src/components/`**: Domain widgets (PostCard, BlogPostCard, PeerConnectionManager)
- **`src/components/p2p/dashboard/`**: Node dashboard panels (Mesh, Signaling, Blocklist, Transport)
- **`src/components/wallet/`**: Wallet panels (Mining, NFT, CoinDeployment, CrossChainSwap)
- **`src/components/streaming/`**: Live streaming room components
- **`src/components/ui/`**: Radix/shadcn primitives
- **`src/contexts/`**: React contexts (P2PContext, OnboardingContext, StreamingContext)
- **`src/hooks/`**: Custom hooks (useP2P, useAuth, useCreditBalance, useStreaming)

---

## 🚀 Deployment & Operations

### Development
```bash
npm install
npm run dev  # Vite dev server on :5173
```

### Production
- Static build via `npm run build`
- Deploy to any CDN/static host
- No backend required (peer-to-peer only)
- Hardcoded bootstrap nodes for initial mesh connectivity

### Infrastructure
- **Bootstrap Nodes**: Hardcoded peer IDs for Cascade Connect Phase 1
- **PeerJS Signaling**: PeerJS Cloud (public) with Phase 1b retry for availability
- **Static Capsules**: GitHub Pages or CDN for capsule distribution

---

## 🐛 Known Issues & Limitations

### P2P Connectivity
- ❗ **NAT Traversal**: Symmetric NAT may block direct connections (TURN server recommended)
- ❗ **Browser Restrictions**: Some mobile browsers limit background WebRTC
- ❗ **PeerJS Cloud**: Signaling inconsistencies addressed by Phase 1b retry but not eliminated

### Data & Storage
- ⚠️ **IndexedDB Quotas**: Browsers enforce storage limits (typically 50% of disk)
- ⚠️ **Migration Testing**: IndexedDB upgrades need more smoke tests

---

## 🧭 Roadmap

### Near-Term
1. **Group encryption**: Shared project keys, member invitations
2. **Multi-device sync**: CRDT-based change log, conflict resolution
3. **Persistent relay supernodes**: High-availability bootstrapping

### Long-Term
1. **External blockchain bridges**: Ethereum, Solana cross-chain
2. **Tauri desktop application**: Native OS integration
3. **Mobile PWA optimization**: Background sync, push notifications
4. **Distributed storage**: IPFS/Hypercore integration

---

## 💡 Philosophy & Principles

1. **Offline-First**: App works fully without network
2. **Zero-Knowledge**: Servers never see plaintext user data
3. **User Sovereignty**: Private keys, content, connections — all user-controlled
4. **Decentralization**: No single point of failure or control
5. **Honest Mining**: CREATOR Proof ensures rewards match real network contribution
6. **Composable Security**: Multiple encryption layers, defense-in-depth
7. **Persistent Identity**: Blog flags, peer IDs, and classifications — once set, never downgraded

---

## 📊 Metrics & Success Criteria

### Technical Health
- 🎯 P2P connection success rate: >90%
- 🎯 Time to first peer: <30 seconds via Cascade Connect
- 🎯 Blog classification persistence: 100% across sync
- 🎯 IndexedDB migration success: 100%

### User Experience
- 🎯 Onboarding to first post: <5 minutes (walkthrough-guided)
- 🎯 Offline operation: Full feature parity
- 🎯 Blog rendering consistency: Identical across all peers

### Platform Growth
- 🎯 Active bootstrap nodes: 7 hardcoded
- 🎯 Multi-chain deployments: Unlimited user sub-chains
- 🎯 Creator token economy: Self-sustaining credit/SWARM cycle

---

## 🔄 Maintenance

**Update this document when:**
- Major features ship or phases complete
- Architecture changes significantly
- New P2P modes or blockchain features are added
- Security model or encryption pipeline evolves

**Review cadence:** After each sprint, at minimum monthly.

**Document owner:** Release captain / product maintainers

---

_This overview is the canonical snapshot of project state. When in doubt, trust this document over older/fragmented docs._
