# Next Steps – Imagination Network

_Last Updated: 2025-11-02_

This document tracks immediate, near-term, and long-term action items. For strategic context, see [`PROJECT_OVERVIEW.md`](PROJECT_OVERVIEW.md).

---

## 🔥 Immediate Actions (Sprint 18)

### 1. GUN Signaling Stabilization
**Status**: 🚧 In Progress  
**Owner**: Core team  
**Target**: Week 1

**Tasks:**
- [x] Add timeout handling to SignalingBridge (15s default)
- [x] Implement retry logic (max 2 retries)
- [x] Add connection cleanup on WebRTC failure
- [ ] Test integrated transport with 5+ concurrent peers
- [ ] Validate timeout recovery under poor network conditions
- [ ] Add diagnostic metrics to P2P dashboard

**Files:**
- `src/lib/p2p/transports/signalingBridge.ts`
- `src/lib/p2p/transports/integratedAdapter.ts`

**Acceptance:**
- GUN signaling attempts time out within 15 seconds
- Failed connections clean up properly (no zombie peers)
- Retry mechanism logs clearly visible in console
- Connection state accurately reflected in UI

---

### 2. Feed Polish
**Status**: 🚧 Not Started  
**Owner**: Frontend team  
**Target**: Week 1-2

**Tasks:**
- [ ] Add post type filters (All/Images/Videos/Links) to Index.tsx
- [ ] Implement infinite scroll with React Query
- [ ] Add post preview modal before publish
- [ ] Show loading skeletons during fetch
- [ ] Preserve scroll position on back navigation

**Files:**
- `src/pages/Index.tsx`
- `src/components/PostCard.tsx`
- `src/lib/posts.ts`

**Acceptance:**
- Users can filter feed by content type
- Feed loads more posts automatically when scrolling
- Preview accurately reflects final post appearance
- No layout shift during content loading

---

### 3. Explore Discovery
**Status**: 🚧 Not Started  
**Owner**: Frontend team  
**Target**: Week 2

**Tasks:**
- [ ] Replace "People" tab placeholder with user search
- [ ] Implement trending algorithm (credits + reactions)
- [ ] Add "Trending Posts" and "Active Users" tiles
- [ ] Wire up search.ts to Explore UI
- [ ] Add empty states for zero results

**Files:**
- `src/pages/Explore.tsx`
- `src/lib/search.ts`
- `src/lib/postMetrics.ts`

**Acceptance:**
- People tab shows searchable user list
- Trending shows most engaged content (last 7 days)
- Search returns results within 200ms
- Empty states guide users clearly

---

## 🎯 Near-Term Priorities (Sprint 19-20)

### 4. Connection Approvals
**Status**: 🔜 Planned  
**Target**: Sprint 19

**Tasks:**
- [ ] Add connection request queue to store.ts
- [ ] Build approval/block UI in PeerConnectionManager
- [ ] Implement "I Accept" toggle logic
- [ ] Add notification for incoming requests
- [ ] Persist blocked peer list

**Acceptance:**
- Users must approve new connections explicitly
- Blocked peers cannot reconnect
- Approval state persists across sessions

---

### 5. Rendezvous Telemetry
**Status**: 🔜 Planned  
**Target**: Sprint 19

**Tasks:**
- [ ] Surface mesh health in P2P status popover
- [ ] Show last sync timestamp and failure count
- [ ] Add beacon latency metrics
- [ ] Implement Ed25519 fallback detection
- [ ] Create diagnostics export (JSON)

**Acceptance:**
- Users can see mesh status at a glance
- Diagnostics panel shows full connection history
- Support team can debug issues from exported data

---

### 6. Data Safety
**Status**: 🔜 Planned  
**Target**: Sprint 20

**Tasks:**
- [ ] Add backup reminder (monthly modal)
- [ ] Show storage quota warnings (IndexedDB)
- [ ] Implement key export workflow
- [ ] Build data export (JSON + files)
- [ ] Create IndexedDB migration smoke tests

**Acceptance:**
- Users prompted to back up keys regularly
- Quota warnings appear before 90% full
- Exported data can restore full state
- Migration tests run in CI

---

## 🚀 Long-Term Roadmap (Q1 2025+)

### 7. Group Encryption (Phase 4)
**Status**: 📋 Backlog

**Vision:**
Shared project keys enable true collaborative encryption. Each project member receives a wrapped copy of the project key, encrypted with their public key.

**Key Work:**
- Project key generation and rotation
- Member invitation flow
- Per-user key wrapping
- Audit log for key events
- Manifest encryption with project keys

**Prerequisites:**
- Identity recovery system (Shamir secret sharing)
- Robust multi-device sync

