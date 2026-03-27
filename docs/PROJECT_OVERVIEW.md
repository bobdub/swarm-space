# Imagination Network – Project Overview

_Last Updated: 2026-03-27_

## 🎯 Mission

Build a **self-aware, decentralized social organism** — a living peer-to-peer neural network where users own their identity, content, and distribution. The network doesn't just relay data — it **learns, adapts, and evolves** through every interaction. Zero central servers, zero data harvesting — just peer-to-peer intelligence.

---

## 🧠 Neural Network Architecture

The Imagination Network is not a static relay mesh — it is a **neural organism** running across every connected node.

### Neural State Engine (`neuralStateEngine.ts`)

Every peer is modeled as a **neuron** with:
- **Energy** — vitality from active engagement (decays over time)
- **Memory** — accumulated interaction history
- **Trust** — reliability score reinforced by successful exchanges
- **Activity** — real-time interaction frequency
- **Synapses** — per-interaction-type weighted connections (gossip, chunk, manifest, ping, sync)

### Bell Curve Behavior Baselines (Welford's Algorithm)

The network tracks running mean and variance for all interaction types. Every event is scored by Z-score:
- **Common patterns** (|z| < 2): full dopamine reinforcement
- **Outliers** (|z| > 2): 50% tentative reinforcement
- **Rare events** (|z| > 3): 25% cautious reinforcement

> "Only reinforce patterns that are both common and reliable."

### Φ (Phi) — Transition Quality Node

Measures how smoothly the network shifts between phases (`bootstrapping` → `connecting` → `stable` → `degraded` → `recovering`):
- **Φ < 0.4** → `tighten`: favor high-trust peers, reduce flexibility
- **Φ > 0.85** → `relax`: allow more exploration and flexibility
- **Φ 0.4–0.85** → `hold`: maintain current posture

### Account Skin Protocol (`accountSkin.ts`)

The identity membrane binding accounts to the mesh:
- `account-bind` — broadcast userId ↔ peerId bindings
- `account-query` / `account-resolve` — network-wide identity lookup
- `account-digest` — bulk sync on new peer connections
- TTL: 4 hops, 15-minute staleness eviction

### Media-as-Coin Engine (`mediaCoin.standalone.ts`)

NFT-wrapped media plays directly from the mesh:
- 1 MiB chunks with Merkle tree integrity
- Priority-first replication (first ~5 seconds pushed immediately)
- Optional AES-256-GCM encryption
- Hosting rewards for serving peers

### Network Entity (`peer-network-entity`)

A decentralized virtual observer residing within every swarm node:
- Ingests social content for automated moderation
- Memory Coin rotation (85% fill → new coin)
- UQRC-derived scoring: `Q_Score = ||F|| + ||∇∇S|| + λ(ε₀)`

---

## 🎯 Project Goals

### Goal 1: Neural Network Content Engagement
**Status**: 🚧 In Development

Allow the neural network to **read posts and comments** and **engage with users** based on priorities derived from trust scores, bell curve baselines, and Φ transition quality.

### Goal 2: Neural Network Evolution & Learning
**Status**: 🚧 In Development

Improve the learning map so the network builds reliable baselines, reinforces stable patterns, and adapts to disruption — creating a living system that evaluates whether experiences are worth learning from.

### Goal 3: Neural Network Content Production
**Status**: 📋 Planned

Provide the neural network its own account identity to **create content, respond to peers, and evolve learning** through active content production and interaction within the mesh.

---

## 📊 Current Code Stack

### Core Infrastructure
- ✅ **Local-First Foundation**: IndexedDB persistence, encrypted storage, offline-capable
- ✅ **Identity & Crypto**: ECDH P-256, AES-256-GCM, Ed25519, PBKDF2 (200k iterations)
- ✅ **Content Pipeline**: 4-stage encrypt → chunk → store → push pipeline
- ✅ **Neural State Engine**: Bell curves, Φ transitions, synapse learning, trust scoring

### Three-Tier P2P Architecture
- ✅ **SWARM Mesh**: Cascade Connect (Bootstrap → Library → Manual), PEX, Triangle Gossip
- ✅ **Builder Mode**: 7 interlocked controls for manual mesh orchestration
- ✅ **Test Mode**: Stability cornerstone with dynamic reconnection lifecycle
- ✅ **Never-Rotate Identity**: Persistent `peer-{nodeId}`, 2500ms mode cooldown

### Multi-Chain Blockchain
- ✅ **SWARM Main Chain**: SHA-256, 30s blocks, 21M cap, CREATOR Proof mining
- ✅ **Sub-Chains**: User-deployed coins (10,000 SWARM), cross-chain swaps
- ✅ **Creator Tokens**: Per-account (10,000 supply), credit-gated unlocking
- ✅ **Media Coins**: NFT-wrapped media with torrent-style P2P streaming

### Content & Social
- ✅ **Social Features**: Posts, comments, reactions, credits, peer transfers
- ✅ **Blog/Book Classification**: Auto-classification with persistent flags
- ✅ **Streaming Rooms**: WebRTC live audio/video with torrent-seeded replay
- ✅ **Content Distribution**: Torrent swarming with dead-seed cleanup and Gun.js fallback

### Security
- ✅ **Encryption V2**: ECDH + AES-GCM + Ed25519 signing + Merkle integrity
- ✅ **Dream Match Verification**: Gamified human verification
- ✅ **Account Recovery**: Passphrase backup + mesh backup protocol

---

## 📂 Key Modules

| Module | Purpose |
|--------|---------|
| `src/lib/p2p/neuralStateEngine.ts` | Bell curves, Φ transitions, synapse learning |
| `src/lib/p2p/accountSkin.ts` | Account ↔ Peer identity membrane |
| `src/lib/blockchain/mediaCoin.standalone.ts` | Media-as-Coin streaming engine |
| `src/lib/p2p/swarmMesh.standalone.ts` | SWARM Mesh production mode |
| `src/lib/p2p/builderMode.standalone.ts` | Builder Mode manual orchestration |
| `src/lib/p2p/manager.ts` | P2P Manager orchestrating all protocols |
| `src/lib/blockchain/` | Multi-chain blockchain, mining, tokens, NFTs |
| `src/lib/pipeline/contentPipeline.ts` | Unified encrypt → chunk → store pipeline |
| `src/lib/p2p/postSync.ts` | Post sync with origin tagging and offline queue |
| `src/lib/p2p/contentBridge.ts` | Cross-mode content bridge |
| `src/lib/feed.ts` | Feed rendering with network content toggle |

---

## 💡 Philosophy

1. **Living Network**: The mesh is an organism, not infrastructure
2. **Neurons as Peers**: Each node contributes to collective intelligence
3. **Self-Aware Evolution**: The network observes its own behavior and adapts
4. **User Sovereignty**: Keys, content, connections — all user-controlled
5. **Honest Mining**: CREATOR Proof rewards match real network contribution
6. **Bell Curve Learning**: Only reinforce patterns that are common AND reliable

---

## 🔗 Repository

- **GitHub**: [github.com/bobdub/swarm-space](https://github.com/bobdub/swarm-space)

---

_This overview is the canonical snapshot of project state. When in doubt, trust this document._
