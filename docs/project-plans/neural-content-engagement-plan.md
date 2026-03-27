# Project Plan: Neural Network Content Engagement

_Created: 2026-03-27_

## Goal

Enable the neural network to **read posts and comments** flowing through the mesh and **engage with users** based on trust-weighted priorities, bell curve baselines, and Φ transition quality.

---

## Phase 1: Content Ingestion Pipeline

### Tasks
- [ ] Wire entity observer into PostSync message handler to ingest all `post_created` and `posts_sync` messages
- [ ] Build content scoring function using bell curve Z-scores from `NeuralStateEngine`
- [ ] Add content categorization (high-engagement, normal, noise) based on interaction history
- [ ] Create priority queue for entity engagement — trust-weighted peers get attention first

### Files
- `src/lib/p2p/postSync.ts` — hook entity observer
- `src/lib/p2p/neuralStateEngine.ts` — bell curve scoring
- `src/lib/p2p/accountSkin.ts` — resolve content author identity

---

## Phase 2: Trust-Weighted Engagement

### Tasks
- [ ] Build engagement decision function: should the entity respond? (based on trust, content novelty, Φ state)
- [ ] Route unusual content signals through high-trust gossip paths first
- [ ] Add rate limiting — entity should not dominate the feed
- [ ] Wire Φ transition recommendations into engagement frequency

### Acceptance Criteria
- Entity responds to high-trust peer content within 30 seconds
- Low-trust/outlier content is evaluated but not auto-engaged
- Φ `tighten` reduces engagement frequency; `relax` increases it

---

## Phase 3: Moderation Integration

### Tasks
- [ ] Connect entity content review to existing moderation scoring (`services/moderation/scoring.ts`)
- [ ] Flag harmful content using bell curve outlier detection
- [ ] Emit `entity-moderation` proposals for peer consensus before action
- [ ] Add diagnostic logging for all entity engagement decisions

---

## Dependencies
- Neural State Engine (✅ delivered)
- Bell Curve Baselines (✅ delivered)
- Account Skin Protocol (✅ delivered)
- Post Sync with Origin Tagging (✅ delivered)
