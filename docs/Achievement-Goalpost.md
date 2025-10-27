# 🏆 Achievement & QCM Goalpost

_Last reviewed: 2024-11-02_

The Achievement & Quantum Creator Metrics (QCM) system turns notable actions into visible progress. This document captures what is **shipped today**, how QCM data flows through the product, and which gaps must close to stay aligned with the current course-of-action plan.

---

## 📌 Current Implementation Snapshot

- **Core logic** lives in `src/lib/achievements.ts` with persistence helpers in `src/lib/achievementsStore.ts` and type definitions under `src/types/index.ts`.
- **Event sources** already wired:
  - Post creation (`src/pages/Create.tsx`) → `post:created`
  - Project creation & updates (`src/lib/projects.ts`) → `project:created` / `project:updated`
  - Credit rewards & hype flows (`src/lib/credits.ts`) → `credits:earned` / `credits:hype`
  - Comment creation (`src/lib/interactions.ts`) → `social:comment`
  - P2P connection success (`src/hooks/useP2P.ts`) → `p2p:connected`
- **Profile surfaces** display signature badges, the full gallery, and live QCM charts via `AchievementBadgeGrid`, `AchievementGallery`, and `QCMChart` (see `src/pages/Profile.tsx`).
- **Credit rewards** for each unlocked badge flow through `awardAchievementCredits()` ensuring balances and `CreditHistory` stay consistent.

---

## 🛠️ Shipped Badge Set (v1)

| Title | Trigger | Credits | QCM Output | Notes |
| --- | --- | --- | --- | --- |
| First Transmission | First post published (`post:created`) | +25 | Content series +25 spike | Unlocks the first signature badge path. |
| Content Cascade | Five posts published | +50 | Content series +50 wave | Progress tracked incrementally. |
| Project Architect | First project created | +40 | Node series surge (value 40) | Awards when owning ≥1 project. |
| Project Steward | Three project updates | +20 | Node series boost (value 20) | Uses per-project update tally. |
| Hype Spark | First hype sent | +15 | Social pulse (value 15) | Triggered by `credits:hype` events. |
| Credit Claimer | First meaningful credit earned | +10 | Social spike (value 10) | Responds to non-burn reward transactions. |
| Mesh Runner | First successful P2P connect | +30 | Node surge (value 30) | Stores connection metadata when available. |
| Conversation Starter | Three comments posted | +20 | Social ripple (value 20) | Counts authored comments via IndexedDB index. |

> Scriptable achievements remain an available category in `AchievementCategory`, but no scriptable definitions ship yet.

---

## 📈 QCM Data Flow & Display

1. **Recording:** Each unlocked badge can emit a QCM spike via `recordQcmPoint()` (stored in the `qcmSamples` IndexedDB store with per-series keys).
2. **Series:** Default series are `content`, `node`, and `social`; colors and labels defined in `src/components/QCMChart.tsx`.
3. **Aggregation helpers:** `incrementNodeMetricAggregate()` (in `achievementsStore.ts`) tracks long-lived counters such as uptime or bandwidth once wired to telemetry.
4. **Presentation:** `Profile.tsx` hydrates the chart, showing spikes alongside badge unlocks; empty states explain how to generate activity.

---

## ⚠️ Gap Analysis vs. Project Specs

| Gap | Spec / Source | Required Adjustment |
| --- | --- | --- |
| **Telemetry-driven badges not wired.** Node uptime, bandwidth, and relay counts remain concept-only despite helpers in `incrementNodeMetricAggregate()`. | `docs/COURSE_OF_ACTION.md` (Section 2, Risk 3 & 4) and deferred hosting rewards in `docs/CREDITS_PHASE_6.1_STATUS.md`. | Feed real P2P stats from `src/lib/p2p/manager.ts` into metric aggregates, then design uptime/hosting achievements that align with planned rendezvous telemetry work. |
| **Legacy concept badges still referenced in community messaging.** The previous 25+ badge table overstated scope. | `docs/COURSE_OF_ACTION.md` (Section 3D.3) asking to realign aspirational docs. | Keep this document authoritative: remove speculative lists, note that expanded badge families require new roadmap entries before publication. |
| **QCM multiplier mechanics undefined.** The doc previously implied streak-based multipliers; implementation currently records discrete spikes only. | `docs/Unified_Source_of_Truth.md` (Credits section) mentioning flux-aware tracking. | Document current behavior (spikes only) and capture multiplier design as a future enhancement requiring schema changes plus UI updates. |
| **Scriptable achievements framework idle.** Category exists but lacks definitions, risking dead UI states if surfaced. | `src/types/index.ts` & `AchievementBadgeGrid` support `scriptable`. | Add backlog item to either populate scriptable badges (automation hooks) or hide the category until automation events exist. |

---

## 🚀 Next Steps (Proposed Sequencing)

1. **Telemetry plumbing (in-flight with P2P hardening):** Surface connection + bandwidth stats from `useP2P` into `incrementNodeMetricAggregate()` to unblock uptime/hosting badges.
2. **Define Phase 2 badge set:** Once telemetry lands, introduce a limited set of node/hosting achievements (mirror earlier concept names where appropriate) and update this doc alongside `docs/ROADMAP.md`.
3. **QCM multiplier design spike:** Evaluate streak/multiplier mechanics, design required schema updates, and slot work after telemetry is stable.

Keep this document updated whenever badge definitions change or new QCM series are added.
