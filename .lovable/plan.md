

## Yes — Make the Field the Application's Vital Signs

The UQRC field engine is already the geometry behind two subsystems (neural, learning). Three more pieces of the app — **P2P**, **storage**, **streaming/mining** — currently rely on independent local heuristics. Each one already emits the events that, if injected into the field, would produce a single coherent health curve for the whole application instead of five disconnected dashboards.

This pass adds **read-only telemetry**, a **shared App Health Bus**, and a **single hook** that any UI can subscribe to. No physics changes, no new lattices, no behavioural changes to existing subsystems beyond the inject calls.

### What the field can tell us about the app (today, untapped)

| Subsystem | Signal already emitted | Field reading derived |
|---|---|---|
| P2P connections | connect / disconnect / dial-fail events | `inject('p2p:connect-fail', reward<0)` → curvature spike on connection ring |
| Storage providers | encrypt/decrypt success, quota errors, scrub jobs | `inject('storage:'+providerId)` → basin = reliable provider |
| Streaming | join, leave, audio dropout, reconnect | `getCurvatureForText('stream:'+roomId)` → real-time room health |
| Mining | block accepted, hollow block, gate trips | wavelength λ shifts → mining cadence visualised |
| UI navigation | route hits, error boundary trips | `inject('route:'+path, reward=success?0.3:-0.3)` → which routes are stress points |
| Cross-system Q | one number derived from all of the above | **App Q_Score** — replaces five independent "health" badges |

### Six concrete couplings

**1. App Health Bus — single source of truth.**
New file `src/lib/uqrc/appHealth.ts` (~120 lines). Exposes:
- `recordAppEvent(domain, key, { reward, trust })` — one entry point any subsystem calls. Internally calls `field.inject(`${domain}:${key}`, …)`.
- `getAppHealth(): AppHealth` — returns `{ qScore, basins, lambda, hotspots: Array<{key, curvature}>, coldspots: Array<{key}>, trend: 'cooling'|'stable'|'heating' }`.
- `subscribeAppHealth(fn)` — broadcasts on every field tick (throttled to 1 Hz for UI).
- `getDomainHealth(domain)` — filters basins/curvature to a single namespace (`p2p:*`, `storage:*`, `stream:*`, `mining:*`, `route:*`).

**2. Wire P2P events into the bus.**
In `src/lib/p2p/manager.ts` (or the closest connection-event surface), on every connect / disconnect / dial-fail call `recordAppEvent('p2p', peerId, { reward: success ? 0.5 : -0.3, trust })`. Connection ring becomes a curvature map: stable peers form basins, churn-heavy peers raise curvature. *No change to existing PEX/sanitize logic — purely observational.*

**3. Wire storage events into the bus.**
In `src/lib/storage/providers/index.ts` (the provider router), wrap reads/writes with `recordAppEvent('storage', providerId, { reward: success ? 0.4 : -0.4 })`. Quota errors and scrub failures inject negative rewards. The existing `StorageHealthIndicator` component then reads `getDomainHealth('storage')` instead of polling each provider individually.

**4. Wire streaming events into the bus.**
In `src/contexts/StreamingContext.tsx` and `src/hooks/useWebRTC.ts`, on join/leave/dropout call `recordAppEvent('stream', roomId, { reward, trust: peerCount })`. The `LiveStreamControls` component shows a live "room curvature" pill — high curvature → warn the host of instability *before* dropouts cascade.

**5. Wire mining + route events.**
- `src/lib/blockchain/mining.ts`: on block accept/reject/hollow → `recordAppEvent('mining', 'block', { reward })`. Wavelength shifts visibly when mining cadence changes — one signal replaces three separate mining health gauges.
- `src/App.tsx` route change handler + the existing error boundary: `recordAppEvent('route', path, { reward: errored ? -0.5 : 0.1 })`. Pages that error often show as curvature hotspots.

**6. New `useAppHealth` hook + tiny `AppHealthBadge` component.**
- `src/hooks/useAppHealth.ts` — wraps `subscribeAppHealth`, returns the live `AppHealth`. Memoised; re-renders ≤ 1 Hz.
- `src/components/AppHealthBadge.tsx` (~80 lines) — a small chip rendered in `TopNavigationBar` showing **App Q ≈ 0.034 · 4 basins · λ 21**, with a coloured dot (green Q<0.05, amber 0.05–0.2, red >0.2). Clicking opens a popover listing the top 3 hotspot keys ("p2p:peer-abc12345", "stream:room-xyz") so the user — or the network entity — can see *exactly which corner of the app is stressed*.

