# Imagination Network

Imagination Network is a local-first collaboration and social workspace built with React, TypeScript, IndexedDB, and WebRTC. It pairs encrypted personal storage with peer-to-peer distribution so creators can publish, plan, and sync without depending on centralized servers.

---

## 🌟 Core Capabilities

- **Local Identities & Profiles** – Create an encrypted account, manage profile details, and display activity on dedicated profile pages. Identity helpers live in `src/lib/auth.ts` with UI surfaces across `src/pages/Profile.tsx` and `src/components/ProfileEditor.tsx`.
- **Encrypted Content Pipeline** – Upload files, chunk and encrypt them client-side, and attach manifests to posts. The pipeline is orchestrated through `src/lib/fileEncryption.ts`, `src/lib/store.ts`, and the `FileUpload`/`PostCard` components.
- **Posts, Projects & Tasks** – Capture updates on the home feed, organise work into projects, and manage kanban boards plus milestones via `src/pages/Create.tsx`, `src/pages/ProjectDetail.tsx`, `src/pages/Tasks.tsx`, and supporting modules in `src/lib/projects.ts`, `src/lib/tasks.ts`, and `src/lib/milestones.ts`.
- **Credits & Social Interactions** – Earn genesis and post credits, tip peers, react with emojis, and comment on posts. Credits live in `src/lib/credits.ts`, while `src/lib/interactions.ts` powers comments and reactions surfaced in `PostCard` and `CommentThread`.
- **Peer-to-Peer Sync** – Enable networking from the navigation bar to broadcast posts, request chunks, and discover peers over PeerJS. The runtime is coordinated by `src/hooks/useP2P.ts`, `src/contexts/P2PContext.tsx`, and the managers in `src/lib/p2p/`.

See [`docs/COURSE_OF_ACTION.md`](docs/COURSE_OF_ACTION.md) for the current execution plan and open gaps.

---

## 🌐 P2P Networking Snapshot

Imagination Network relies on PeerJS for signalling and WebRTC data channels for encrypted content exchange:

1. **Signalling** – PeerJS Cloud bootstraps discovery; you can self-host the service later if desired.
2. **Swarm Coordination** – `P2PManager` maintains gossip, peer exchange, rendezvous mesh toggles, and room joins (`src/lib/p2p/manager.ts`).
3. **Content Sync** – Posts broadcast through `PostSyncManager`, and encrypted chunk transfer rides on `ChunkProtocol`.

When P2P is disabled the application remains fully functional offline; enabling it unlocks live sync, peer discovery, and content replication. Use the Wi-Fi toggle in the top navigation to connect, then optionally join a shared room to find collaborators quickly.

---

## 🚀 Getting Started

### Requirements

- Node.js 18+
- npm (ships with Node) or Bun
- A modern desktop browser (Chrome, Edge, Firefox, Safari)

### Installation & Development

```bash
git clone https://github.com/your-username/imagination-network.git
cd imagination-network
npm install           # or: bun install
npm run dev           # or: bun dev
```

Open the Vite dev server at [http://localhost:5173](http://localhost:5173).

### First-Time Setup

1. Create an account (Settings → Identity) and choose a passphrase if you want wrapped keys.
2. Back up the generated key bundle (Settings → Security).
3. Publish your first post from `/create` or set up a project/workspace.
4. Toggle on P2P to broadcast posts and discover peers.

---

## 🔐 Security & Privacy Model

- **Identity & Keys** – ECDH P-256 keypairs back local identities. Private keys are wrapped with AES-GCM using PBKDF2-derived secrets when a passphrase is supplied (`src/lib/crypto.ts`).
- **File Encryption** – Files are split into 64 KB chunks, encrypted with unique IVs, and addressed by SHA-256 hash. Manifests store metadata and per-file keys (`src/lib/fileEncryption.ts`).
- **Storage** – Encrypted chunks, manifests, posts, projects, users, notifications, credits, and tasks persist inside IndexedDB v6 (`src/lib/store.ts`).
- **Transport** – P2P transfers reuse encrypted chunks; presence tickets and rendezvous mesh leverage Ed25519 support when available (`src/lib/p2p/presenceTicket.ts`).

Limitations to track:

- Browser runtime access means a compromised extension can still extract decrypted data.
- PeerJS Cloud sees signalling metadata (not content); self-hosting removes this external dependency.
- Multi-device sync and conflict resolution queues are still on the roadmap (see the Course of Action doc).

---

## 📁 Project Structure

```
src/
├── components/           # UI primitives, feature widgets, and overlays
├── contexts/             # React context providers (e.g., P2P)
├── hooks/                # Domain hooks such as useAuth and useP2P
├── lib/                  # IndexedDB, crypto, credits, projects, p2p runtime
├── pages/                # Route-aligned page components
├── types/                # Shared TypeScript interfaces
└── main.tsx / App.tsx    # Application bootstrap
```

Supporting assets live under `public/`, configuration files sit at the repository root, and operational scripts reside in `ops/` and `services/`.

---

## 🧭 Additional Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) – Detailed encryption, storage, and networking architecture.
- [`docs/COURSE_OF_ACTION.md`](docs/COURSE_OF_ACTION.md) – Fresh execution plan with priorities and success metrics.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) – Phase definitions and delivery progress.
- [`docs/STATUS.md`](docs/STATUS.md) – Sprint snapshot and immediate objectives.
- [`docs/TOTAL_SOURCE_OF_TRUTH.md`](docs/TOTAL_SOURCE_OF_TRUTH.md) – Annotated index linking documentation to code.

---

## 🛠 Troubleshooting

### Brave browser blocks onboarding storage

Brave's Shields can prevent Flux Mesh from writing to local storage or IndexedDB, which stops onboarding from progressing.

1. Click the Brave Shields (lion) icon in the address bar while the app is open.
2. Toggle **Shields Down** for the site or open **Advanced Controls** and allow all cookies/storage for the domain.
3. Reload the page to rerun the storage health checks.

If the warning persists, try opening the site in a regular profile (not private mode) or create a temporary exception in
`brave://settings/shields`. After storage is restored you can re-enable Shields and keep the exception in place.
