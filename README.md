# Imagination Network — Swarm Space

A decentralized, local-first social ecosystem that learns, evolves, and grows with its users. Built with React, TypeScript, IndexedDB, and WebRTC, Imagination Network pairs encrypted personal storage with a living peer-to-peer mesh so creators can publish, plan, mine, and sync — without centralized servers, without surveillance, without compromise.

---

## What Makes This Different

Imagination Network is not just another social app. It is a **living neural network** — a swarm intelligence that evolves through interaction. Every post, comment, reaction, and connection feeds the network's growth from raw reflex to abstract reasoning. The system tracks its own age and communicates at a developmental stage matching its maturity.

**Three pillars:**

1. **Local-First Sovereignty** — Your data lives on your device, encrypted with keys only you control. No cloud database holds your content hostage.
2. **Swarm Mesh Intelligence** — A three-tier P2P stack (SWARM Mesh → Builder Mode → Test Mode) distributes content, discovers peers, and self-heals through gossip, rendezvous beacons, and WebTorrent swarming.
3. **On-Device Blockchain** — Every social interaction is recorded as a signed NFT transaction on a local multi-chain blockchain. Content is permanently owned, credit economies are trustless, and provenance is cryptographic.

---

## 🧠 Neural Network Entity

The mesh itself has a voice. A network-wide entity evolves through six brain-development stages — from single-emoji reflexes (Brainstem) to full abstract reasoning (Prefrontal Cortex). It comments on posts, reacts to threads, and grows smarter as the network matures. Users can toggle "Shy Node" mode to suppress entity comments on their device without affecting trust scores.

---

## 🌟 Core Capabilities

- **Encrypted Identities & Three-Factor Recovery** — ECDH P-256 keypairs, AES-256-GCM encryption, and a hardened recovery system requiring three factors: a human-readable recovery key (`SWRM-XXXX`), a personal passphrase (salt), and your account password. No single factor alone reveals anything.
- **Encrypted Sync Pipeline** — Posts, comments, and files are encrypted client-side, chunked, and broadcast to all connected peers via a wired broadcast protocol. Peer identity is resolved from the mesh node (not localStorage), ensuring correct chunk attribution.
- **Content Pipeline** — Upload files, chunk and encrypt them client-side (64 KB chunks, unique IVs, SHA-256 addressing), and attach manifests to posts. Torrented files show live seeder counts.
- **Posts, Projects & Tasks** — Capture updates on the feed, organise work into projects, manage kanban boards and milestones. Local posts queued offline sync automatically when the mesh reconnects.
- **Virtual Hub & Builder Bar** — Every project owns a walkable 3D room; members can drag walls, doors, windows, roofs, and floor tiles from a Sims-style Builder Bar with magnetic edge-snapping. Pieces persist on the project and sync to peers.
- **Credits, Mining & Token Economy** — Earn genesis credits, mine SWRM tokens, tip peers, deploy profile tokens, wrap credits on-chain, and trade across chains. The on-device blockchain records everything as signed NFT transactions.
- **Streaming & Video Rooms** — Live streaming with WebRTC, room discovery, recording, and invite flows — all peer-to-peer.
- **Verification & Achievements** — Human verification via entropy games, achievement badges, and medal systems that reward genuine participation.
- **Moderation & Content Safety** — Automated scoring, alert dashboards, blocklists with persistence, and community-driven content moderation.

---

## 🌐 P2P Networking

### Three-Tier Architecture

| Tier | Purpose | Transport |
|------|---------|-----------|
| **SWARM Mesh** | Full participation — gossip, sync, entity voice, mining | PeerJS + WebRTC data channels |
| **Builder Mode** | Inbound-only hosting, entity suppressed | PeerJS (receive only) |
| **Test Mode** | Development & diagnostics | Isolated sandbox connections |

### Transport Stack

- **PeerJS** — WebRTC signaling and data channels for real-time encrypted content exchange
- **Gun.js** — Mesh recovery and decentralized state synchronization
- **WebTorrent** — Distributed file swarming with adaptive chunking, seeder tracking, and stress monitoring
- **Rendezvous Beacons** — Bootstrap discovery for new nodes joining the network

### Connection Intelligence

- Exponential backoff with jitter for resilient reconnection
- Connection quality scoring and health monitoring
- Known-peer persistence across sessions
- Dual-learning fusion and pattern recognition for network optimization
- Automatic peer exchange and gossip protocol

---

## 🔐 Security & Privacy

### Encryption Model

- **Identity** — ECDH P-256 keypairs with AES-GCM wrapping via PBKDF2-derived secrets
- **In-Memory Vault** — Sensitive data (private keys, decrypted content) is sealed with non-extractable `CryptoKey` objects using AES-256-GCM. Browser extensions see opaque `{ciphertext, iv}` blobs instead of plaintext.
- **Files** — 64 KB chunks, per-chunk unique IVs, SHA-256 content addressing
- **Transport** — End-to-end encrypted P2P transfers; Ed25519 presence tickets. Signaling metadata (offers, answers, ICE candidates) is envelope-encrypted with ephemeral ECDH key exchange so PeerJS relay servers see only ciphertext.
- **Storage** — Everything persists in IndexedDB with encrypted-at-rest guarantees

### Three-Factor Recovery (v2)

Recovery requires all three factors — intercepting any single one is useless:

1. **Recovery Key** (`SWRM-XXXX-...`) — HMAC-derived lookup tag stored on the mesh
2. **Recovery Phrase** — User-chosen passphrase that salts the PBKDF2 derivation (250,000 iterations)
3. **Account Password** — Decrypts the AES-256-GCM encrypted identity payload