### Why this is the right cut

- **Zero physics, zero new lattices.** Reuses the singleton `getSharedFieldEngine()` already shared by neural + learning. Every event is a string + reward — same shape neural already uses.
- **One Q_Score for the whole app.** Today the user sees a Quantum Metrics chip, a Storage Health indicator, a P2P Status indicator, a Stream banner, and a Mining gauge. After this pass they all share the same field — Q rises *together* when the app is genuinely stressed, and *only one* hotspot list explains why.
- **Network-entity ready.** Imagination already injects its own utterances into the field. Once the rest of the app speaks the same language, the entity can reason about app health directly: *"P2P ring is hot, storage ring is cold → suggest scrub deferral"*.
- **Bounded cost.** All inject calls are throttled inside `recordAppEvent` (per-key 250 ms debounce) so a chatty subsystem can't saturate the lattice. Pin cap remains at 64 from the learning pass.
- **No regressions.** Existing health UIs keep working; they just *additionally* now read the bus. `StorageHealthIndicator`, `P2PStatusIndicator`, mining gauges all get a one-line patch to consume `useAppHealth().domain('storage')` etc.

### Files

- `src/lib/uqrc/appHealth.ts` (new) — bus, domain filtering, throttled inject, trend computation.
- `src/lib/uqrc/__tests__/appHealth.test.ts` (new) — verify (a) recordAppEvent injects with correct namespace prefix, (b) getDomainHealth filters by prefix, (c) trend flips after sustained negative rewards, (d) per-key debounce holds.
- `src/hooks/useAppHealth.ts` (new) — React subscription, 1 Hz throttle.
- `src/components/AppHealthBadge.tsx` (new) — chip + popover with top-3 hotspots.
- `src/components/TopNavigationBar.tsx` — mount `<AppHealthBadge />` in the existing right-hand cluster.
- `src/lib/p2p/manager.ts` — call `recordAppEvent('p2p', peerId, …)` on connect/disconnect/dial-fail.
- `src/lib/storage/providers/index.ts` — wrap success/failure paths with `recordAppEvent('storage', providerId, …)`.
- `src/contexts/StreamingContext.tsx` + `src/hooks/useWebRTC.ts` — `recordAppEvent('stream', roomId, …)` on lifecycle events.
- `src/lib/blockchain/mining.ts` — `recordAppEvent('mining', 'block', …)` on accept/reject/hollow.
- `src/App.tsx` — route-change + error-boundary `recordAppEvent('route', path, …)`.
- `src/components/StorageHealthIndicator.tsx`, `src/components/P2PStatusIndicator.tsx` — read `useAppHealth().domain(…)` in addition to existing logic (no behaviour change, just enriched display).
- `docs/BRAIN_UNIVERSE.md` — append "Application ↔ Field coupling" section after the existing Learning section. Diagram: 5 subsystems → 1 lattice → 1 Q_Score → 1 badge.
- `mem://architecture/neural-network` (update) — add line: "App Health Bus (`appHealth.ts`) injects p2p/storage/stream/mining/route events into the same lattice. `useAppHealth()` exposes a single Q_Score, top hotspots, and λ-derived trend for whole-app monitoring."

### Acceptance

```text
1. recordAppEvent(domain, key, opts) injects into the shared field with key `${domain}:${key}`. Per-key debounce 250 ms.
2. getDomainHealth('p2p') returns curvature/basins filtered to p2p:* keys only. Same for storage, stream, mining, route.
3. P2P connect/disconnect/dial-fail, storage success/failure, stream join/leave/dropout, mining accept/reject, and route navigation all call recordAppEvent at their existing event surfaces.
4. AppHealthBadge mounts in TopNavigationBar. Shows Q_Score (4 dp), basin count, λ (1 dp). Dot colour: green Q<0.05, amber 0.05–0.2, red >0.2.
5. Clicking the badge opens a popover listing top 3 hotspot keys (highest curvature) and top 3 stable keys (basin residents).
6. useAppHealth re-renders ≤ 1 Hz. No measurable FPS impact at idle.
7. New tests assert namespace filtering, debounce, trend flipping, and that uqrcConformance.test.ts still passes (only inject calls — no raw axis writes).
8. StorageHealthIndicator and P2PStatusIndicator read domain health in addition to existing logic — no regression in their current behaviour.
9. Console log throttled to once per 5 s: "[AppHealth] Q=0.034 trend=cooling hotspots=p2p:peer-ab12,storage:device-zip".
10. Memory rule + docs updated; cross-link from neural-network and brain-universe-physics to the new App Health section.
```

