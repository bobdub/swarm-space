# Browser Guardrails & Logical Loading Chains

Turn boot from a fixed idle-callback dump into an **adaptive, pausable chain** driven by a live Browser QScore. Sits on top of the existing loading-priority preset (Gaming / Social / P2P), not in place of it.

## Scope

- Additive. No existing feature is removed.
- Reuses the UQRC field engine + `appHealth` bus we already have — Browser QScore is a **new domain** on the same bus, not a parallel system.
- All work is client-side, presentation + boot orchestration. No schema / backend changes.

---

## 1. Browser Health monitor  (`src/lib/guardrails/browserHealth.ts`)

Pure observer, no side-effects on subsystems. Samples ~1 Hz, throttled.

Signals collected (all optional — degrade gracefully when unsupported):

| Signal | API |
|---|---|
| Frame rate / jank | `requestAnimationFrame` delta EMA |
| Long tasks | `PerformanceObserver({ type: 'longtask' })` |
| Main-thread latency | `setTimeout(0)` drift probe |
| Memory pressure | `performance.memory.usedJSHeapSize` (Chromium) |
| Render latency | `event` timing entries |
| Message backlog | queued idle callbacks + rAF debt |
| Sync workload | count of active `withHealth` domains from `appHealth` |

Combined into a **Browser QScore** in `[0..1]` (1 = healthy). Emits an event on `guardrails.bus` when it crosses configured thresholds (warn 0.55, degrade 0.35, critical 0.20) with hysteresis to prevent flapping.

Feeds a `browser:*` namespace into `recordAppEvent` so it shows up in the existing App Health badge alongside p2p/storage/stream/mining.

## 2. Logical Loading Points  (`src/lib/guardrails/loadingChain.ts`)

Registry of subsystems. Each point declares:

```ts
type LoadingPoint = {
  id: 'local' | 'mesh' | 'brain' | 'brain-game' | 'blockchain' | 'torrents' | 'mining' | string;
  label: string;
  essential: boolean;           // essential points always run
  minQScore: number;            // won't start below this
  pauseBelowQScore: number;     // running-work back-off threshold
  start: () => Promise<void>;   // idempotent
  pause?: () => void;
  resume?: () => void;
};
```

The seven initial points wrap the existing dynamic imports currently in `src/main.tsx` (blockchain init, room discovery, content-lookup responder, entity voice, coin/labour/lab/tool/world buses, mining, torrent verification). Nothing new is booted — we just **relocate** each import behind a `LoadingPoint.start` closure.

## 3. Chain runner  (`src/lib/guardrails/chainRunner.ts`)

- Loads the user's chain order (see §5), plus loading-priority preset as the default.
- Walks the chain sequentially with `requestIdleCallback` between steps.
- Before starting the next step, reads Browser QScore. If below `minQScore` for that step → **pause the chain**, don't skip. Fire a `guardrails:chain-paused` event.
- On recovery (QScore back above threshold + stable for N seconds) → resume from the exact step.
- Broadcasts progress on the existing `scaffoldBus` so the App Health badge can show `✓ Local ✓ Mesh … ⏸ Blockchain (paused)`.

## 4. Adaptive back-off hooks

Small, targeted throttles gated by Browser QScore. Each is a **wrapper**, not a rewrite:

- Animation frequency — new `useAdaptiveFrameRate` used by non-essential overlays.
- Background sync — `syncScheduler.ts` reads QScore multiplier before scheduling.
- P2P batching — `gossip.flush` interval doubles at warn, quadruples at degrade.
- Blockchain sync — `chain-sync-request` debounce widens.
- Torrent verification — pauses at degrade (reuses existing `stressMonitor`).
- Mining — piggybacks on the existing `getFieldHealthMultiplier` already read by mining, we just add a hard-pause below `critical`.

Critical user interactions (input, routing, message send) are never throttled.

## 5. Custom loading chains  (Settings)

Extend the existing loading-priority section:

- Reorderable list of logical loading points (`Local First` is pinned first, essential).
- Toggle: "Adaptive pausing (Browser Guardrails)" — default **on**.
- Persist to `localStorage: swarm-loading-chain` (`{ order: string[], adaptive: boolean }`).
- The three existing presets (Gaming / Social / P2P) become **chain templates** users can start from.

## 6. Device learning  (`src/lib/guardrails/deviceProfile.ts`)

Rolling stats persisted to `localStorage: swarm-device-profile`:

- Avg / p10 / p90 Browser QScore
- Steps that most often trigger a pause
- Time-to-recover after a pause
- Startup duration per chain order

After N cold boots with data, if a reordering would materially improve startup (avoided pauses), surface a **non-blocking Settings banner** proposing the new order. User accepts / dismisses. No auto-mutation of settings.

## 7. Diagnostics

- New card on `/storage-diagnostics` (route already exists): live Browser QScore, current chain state, last pause reason, recommended profile.
- The existing App Health badge gains a `browser` domain sub-Q.

---

## Technical details

**Files added**
```
src/lib/guardrails/browserHealth.ts
src/lib/guardrails/loadingChain.ts
src/lib/guardrails/chainRunner.ts
src/lib/guardrails/deviceProfile.ts
src/lib/guardrails/bus.ts
src/hooks/useBrowserQScore.ts
src/hooks/useAdaptiveFrameRate.ts
src/components/settings/LoadingChainEditor.tsx
src/components/diagnostics/BrowserGuardrailsCard.tsx
```

**Files edited**
```
src/main.tsx                      → move idle-imports into chainRunner
src/pages/Settings.tsx            → mount LoadingChainEditor under existing Priority section
src/pages/StorageDiagnostics.tsx  → mount BrowserGuardrailsCard
src/lib/settings/loadingPriority.ts → export preset → chain-order map
src/lib/uqrc/appHealth.ts         → accept 'browser' as HealthDomain (union widen)
```

**Constraints honored**
- Every point's `start()` is idempotent so repeated boots (HMR, tab wake) are safe.
- Never rewrites feature code — wraps existing dynamic imports.
- Never blocks Local First; auth / routing / input never throttled.
- No new deps.

**Chain state machine**

```text
    ┌── QScore ≥ minQScore ──┐
idle ─▶ starting ─▶ running ─┴─▶ done
                     │
      QScore < pauseBelowQScore
                     ▼
                  paused ──── QScore recovers ────▶ resuming ─▶ running
```

**Rollout / verification**

1. Land §1 + §2 + §3 behind the existing preset defaults (order equals current boot order) so behavior is unchanged.
2. Land §4 wrappers, verify existing throttles still fire (stress monitor, mining multiplier).
3. Land §5 UI, keeping presets as one-click templates.
4. Land §6 recommendations last — read-only until then.

Verification per phase: Playwright screenshot of Settings → new editor; force a low QScore via a test-only hook and confirm chain pauses without freezing input.
