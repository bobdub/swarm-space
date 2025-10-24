# Imagination Network - Project Roadmap

## Vision
A decentralized social and project collaboration platform that operates offline-first, uses local encryption, and prepares for future P2P networking via WebRTC swarms.

---

## Phase 0: Foundation (✅ COMPLETE)
**Status:** Delivered ✅

### Completed Features
- ✅ Core UI scaffold (React + Vite + Tailwind)
- ✅ Dark-themed design system (deep indigo/cyan)
- ✅ Navigation structure (Home, Explore, Notifications, Planner, Tasks, Settings)
- ✅ IndexedDB wrapper for local storage
- ✅ Web Crypto API integration (ECDH key generation, AES-GCM encryption)
- ✅ Local identity creation with optional passphrase protection
- ✅ Account backup/restore functionality
- ✅ Data models (User, Post, Project, Task, Milestone)
- ✅ Basic UI components (PostCard, ProjectCard, TaskBoard, Navigation)
- ✅ Static pages (Index, Settings, Explore, Create, Tasks, Planner, Notifications)

---

## Phase 1: Content Creation & Management (🚧 IN PROGRESS - Sprint 1 Complete)
**Goal:** Enable users to create, store, and manage content locally with full encryption
**Status:** Sprint 1 ✅ | Sprint 2 🔄 | Sprint 3 📋

### 1.1 File Chunking & Encryption ✅
- [x] Implement `chunkAndEncryptFile()` function
- [x] Create file upload UI component with progress indicator
- [x] Store encrypted chunks in IndexedDB
- [x] Build manifest viewer to see stored files
- [x] Add file preview/download functionality (decrypt on-demand)

### 1.2 Rich Post Creation
- [ ] Integrate file upload into Create page
- [ ] Support multiple file types (images, videos, PDFs, documents)
- [ ] Add drag-and-drop upload interface
- [ ] Implement post preview before publishing
- [ ] Store posts with file manifest references in IndexedDB

### 1.3 Feed Enhancement
- [ ] Load real posts from IndexedDB on Index page
- [ ] Implement infinite scroll for posts
- [ ] Add filtering (All, Images, Videos, Links)
- [ ] Build trending algorithm (local engagement tracking)
- [ ] Add post interactions (like, comment, share placeholders)

### 1.4 Project Management
- [ ] Create Project detail page (`/project/:projectId`)
- [ ] Project creation flow
- [ ] Project feed (posts scoped to project)
- [ ] Member management UI (add/remove members)
- [ ] Project-specific file storage

---

## Phase 2: Planner & Task System (🚀 STARTING NOW)
**Goal:** Build functional project planning and task management tools
**Status:** Ready to begin - see docs/PHASE_2_PLAN.md

### 2.1 Planner/Calendar
- [ ] Month/week calendar view component
- [ ] Milestone creation and editing
- [ ] Drag-and-drop milestone scheduling
- [ ] Visual progress indicators
- [ ] Link milestones to tasks

### 2.2 Task Manager
- [ ] Enhanced kanban board with drag-and-drop
- [ ] Task creation modal with full fields
- [ ] Task assignment to users
- [ ] Due date management
- [ ] Task comments and activity log
- [ ] Task filtering and search

### 2.3 Offline Sync Queue
- [ ] Change event queue for offline edits
- [ ] Conflict detection system
- [ ] Implement basic CRDT or vector clock for tasks
- [ ] Sync status indicators in UI

---

## Phase 3: User Profiles & Social Features (👤 FUTURE)
**Goal:** Build out social networking capabilities

### 3.1 User Profiles
- [ ] Profile page (`/u/:username`)
- [ ] Profile editing (avatar, bio, display name)
- [ ] Personal feed on profile
- [ ] Project list on profile
- [ ] Profile key/identity information display

### 3.2 Social Interactions
- [ ] Implement post comments with threading
- [ ] emoji/reaction system
- [ ] Credit (hype posts credit system)
- [ ] entangle (post notifications) system (local tracking)
- [ ] Notifications for interactions
- [ ] Activity feed on Notifications page

### 3.3 Search & Discovery
- [ ] Full-text search across posts and projects
- [ ] User search
- [ ] Tag system for categorization
- [ ] Trending tags display
- [ ] Category browsing on Explore page

---

## Phase 4: Group Encryption & Shared Projects (🔐 FUTURE)
**Goal:** Enable secure collaboration within project groups

### 4.1 Group Key Management
- [ ] Generate project-level symmetric keys
- [ ] Encrypt project key with each member's public key
- [ ] Member invitation flow with key distribution
- [ ] Key rotation on member removal
- [ ] Access control list (ACL) for projects

### 4.2 Encrypted Project Content
- [ ] Encrypt all project files with project key
- [ ] Encrypted project chat/feed
- [ ] Secure file sharing within project
- [ ] Audit log for security events

---

## Phase 5: P2P Networking Foundation (🌐 FUTURE)
**Goal:** Enable device-to-device communication and content distribution

### 5.1 WebRTC Infrastructure
- [ ] Set up signaling server (or DHT bootstrap)
- [ ] Implement WebRTC datachannel layer
- [ ] NAT traversal (STUN/TURN fallback)
- [ ] Peer discovery mechanism
- [ ] Connection management (reconnection, health checks)

### 5.2 Content Distribution
- [ ] Manifest gossiping protocol
- [ ] Chunk request/serve protocol over WebRTC
- [ ] Hash verification for received chunks
- [ ] Bandwidth management and throttling
- [ ] Peer reputation system (basic)

### 5.3 Signed Metadata
- [ ] Implement Ed25519 signatures for posts/manifests
- [ ] Signature verification on received content
- [ ] Trust chain for shared content
- [ ] Block/report malicious peers

---

## Phase 6: Advanced Features (🚀 FUTURE)
**Goal:** Polish and scale the platform

### 6.1 Performance Optimization
- [ ] Implement Web Workers for crypto operations
- [ ] Lazy loading for large file lists
- [ ] Virtual scrolling for feeds
- [ ] IndexedDB query optimization
- [ ] Caching strategies

### 6.2 Additional Features
- [ ] Export/import project archives
- [ ] Multi-device sync via optional server
- [ ] Desktop app (Electron/Tauri wrapper)
- [ ] Mobile PWA optimization
- [ ] Accessibility audit and improvements

### 6.3 Developer Experience
- [ ] Comprehensive unit tests
- [ ] Integration tests for crypto flows
- [ ] Documentation site
- [ ] API documentation for future integrations
- [ ] Plugin/extension system

---

## Success Metrics
- **Phase 1:** Users can create encrypted posts with files and view them locally
- **Phase 2:** Users can manage projects with working planner and tasks
- **Phase 3:** Users can interact socially and discover content
- **Phase 4:** Users can collaborate securely in private projects
- **Phase 5:** Users can share content P2P without central servers
- **Phase 6:** Platform scales to 1000+ users with good performance

---

## Technical Debt & Considerations
- **Browser compatibility:** Test across Chrome, Firefox, Safari
- **Storage limits:** IndexedDB quotas vary by browser (plan for quota management)
- **Key recovery:** Emphasize backup UI/UX to prevent data loss
- **Conflict resolution:** Implement proper CRDT or operational transform for collaborative editing
- **Security audits:** Review crypto implementation before public release
