# Plan — Smarter UQRC Checker + Live Score Alignment

Two coordinated tracks. Track A upgrades the static checker so contradictions arrive with actionable fix hints (and optional codemods). Track B routes real runtime spikes into the existing on-screen Q_Score so the badge visibly reacts to user actions.

---

## Track A — Rule-Specific Fix Hints & Codemod Stubs

### A1. Refactor `scripts/uqrc-check.mjs` to a rule registry

Replace inline rule blocks with a `RULES` array where each rule carries `{ id, test, message, hint, codemod }`:

- `id` — short slug shown in CI output.
- `test(line, ctx)` — current regex check.
- `message` — what was found.
- `hint` — 1–2 line "likely fix" with a concrete code snippet (multi-line block).
- `codemod` — optional `(src) => newSrc` stub name (resolved against `scripts/codemods/<id>.mjs`).

Output adds a `↳ likely fix:` block under each finding, plus a final summary listing any rules that have an available codemod.

### A2. Hints for the three top recurring offenders

1. **`no-native-form`**
   Hint: replace `<form onSubmit={...}>` with `<div role="form">` and `<button type="button" onClick={handleSubmit}>`. Show before/after snippet.
2. **`multiple-audio-contexts`**
   Hint: import `getSharedAudioContext()` from `src/lib/streaming/avPriority.ts` instead of constructing `new AudioContext()`.
3. **`destructive-db-upgrade`**
   Hint: route through `requestNonDestructiveUpgrade()` in `src/lib/p2p/db` (or annotate with `// allow-delete-db` if it really is a corruption-recovery path). Reference Core memory rule.

Also add lighter hints for `client-side-role-check`, `ghost-dependency`, `local-origin-overwrite`.

### A3. Codemod stubs

Add `scripts/codemods/` with three runnable but conservative transforms:

- `no-native-form.mjs` — rewrites `<form ...>` → `<div role="form" ...>`, strips `onSubmit`, and inserts a `// TODO(uqrc): wire handleSubmit to the submit button` marker.
- `multiple-audio-contexts.mjs` — replaces `new (window.)?AudioContext()` with `getSharedAudioContext()` and inserts the import if missing.
- `destructive-db-upgrade.mjs` — wraps `indexedDB.deleteDatabase(x)` call sites in a TODO + comment pointing to the upgrade helper (does not auto-delete, just annotates).

Each codemod is opt-in: `node scripts/codemods/<id>.mjs <file>`. The checker only mentions availability; it never runs them automatically. Add a `bun run uqrc:fix -- <rule> <file>` convenience entry in `package.json`.

### A4. Tests

Add `scripts/__tests__/uqrc-check.test.mjs` with fixture strings asserting each rule hits, the hint renders, and codemods produce expected output (snapshot).

---

## Track B — Align Visible Score With Real Runtime Spikes

Goal: the Q_Score badge already on screen should visibly jump when the user (or a subsystem) hits a stressed code path. Today most domains only inject on lifecycle events; the spikes felt during testing don't reach the field.

### B1. Standard `withHealth(domain, key, fn)` wrapper

Add `src/lib/uqrc/withHealth.ts`:

```text
withHealth('stream', 'webrtc.renegotiate', async () => { ... })
  → recordAppEvent on entry (amplitude: 0.4)
  → on throw: recordAppEvent(..., amplitude: 1.0, reward: -0.5)   // big curvature spike
  → on slow (>budget): recordAppEvent(..., amplitude: 0.7)
  → on success: recordAppEvent(..., reward: +0.1)                 // cools the basin
```

Single helper, zero new dependencies, debounce/log throttling already handled by `appHealth.ts`.

### B2. Instrument the actual hotspots

Wrap the call sites that the static checker keeps flagging as Q-heavy, so the on-screen score tracks what users do:

- **stream** — `webrtc/manager.ts` (`negotiate`, `joinRoom`, `replaceTrack`), `useBrainVoice` register/leave, `floatingLiveDockStore` transitions, `LiveRoomVoiceHost` audio binding flips.
- **storage** — `protectedStorage` reads/writes, IndexedDB upgrade path, file-encryption chunk loop (>20 MB rule).
- **p2p** — `lab.bus.ts` publish/subscribe (top stress file), `avatars.ts` sync, mesh dial failure path.
- **route** — already wired; add `recordAppEvent('route', path, { amplitude: 0.3 })` on navigation errors only (avoid double-counting on happy paths).
- **mining** — block-tick exceptions and chain-bridge stalls (Mining Hard Gate core rule).

Each wrap uses `withHealth` with a stable key per call site so the heat map points at a real file region.

### B3. Promote static stress into the live field at boot

On app start, read the top N rows from a cached `scripts/uqrc-check.mjs --json` snapshot (written to `src/lib/uqrc/baseline.json` during `bun run uqrc:check`) and seed the field with `recordAppEvent('static', file, { amplitude: q })`. Result: even before the user does anything, the visible badge reflects known curvature, and live spikes ride on top.

### B4. UI surfacing

`AppHealthBadge` already shows `qScore` + hotspots. Two small additions:

- Tooltip lists the top 3 hotspot keys with their domain prefix (`stream:webrtc.renegotiate`, `storage:idb.upgrade`, …) so devs/testers know *what* spiked.
- Brief pulse animation when `qScore` jumps by more than 0.05 between throttled samples — gives the visible "spike" feedback the user asked for.

### B5. Safety / cost

- `recordAppEvent` already 250 ms-debounces per key — no extra cost guards needed.
- `withHealth` never throws; it wraps in `try/finally`. Original function semantics preserved exactly.
- Off-switch via `localStorage['uqrc.health.off'] = '1'` for users who don't want the bus active.

---

## Deliverables

- `scripts/uqrc-check.mjs` — rule registry + hints + JSON mode (`--json`).
- `scripts/codemods/{no-native-form,multiple-audio-contexts,destructive-db-upgrade}.mjs`.
- `scripts/__tests__/uqrc-check.test.mjs`.
- `package.json` — `uqrc:fix` script.
- `src/lib/uqrc/withHealth.ts` + `baseline.json` loader.
- Instrumentation edits in: `src/lib/webrtc/manager.ts`, `src/hooks/useBrainVoice.ts`, `src/lib/streaming/floatingLiveDockStore.ts`, `src/components/streaming/LiveRoomVoiceHost.tsx`, `src/lib/storage/protectedStorage.ts`, `src/lib/p2p/db/*` upgrade path, `src/lib/remix/lab.bus.ts`, `src/lib/virtualHub/avatars.ts`, mining tick.
- `AppHealthBadge` — tooltip + pulse.
- Memory: append a Core line — *"Wrap stress hotspots in withHealth so the visible Q_Score reflects real runtime spikes."*

## Verification

1. `bun run uqrc:check` shows hints under every contradiction; running a codemod on a fixture transforms it correctly.
2. Open the app, start a live room, toggle the dock 3× — the visible Q badge spikes and the tooltip names `stream:floatingDock.toggle`.
3. Force a `webrtc.negotiate` failure (kill peer) — badge jumps red within 1 s, then cools as renegotiation succeeds.
4. `bun run uqrc:check --json` writes a baseline; reload app, baseline-seeded hotspots appear in the tooltip before any interaction.