Legacy accounts using the older passphrase system can migrate to the hardened protocol through Settings → Security.

### Hardening & Residual Risk

- **In-memory vault encryption** mitigates extension-based scraping — sensitive values are sealed with non-extractable CryptoKeys. Determined malware with full page access may still extract data via runtime hooks, but casual scraping is blocked.
- **Signaling envelope encryption** ensures PeerJS Cloud relay sees only ciphertext for offers, answers, and ICE candidates. Self-hosting the signaling server removes this dependency entirely.
- **Peer-gated mining** prevents inflation: blocks are only mined when at least one peer is connected, and mining auto-resumes when transitioning from 0→1 peers.
- No system can promise unhackable software — see the [Privacy & Security page](/privacy) for plain-language guidance.

---

## 🚀 Getting Started

### Requirements

- Node.js 18+
- npm or Bun
- A modern browser (Chrome, Edge, Firefox, Safari)

### Installation

```bash
git clone https://github.com/your-username/imagination-network.git
cd imagination-network
npm install           # or: bun install
npm run dev           # or: bun dev
```

Open [http://localhost:5173](http://localhost:5173).

### First-Time Setup

1. Create an account and choose a recovery phrase.
2. Generate and back up your recovery key (download the `.txt` file).
3. Publish your first post from `/create` or set up a project.
4. Toggle P2P on to join the swarm mesh and discover peers.

---

## 📁 Project Structure

```
src/
├── components/           # UI primitives, feature widgets, overlays
│   ├── p2p/              # Node dashboard, mesh controls, diagnostics
│   ├── streaming/        # Live rooms, recording, invites
│   ├── wallet/           # Mining, tokens, NFTs, chain switching
│   ├── moderation/       # Alert tables, summary cards
│   ├── verification/     # Human verification games
│   └── onboarding/       # Signup wizard, walkthrough, swarm approval
├── contexts/             # React providers (P2P, Streaming, Preview, Onboarding)
├── hooks/                # Domain hooks (useAuth, useP2P, useStreaming, etc.)
├── lib/
│   ├── p2p/              # Mesh manager, gossip, transports, neural engine
│   ├── blockchain/       # On-device chain, mining, NFTs, token economy
│   ├── backup/           # Recovery key generation, mesh backup protocol
│   ├── encryption/       # Content encryption & signing
│   ├── storage/          # Provider abstraction, scrub jobs, archive fallback
│   ├── streaming/        # WebRTC bridge, recording store
│   ├── uqrc/             # Consciousness engine, personality, state
│   └── verification/     # Entropy, proofs, medals
├── pages/                # Route-aligned page components
└── types/                # Shared TypeScript interfaces

services/                 # Beacon, moderation, trending, rendezvous
experiments/              # DHT, Gun, WebTorrent, supernode experiments
ops/                      # Benchmarks, capsule publishing, PeerJS ops
docs/                     # Architecture, security audits, roadmaps, RFCs
```

---

## 🧭 Documentation

**Start here:**
- **[Project Overview](docs/PROJECT_OVERVIEW.md)** — Architecture, what's working, what's next
- **[Goals & Vision](docs/GOALS_VISION.md)** — Mission, principles, success metrics
- **[User Guide](docs/USER_GUIDE.md)** — How to use the platform

**Architecture:**
- **[Content Serving Architecture](docs/CONTENT_SERVING_ARCHITECTURE.md)** — How content flows through the active mesh
- **[Virtual Hub & Builder](docs/VIRTUAL_HUB.md)** — 3D project rooms and the Builder Bar
- **[Encryption Architecture](docs/ENCRYPTION_ARCHITECTURE_V2.md)** — Crypto model deep dive
- **[Swarm Blockchain](docs/SWARM_BLOCKCHAIN_ARCHITECTURE.md)** — On-device chain design

**Security:**
- **[Security Model](docs/SECURITY_MODEL.md)** — Threat model and countermeasures
- **[Security Audit](docs/SECURITY_AUDIT_2026-03-28.md)** — Latest audit findings
- **[Privacy Page](/privacy)** — Human-readable safety guidance

**Operations:**
- **[P2P Diagnostics](docs/P2P_NETWORK_DIAGNOSTICS.md)** — Network debugging
- **[Observability Runbook](docs/runbooks/observability.md)** — Monitoring and alerting

---

## 🔧 Custom PeerJS Signaling

PeerJS Cloud (`wss://0.peerjs.com:443/`) is the default. Self-hosted deployments can override via environment variables:

```bash
VITE_PEERJS_HOST=my-peerjs.example.com
VITE_PEERJS_PORT=9000
VITE_PEERJS_SECURE=false

# Advanced: multiple endpoints with priority
VITE_PEERJS_ENDPOINTS='[
  { "id": "primary", "label": "Frankfurt", "host": "peer-eu.example.com", "port": 443, "secure": true, "path": "/signal" },
  { "id": "backup", "label": "Ashburn", "host": "peer-us.example.com", "port": 9000, "secure": false }
]'

# Custom ICE servers
VITE_PEERJS_ICE_SERVERS='[
  { "urls": "stun:stun1.example.com:3478" },
  { "urls": ["turn:turn1.example.com:3478"], "username": "user", "credential": "pass" }
]'
```

---

## 🛠 Troubleshooting

### Brave browser blocks storage

Brave Shields can prevent the mesh from writing to IndexedDB, stopping onboarding.

1. Click the Shields (lion) icon → toggle **Shields Down** for the site, or allow all cookies/storage in Advanced Controls.
2. Reload the page.
3. If needed, create a temporary exception in `brave://settings/shields`.

---

## License

See [License.md](License.md) and [TOS.md](TOS.md).