---

### 8. Multi-Device Sync (Phase 6)
**Status**: 📋 Backlog

**Vision:**
Users can work across devices seamlessly. Changes propagate via P2P mesh with CRDT-based conflict resolution.

**Key Work:**
- Change log design (vector clocks or Merkle clock)
- CRDT implementation for posts/projects
- Sync protocol over P2P channels
- Device pairing workflow
- Conflict resolution UI

**Prerequisites:**
- Stable P2P mesh (rendezvous + integrated transport)
- Identity recovery

---

### 9. Platform Expansion (Phase 6)
**Status**: 📋 Backlog

**Vision:**
Native-feeling apps on desktop and mobile, with offline-first parity.

**Key Work:**
- Tauri desktop wrapper (Linux, macOS, Windows)
- Mobile PWA optimization (install prompts, notifications)
- Platform-specific shortcuts and integrations
- Performance tuning (virtualized feeds, workerized crypto)

**Prerequisites:**
- Mature web app (all core features shipped)
- Accessibility audit complete

---

### 10. Distributed Storage Integration
**Status**: 💭 Research

**Vision:**
Optional IPFS/Hypercore backends for content distribution beyond peer-to-peer.

**Key Work:**
- Content-addressed manifest compatibility
- Gateway/pinning service integration
- Hybrid local+distributed storage
- Cost/performance analysis

**Prerequisites:**
- Proven P2P chunk protocol
- Community demand signal

---

## 🧪 Research & Experiments

### Ongoing Experiments
Located in `experiments/` directory:

1. **DHT Simulation** (`experiments/dht/`)
   - Custom DHT routing without WebTorrent
   - Status: Prototype, not integrated

2. **GUN Overlay** (`experiments/gun/`)
   - Pure GUN mesh without PeerJS
   - Status: Proof-of-concept

3. **Offline Sync** (`experiments/offline-sync/`)
   - Change queue and conflict resolution
   - Status: Design phase

4. **Supernode Election** (`experiments/supernode/`)
   - Stable peer coordination
   - Status: Early prototype

5. **WebTorrent Bridge** (`experiments/webtorrent/`)
   - DHT-only peer discovery
   - Status: Validated, now in integratedAdapter

**How to run experiments:**
```bash
cd experiments/<name>
npm install
npm run dev
```

**Graduation criteria:**
- Proven stability in production-like conditions
- Clear performance/reliability wins
- Documented integration path
- Community testing complete

---

## 🔧 Technical Debt

### High Priority
1. **IndexedDB Migration Tests**: Automated smoke tests for schema upgrades
2. **WebRTC Connection Cleanup**: Ensure no zombie connections on failure
3. **Error Boundary Coverage**: Add boundaries to all major components
4. **Crypto Module Splitting**: Separate Ed25519, ECDH, AES concerns

### Medium Priority
1. **Component Size Refactoring**: Break down 500+ line components
2. **Type Safety Audit**: Fix remaining `any` types in adapters
3. **Performance Profiling**: Identify render bottlenecks in feed
4. **Accessibility Pass**: WCAG 2.1 AA compliance

### Low Priority
1. **CSS Consolidation**: Reduce duplicate Tailwind classes
2. **Bundle Optimization**: Tree-shake unused Radix components
3. **Test Coverage**: Increase unit test coverage above 60%

---

## 📋 Checklist Template

When picking up a task:
- [ ] Read relevant documentation (ARCHITECTURE.md, PROJECT_OVERVIEW.md)
- [ ] Check existing code patterns in similar features
- [ ] Write failing tests first (if applicable)
- [ ] Implement with offline-first mindset
- [ ] Add error handling and user feedback
- [ ] Update relevant docs
- [ ] Test across browsers (Chrome, Firefox, Safari)
- [ ] Submit PR with clear description

---

## 🤝 How to Contribute

**For new contributors:**
1. Start with "good first issue" label in GitHub/docs
2. Join community chat (if available) to discuss approach
3. Follow existing code style and patterns
4. Ask questions early—no question is too small

**For core team:**
1. Review this doc weekly, update as priorities shift
2. Move completed items to changelog/release notes
3. Keep PROJECT_OVERVIEW.md in sync with reality
4. Celebrate wins, learn from blockers

---

## 📅 Review Cadence

- **Daily standups**: Sync on immediate sprint work
- **Weekly grooming**: Reprioritize near-term tasks
- **Monthly planning**: Adjust long-term roadmap
- **Quarterly retrospective**: Evaluate architecture, refactor debt

---

_This document complements PROJECT_OVERVIEW.md with actionable next steps. When in doubt about "what to build," start here._
