# Imagination Network – Project Overview & Status

_Last Updated: 2025-11-02_

## 🎯 Mission

Build a **decentralized, offline-first collaboration platform** where users own their identity, content, and distribution. Zero central servers, zero data harvesting—just peer-to-peer creativity and sovereignty.

---

## 📊 Current State

### What's Working (Production-Ready)
- ✅ **Local-First Foundation**: IndexedDB persistence, encrypted storage, offline-capable
- ✅ **Identity & Crypto**: ECDH key generation, AES-GCM encryption, passphrase-protected keys
- ✅ **Content Creation**: File chunking, manifest storage, encrypted attachments
- ✅ **Social Features**: Posts, comments, reactions, notifications, credit system
- ✅ **Project Management**: Tasks, milestones, kanban boards, calendar
- ✅ **P2P Networking (PeerJS)**: WebRTC connections, chunk protocol, peer discovery
- ✅ **Rendezvous Mesh**: Ed25519 presence tickets, beacon/capsule discovery
- ✅ **Integrated Transport**: WebTorrent DHT + GUN signaling + WebRTC (NEW)

### In Active Development
- 🚧 **GUN Signaling Hardening**: Adding timeouts, retries, and connection cleanup
- 🚧 **Feed Polish**: Filtering, pagination, preview improvements
- 🚧 **Discovery Enhancement**: Explore tabs, trending, user search
- 🚧 **Comment Moderation**: Deletion, flagging, count synchronization

### Planned (Not Started)
- 🔐 **Group Encryption**: Project key distribution, shared encryption
- 🌐 **Multi-Device Sync**: CRDT/vector clock change log
- 📱 **Platform Expansion**: Desktop (Tauri), mobile PWA optimization
- 🔒 **Account Recovery**: Shamir secret sharing, distributed backup

---

## 🏗️ Architecture

### Tech Stack
- **Frontend**: React 18 + Vite + TypeScript + Tailwind CSS
- **State**: React Query, IndexedDB (local-first)
- **Crypto**: Web Crypto API (ECDH, AES-GCM, PBKDF2, Ed25519)
- **P2P**: PeerJS (WebRTC), WebTorrent (DHT), GUN.js (mesh signaling)
- **UI**: Radix UI primitives (shadcn)

### Transport Layer Evolution

```
┌─────────────────────────────────────────────────────┐
│  Application Layer (Posts, Files, Messages)         │
└────────────────────┬────────────────────────────────┘
                     │
     ┌───────────────┴────────────────┐
     │     Transport Abstraction       │
     │  (unified message interface)    │
     └───────────────┬────────────────┘
                     │
    ┌────────────────┼────────────────┐
    │                │                │
┌───▼───┐      ┌────▼─────┐    ┌────▼──────┐
│PeerJS │      │  GUN.js  │    │WebTorrent │
│(prod) │      │(signaling)│   │   (DHT)   │
└───┬───┘      └────┬─────┘    └────┬──────┘
    │               │               │
    └───────────────┴───────────────┘
              WebRTC DataChannel
           (direct peer-to-peer)
```

**Transport Modes:**
1. **PeerJS Mode** (default): Centralized signaling, proven reliability
2. **Integrated Mode** (experimental): WebTorrent DHT discovery → GUN signaling → WebRTC data channels → GUN fallback relay

Users can toggle between modes via the P2P status indicator.

---

## 🔐 Security Model

### Encryption Layers
1. **Identity Keys**: ECDH P-256, private key wrapped with PBKDF2 (200k iterations)
2. **File Encryption**: AES-GCM 256-bit per file, 64KB chunks with unique IVs
3. **Content Addressing**: SHA-256 hashes for chunk references
4. **Presence Tickets**: Ed25519 signatures for rendezvous mesh

### Privacy Principles
- Keys never leave device unless explicitly exported
- No plaintext user data on servers
- Optional rendezvous beacons see only signed PeerJS IDs
- End-to-end encryption for all content

---

## 📂 Code Organization

### Key Modules
- **`src/lib/auth.ts`**: Identity, passphrase, key wrapping
- **`src/lib/crypto.ts`**: Crypto primitives (ECDH, AES-GCM, hashing)
- **`src/lib/fileEncryption.ts`**: Chunk encryption pipeline
- **`src/lib/store.ts`**: IndexedDB wrapper (v6 schema)
- **`src/lib/p2p/manager.ts`**: P2P orchestration, transport selection
- **`src/lib/p2p/transports/`**: PeerJS, GUN, WebTorrent adapters
- **`src/lib/credits.ts`**: Economic system (rewards, transfers)
- **`src/lib/projects.ts`**: Collaboration, tasks, milestones

### UI Structure
- **`src/pages/`**: Top-level routes (Index, Explore, Profile, etc.)
- **`src/components/`**: Domain widgets (PostCard, PeerConnectionManager)
- **`src/components/ui/`**: Radix/shadcn primitives
- **`src/contexts/`**: React contexts (P2PContext, OnboardingContext)
- **`src/hooks/`**: Custom hooks (useP2P, useAuth, useCreditBalance)

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
- Optional: Self-host PeerJS signaling server

### Infrastructure
- **Rendezvous Beacons**: Cloudflare Workers (Durable Objects)
- **Static Capsules**: GitHub Pages, IPFS, or CDN
- **PeerJS Signaling**: Public cloud or self-hosted

---

## 🐛 Known Issues & Limitations

