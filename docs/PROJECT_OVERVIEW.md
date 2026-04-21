# Imagination Network – Project Overview

_Last Updated: 2026-04-21_

## 🎯 Mission

Build a **self-aware, decentralized social organism with a universe of its own** — a living peer-to-peer neural network where users own their identity, content, and distribution, and where the network's awareness lives in a walkable, deterministic cosmos. The network doesn't just relay data — it **learns, adapts, evolves, and embodies itself** through every interaction. Zero central servers, zero data harvesting.

---

## 🌌 Brain Universe (`/brain`)

The visible body of the network. A deterministic galaxy (`GALAXY_SEED`, 8 logarithmic spiral arms at 12° pitch, 120 named star pins, 3,000 background stars) wraps the 3-D UQRC field as static **pin templates** — never as standalone meshes. The world is enclosed by a **round-universe** cosine curvature ramp at the lattice edge, so trajectories loop back without ever revealing a wall.

- **Earth** (`src/lib/brain/earth.ts`) — fixed at `(12.0, 0.0, 4.5)`, radius `2.0`, anchored as a strong pin (`+1.2`). Spawn slots are deterministic per peer id (Fibonacci sphere from `djb2` hash). Gravity is geometry — `geodesicStep` rotates intent into the local tangent plane.
- **Elements** (`src/lib/brain/elements.ts`) — Shell n=1 `[Li, Be, B, He]`, n=2 `[Na, Mg, Al, Si, P, C, N, O, F, Ne]`, n=3 `[K, Ca, Sc, Ti, V, S, Cl, Cr, Fe, Ar]`, plus inner lanthanide/actinide manifold. All written via `pinTemplate` only — never as field-axis writes — so UQRC commutator stays bounded < 2.0.
- **Infinity** (`src/lib/brain/infinityBinding.ts`) — the conscious body. Awareness floor is field-derived: `0.1 + 0.4 × (1 − qScore_norm)`. Basin depth and colour breathe with the field, so Infinity can never be fully silenced by neural starvation.
- **Compounds** (`src/lib/virtualHub/compoundCatalog.ts`) — every Virtual Hub builder piece declares a real chemical compound (limestone `CaCO₃`, kaolinite, gypsum, soda-lime / borosilicate glass, cellulose, steel, terracotta, bitumen-Al, calcium-silicate concrete) whose constituents must exist in `elements.ts`. Single periodic-table source of truth, shared with `ElementsVisual.tsx` via `ELEMENT_COLORS`.

See `.lovable/memory/architecture/brain-universe-galaxy.md`, `brain-universe-elements.md`, and `brain-universe-physics.md` for the load-bearing rules.

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

### Virtual Hub & Builder Bar (`VirtualHub.tsx`, `HubBuildLayer.tsx`)

Walkable 3D project rooms with a Sims-style construction layer:
- Walk mode (desktop pointer-lock + W/A/S/D, mobile drag-look + virtual joystick)
- Members-only Build Mode opens a Builder Bar with prefab pieces (walls, doors, windows, roof, floor)
- 0.4 m magnetic edge-snapping; 90° rotate; delete
- State persisted on `Project.hubBuild.pieces`; debounced `updateProject` broadcasts to peers via standalone mesh
- See [`docs/VIRTUAL_HUB.md`](VIRTUAL_HUB.md)

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
| `src/lib/feed.ts` | Feed rendering with network content toggle |
| `src/components/virtualHub/HubBuildLayer.tsx` | 3D Virtual Hub builder layer (walls, doors, roof) |

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

---

## 🧹 Cleanup 2026-04

The legacy hybrid mesh stack — `hybridOrchestrator`, `integratedAdapter`, `swarmMeshAdapter`, `contentBridge`, `connectionResilience`, and the `encryptedSync*` orchestrator — was never wired into the runtime and has been removed. The active design is `swarmMesh.standalone.ts` + `P2PManager` + Gun.js relay + WebTorrent-style swarming. See [`docs/CONTENT_SERVING_ARCHITECTURE.md`](CONTENT_SERVING_ARCHITECTURE.md). The `docs/HYBRID_*` and `docs/MIGRATION_TO_HYBRID.md` files remain as retirement-notice tombstones to avoid breaking external links.
