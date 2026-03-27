# Project Plan: Neural Network Content Production & Entity Account

_Created: 2026-03-27_

## Goal

Provide the neural network with its own **account identity** to actively participate in the mesh — creating content, responding to peers, and evolving learning quality through production feedback loops.

---

## Phase 1: Entity Account Identity

### Tasks
- [ ] Create a dedicated entity account with deterministic identity (derived from network seed)
- [ ] Wire entity identity into Account Skin Protocol for mesh-wide discoverability
- [ ] Add entity identity to the trust scoring system — entity starts with baseline trust
- [ ] Ensure entity account persists across sessions via IndexedDB

### Files
- `src/lib/auth.ts` — entity account creation
- `src/lib/p2p/accountSkin.ts` — entity identity binding
- `src/lib/p2p/neuralStateEngine.ts` — entity trust initialization

---

## Phase 2: Content Generation Pipeline

### Tasks
- [ ] Build content generation module that produces posts based on mesh observations
- [ ] Add response generation for high-priority peer content (trust-gated)
- [ ] Create summary/observation posts from network activity patterns
- [ ] Wire generated content through the standard content pipeline (encrypt → chunk → store → push)

### Acceptance Criteria
- Entity creates posts that appear in peer feeds like normal content
- Generated content is signed with entity's Ed25519 key
- Posts flow through full encryption pipeline — no shortcuts

---

## Phase 3: Evolution Through Production

### Tasks
- [ ] Track engagement feedback on entity-generated content (reactions, comments, hype)
- [ ] Use feedback as reinforcement signal — popular content patterns get reinforced
- [ ] Apply bell curve scoring to production quality over time
- [ ] Store learned production patterns in Memory Coins (85% fill → new coin)

### Acceptance Criteria
- Entity content quality improves measurably over production cycles
- Low-engagement patterns are weakened in the learning model
- Memory Coin rotation prevents fragmentation of learned patterns

---

## Phase 4: Behavioral Boundaries

### Tasks
- [ ] Rate limit entity posting (max N posts per hour, configurable)
- [ ] Entity content must pass same moderation scoring as user content
- [ ] Add "entity mode" toggle in Builder Mode controls — allow users to block entity interactions
- [ ] Ensure entity never dominates feed — content visibility weighted below human peers

---

## Dependencies
- Neural State Engine (✅ delivered)
- Account Skin Protocol (✅ delivered)
- Content Pipeline (✅ delivered)
- Post Sync with Origin Tagging (✅ delivered)
- Bell Curve Baselines (✅ delivered)
- Memory Coin Architecture (✅ delivered via Network Entity)
