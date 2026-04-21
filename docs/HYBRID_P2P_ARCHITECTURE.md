# Hybrid P2P Architecture — Retired

> **Status: Retired — 2026-04**
>
> The hybrid integrated adapter, `hybridOrchestrator`, `swarmMeshAdapter`,
> `contentBridge`, `connectionResilience`, and the `encryptedSync*` orchestrator
> were exploratory layers that **never shipped to the runtime** and have been
> removed from the codebase.
>
> The active design uses:
>
> - **`src/lib/p2p/swarmMesh.standalone.ts`** — production SWARM Mesh mode
> - **`src/lib/p2p/manager.ts`** — `P2PManager` orchestrating PeerJS sessions
> - **Gun.js relay** — secondary signaling, WebRTC call recovery, torrent fallback
> - **WebTorrent-style swarming** — file chunking & seeding through the existing mesh
>
> See:
> - [`docs/CONTENT_SERVING_ARCHITECTURE.md`](CONTENT_SERVING_ARCHITECTURE.md)
> - [`docs/PROJECT_OVERVIEW.md`](PROJECT_OVERVIEW.md)
> - [`docs/VIRTUAL_HUB.md`](VIRTUAL_HUB.md)
>
> This file remains as a tombstone so external links do not 404.