### P2P Connectivity
- ❗ **NAT Traversal**: Symmetric NAT may block direct connections (TURN server recommended)
- ❗ **Browser Restrictions**: Some mobile browsers limit background WebRTC
- ❗ **GUN Signaling**: New timeout/retry logic still stabilizing (see integratedAdapter.ts)

### Data & Storage
- ⚠️ **IndexedDB Quotas**: Browsers enforce storage limits (typically 50% of disk)
- ⚠️ **No Backup Reminders**: Users must manually export keys/data
- ⚠️ **Migration Testing**: IndexedDB upgrades need more smoke tests

### UX Gaps
- ⚠️ **Feed Pagination**: Infinite scroll not implemented
- ⚠️ **Comment Moderation**: Soft delete doesn't update counts
- ⚠️ **Explore Placeholders**: Discovery tabs incomplete

---

## 🧭 Next Steps

### Immediate Priorities (Sprint 18-19)
1. **Finish GUN signaling hardening**: Validate timeout/retry logic, add connection cleanup
2. **Feed polish**: Add filters, preview, pagination to home feed
3. **Discovery UX**: Complete Explore tabs (People, Trending)
4. **Comment moderation**: Fix deletion workflow, synchronize counts

### Near-Term (Sprint 20+)
1. **Connection approvals**: Add request/approval flow, block controls
2. **Rendezvous telemetry**: Surface mesh health, fallback messaging
3. **Data safety**: Backup reminders, quota warnings, migration tests
4. **Self-hosting docs**: Guide for running own PeerJS/beacon infrastructure

### Long-Term Vision
1. **Group encryption**: Shared project keys, member invitations
2. **Multi-device sync**: CRDT-based change log, conflict resolution
3. **Platform expansion**: Tauri desktop, mobile PWA
4. **Distributed storage**: IPFS/Hypercore integration

---

## 📚 Related Documentation

### Strategic
- **Mission & Goals**: [`docs/Goals.md`](Goals.md)
- **Roadmap**: [`docs/ROADMAP.md`](ROADMAP.md)
- **Course of Action**: [`docs/COURSE_OF_ACTION.md`](COURSE_OF_ACTION.md)

### Technical
- **Architecture**: [`docs/ARCHITECTURE.md`](ARCHITECTURE.md)
- **P2P Mesh**: [`docs/P2P_RENDEZVOUS_MESH_PLAN.md`](P2P_RENDEZVOUS_MESH_PLAN.md)
- **Swarm Stability**: [`docs/P2P_SWARM_STABILIZATION_PLAN.md`](P2P_SWARM_STABILIZATION_PLAN.md)
- **Resilience**: [`docs/Resilience.md`](Resilience.md)

### Operational
- **Deployment**: [`docs/DEPLOYMENT_PLAN.md`](DEPLOYMENT_PLAN.md)
- **Stable Nodes**: [`docs/Stable-Node.md`](Stable-Node.md)
- **Credits Status**: [`docs/CREDITS_PHASE_6.1_STATUS.md`](CREDITS_PHASE_6.1_STATUS.md)

### Canonical Reference
- **Unified Source of Truth**: [`docs/Unified_Source_of_Truth.md`](Unified_Source_of_Truth.md)

---

## 🤝 Contributing

When working on this codebase:
1. **Check this overview first** for current state and priorities
2. **Follow existing patterns**: Look at similar components/modules
3. **Maintain offline-first**: Never assume network availability
4. **Preserve security**: Keys must never leak, always encrypt at rest
5. **Update docs**: Keep this overview in sync with major changes

---

## 🧪 Testing Strategy

### Current Coverage
- Unit tests for crypto primitives (`src/lib/crypto.ts`)
- Integration tests for rendezvous beacon (`services/rendezvous-beacon/tests/`)
- Manual QA for P2P connections, feed interactions

### Needs Improvement
- E2E tests for multi-peer scenarios
- IndexedDB migration smoke tests
- Offline/online transition testing
- Cross-browser WebRTC compatibility

---

## 💡 Philosophy & Principles

1. **Offline-First**: App works fully without network
2. **Zero-Knowledge**: Servers never see plaintext user data
3. **User Sovereignty**: Private keys, content, connections—all user-controlled
4. **Decentralization**: No single point of failure or control
5. **Composable Security**: Multiple encryption layers, defense-in-depth
6. **Creative Flux**: Adaptable, resilient, iterative evolution

---

## 📊 Metrics & Success Criteria

### Technical Health
- 🎯 P2P connection success rate: >90%
- 🎯 Time to first peer: <30 seconds
- 🎯 Rendezvous mesh uptime: >99.5%
- 🎯 IndexedDB migration success: 100%

### User Experience
- 🎯 Onboarding to first post: <5 minutes
- 🎯 Offline operation: Full feature parity
- 🎯 Cross-device sync: <10 second latency (when implemented)

### Platform Growth
- 🎯 Community-hosted beacons: 3+
- 🎯 Self-hosted signaling: Documented & reproducible
- 🎯 Active stable nodes: 10+

---

## 🔄 Maintenance

**Update this document when:**
- Major features ship or phases complete
- Architecture changes significantly
- New transport layers are added
- Security model evolves
- Deployment infrastructure changes

**Review cadence:** After each sprint, at minimum monthly.

**Document owner:** Release captain / product maintainers

---

_This overview is the canonical snapshot of project state. When in doubt, trust this document over older/fragmented docs._
