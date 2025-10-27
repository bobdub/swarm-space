# Imagination Network – Project Goals & Vision

_Last reviewed: 2024-11-02_

## 🎯 Mission
Build a decentralized, offline-first collaboration platform that keeps creators in control of their identities, content, and distribution.

---

## 🌟 Primary Goals

### 1. User Data Sovereignty
- Users own their identity keys and can export backups at any time.
- All content is encrypted client-side and stored locally first (`src/lib/fileEncryption.ts`).
- No central services store plaintext data; optional signalling servers see metadata only.
- Future: optional encrypted relay/backup services with user-provided keys.

### 2. Offline-First Operation
- Core features (identity, posts, projects, tasks, credits) operate without a network connection via IndexedDB.
- P2P sync is additive: broadcasting posts, requesting encrypted chunks, and discovering peers when connectivity exists.
- Planned: change queue + conflict resolution to support multi-device workflows.

### 3. Privacy by Design
- ECDH identities + AES-GCM wrapping keep private keys safe (`src/lib/crypto.ts`).
- File manifests store per-file keys and metadata in encrypted form.
- Presence tickets leverage Ed25519 when available (`src/lib/p2p/presenceTicket.ts`); fallbacks for unsupported runtimes are planned.
- Roadmap: signed posts/manifests for provenance, group key rotation, and moderation tools that respect privacy boundaries.

### 4. Decentralization Readiness
- PeerJS-backed WebRTC connections provide zero-config signalling today; the adapter in `src/lib/p2p/peerjs-adapter.ts` is ready for self-hosted endpoints.
- Rendezvous mesh, gossip, and peer exchange protocols (`src/lib/p2p/manager.ts`) keep the network alive without central servers.
- Next steps: connection approvals, block lists, and telemetry to support scaling the mesh responsibly.

### 5. Real-World Usability
- Familiar UI patterns: home feed, Explore, Planner, Tasks, Files, Notifications.
- Credits + hype provide lightweight incentives and tipping (`src/lib/credits.ts`).
- Backups and key management live in Settings with toasts for guidance.
- Upcoming: feed filters, Explore discovery, backup reminders, and accessibility passes.

---

## 🔐 Security Objectives

### Confidentiality
- ✅ Identity key wrapping with AES-GCM + PBKDF2.
- ✅ File chunk encryption with per-chunk IVs and SHA-256 addressing.
- 🔄 Group/project keys with rotation policies (Phase 4).
- 🔄 Optional encrypted relay/backup service.

### Integrity
- ✅ Hash-verified chunk retrieval.
- 🔄 Ed25519 signatures for posts/manifests.
- 🔄 Moderation tooling (flag/report) with signed events.

### Availability
- ✅ Local storage via IndexedDB with schema migrations.
- ✅ P2P chunk + post sync across peers when online.
- 🔄 Change queue with conflict detection for multi-device sync.
- 🔄 Storage quota monitoring and backup reminders.

### Recovery
- ✅ Manual export/import of account backups (`src/lib/auth.ts`).
- 🔄 Automated reminder flow for backups.
- 🔄 Social recovery / shared key escrow (long-term research).

---

## 🚀 Feature Goals Overview

| Phase | Focus | Status |
| --- | --- | --- |
| Phase 1 | Rich content authoring & feed polish | In progress (preview/filtering/trending outstanding) |
| Phase 2 | Planner & task workflows | Complete |
| Phase 3 | Profiles, discovery, and social graph | In progress (discovery, follow graph, moderation outstanding) |
| Phase 4 | Group encryption & shared projects | Planned |
| Phase 5 | P2P networking & rendezvous mesh | Core delivered, UX/telemetry enhancements underway |
| Phase 6 | Performance, sync, packaging | Planned |

---

## 📊 Success Metrics

### User Experience
- First post + peer connection achievable in <5 minutes from a clean install.
- Feed interactions respond in <100 ms locally; pagination keeps scroll smooth with 100+ posts.
- Backup reminder acknowledgement rate ≥ 90% of active users.
- Accessibility: progress toward WCAG 2.1 AA across primary flows.

### Security & Reliability
- Zero known data-loss incidents from IndexedDB migrations.
- 100% of shipped posts/manifests hash-verified on receipt.
- Connection approval acceptance/decline flows recorded for all new connections.

### Adoption
- Measure local metrics first: number of posts, projects, credits circulated per user session.
- Track P2P stats (connected peers, bytes served) once telemetry lands.
- Define external adoption targets after connection and discovery work stabilize.

---

## 🧭 Design Principles
- Keep encryption defaults on; optional conveniences must not weaken security.
- Prefer deterministic, inspectable local state over opaque remote services.
- Documentation should be actionable and versioned with the code—update alongside features.
- Build for resilience: degraded network, limited storage, and offline usage are the baseline.
