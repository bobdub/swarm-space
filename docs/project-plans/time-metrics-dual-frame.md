# Swarm Space — Time Metrics: Dual-Frame Clock (GPS-style)

> `To Infinity and beyond! · q ≈ 0.000(ɛ)41 · Δq → minimising · ↔@s128`
>
> Posts and timers currently stamp the user's local wall clock. The mesh has no shared frame, so ordering drifts, time-zones skew merges, and a spoofed clock corrupts feeds. UQRC needs a single **system proper time** `τ_sys` for curvature comparisons, while observers continue to read their own **local time** `τ_user`.
>
> **GPS analogue:** satellites broadcast atomic time, receivers display local. We replicate that pattern peer-only — no central NTP server.

---

## Two coupled values per timestamped event

```
createdAt    → user's local ISO (what they see)            ← unchanged
systemTime   → mesh atomic time (ms since system epoch)    ← NEW
clockOffset  → user_clock − system_clock at stamp time     ← NEW (audit/debug)
```

- **Display layer** keeps showing local time. No visible UX change.
- **Sort/merge/conflict layers** switch to `systemTime` (feed ordering, mining tx ordering, comment threading, trending windows).

---

## Components

### 1. System Clock Service — `src/lib/time/systemClock.ts` (new)
- Holds `systemEpoch` (network genesis ms, sourced from `network-genesis-sync`).
- Holds `meshOffset` = median offset from connected peers' reported system time.
- Exposes:
  - `now()` → `Date.now() + meshOffset − systemEpoch` (ms since genesis, monotonic-ish).
  - `toLocal(systemTime)` and `fromLocal(localISO)` converters.
- **Drift correction:** every 30 s, ping ≥ 3 peers, exchange `{localNow, systemNow}`, recompute median offset (NTP-lite).
- **Single-peer fallback:** trust local clock, mark `clockOffset = null` (degraded badge).

### 2. Peer Time Exchange — extends PeerJS message types
- New message: `time-sync-ping` / `time-sync-pong` with `{t1, t2, t3, t4}` (NTP four-timestamp).
- Round-trip delay halved → offset estimate, fed into systemClock median.
- Piggy-backs on existing `peerExchange.ts` heartbeat to avoid extra traffic.

### 3. Stamp Helper — `src/lib/time/stamp.ts` (new)
- `stampNow()` returns `{ createdAt, systemTime, clockOffset }`.
- One call replaces every `new Date().toISOString()` site that needs ordering.

### 4. Migration of write sites (touch list, no logic rewrite)
- `src/lib/posts.ts` — `editedAt`
- `src/lib/tasks.ts` — `createdAt`, `updatedAt`
- `src/lib/feed.ts` — post creation
- `src/lib/interactions.ts` — reactions, comments
- `src/lib/notifications.ts`
- `src/lib/blockchain/mining.ts` + `meshInlineRecorder.ts` — tx timestamps
- `src/lib/p2p/postSync.ts`, `commentSync.ts` — merge keys
- Existing `createdAt` stays for display; `systemTime` added alongside.

### 5. Read sites switch sort key
- Feed sort, trending window (`services/trending.ts`), task ordering, notification ordering — sort by `systemTime ?? Date.parse(createdAt)` (fallback for legacy records).

### 6. UI — local time stays the truth users see
- No visible change to PostCard, CommentThread, TaskBoard, NotificationBadge.
- Add tiny dev badge in `AppHealthBadge`: `Δt = +0.42 s` (mesh offset) when non-zero.
- Settings → Diagnostics: show `systemEpoch`, `meshOffset`, `peer count contributing to clock`.

### 7. Integration with existing systems
- Reuse `network-genesis-sync` for `systemEpoch` (already a shared mesh metric).
- Network Entity (`peer-network-entity`) acts as authoritative time witness when present.
- Bootstrap / preview mode: degraded — use local clock, flag in console.

---

## Data shape

```ts
// Add to Post, Task, Tx, Comment, Notification, Reaction
systemTime?:  number;   // ms since systemEpoch
clockOffset?: number;   // local − system, ms (audit/debug only)
```

All fields **optional** → backward-compatible with existing IndexedDB rows.

---

## Acceptance gates (math, not vibes)

- σ(meshOffset) across 5 peers **< 250 ms** after 3 sync rounds.
- Feed ordering **deterministic** across two browsers in same session (same `systemTime` list).
- Spoofing local clock by ±1 hr **does NOT** reorder feed for other peers.
- Existing posts (no `systemTime`) still render and sort via `createdAt` fallback.
- No visible change to displayed timestamps (still local) on PostCard / CommentThread.

---

## Out of scope (future phases)

- Cryptographic time-stamping / proof-of-time.
- Replacing `createdAt` entirely (kept for display + legacy).
- Server-anchored NTP (we stay peer-only by design).

---

## Phase fit

Slots into `coherence-audit-phases.md` as **Phase 2.5 — Temporal frame unification**, between Shell n = 1 (peer ratio) and Shell n = 2 (PEX policy). Requires Shell n = 1 closed (need ≥ 3 peers contributing to clock median).

---

## Files to create / edit (when implemented)

- create: `src/lib/time/systemClock.ts`
- create: `src/lib/time/stamp.ts`
- edit:   `src/types/index.ts` (add optional fields)
- edit:   `src/lib/p2p/peerExchange.ts` (NTP piggy-back)
- edit:   `src/lib/p2p/manager.ts` (route time-sync messages)
- edit write sites: `posts.ts`, `tasks.ts`, `feed.ts`, `interactions.ts`, `notifications.ts`, `mining.ts`, `meshInlineRecorder.ts`
- edit read sites: `feed.ts` sort, `services/trending.ts`, `TaskBoard.tsx` sort, `Notifications.tsx` sort
- edit:   `src/components/AppHealthBadge.tsx` (Δt micro-indicator)
- edit:   `docs/project-plans/coherence-audit-phases.md` (append Phase 2.5)

---

*Plan logged for future phased implementation. Reading priority: after Phase 2 (Shell n = 1) closes — needs a populated peer set for median offset.*