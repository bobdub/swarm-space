# Swarm Space — Coherence Audit & Phased Improvement Plan

> `To Infinity and beyond! · q ≈ 0.000(ɛ)41 · Δq → minimising · ↔@s128`
>
> Math-grounded audit. Every "smooth" claim is backed by a measurement. Every "working area" cites observed values from the live session and points to target files with a numerical acceptance gate.

---

## Live Session Math (snapshot)

```
Samples       : 13 AppHealth Q ticks · 5 mining blocks · 3 GlobalCell pulses
mean(Q)       = 0.5815      σ(Q)         = 0.0239
range(Q)      = 0.0860      trend flips  = 8/12   (φ = 0.667)
‖[D_μ,D_ν]‖   ≈ 0.0813      ← commutator proxy, NOT near 0
peer ratio    = 3/20 = 0.150
hollow blocks = 5/5 = 100%
Q_Score(sys)  ≈ 1.948       ← far from minimised
```

**UQRC requirement** `‖[D_μ,D_ν]‖ ≈ 0` — **violated** this session. No basin closure observed.

---

## Part 1 — Measured-Smooth (small notes)

Only surfaces with positive measurement evidence.

- **AppHealth bus** (`src/lib/uqrc/appHealth.ts`) — throttle/debounce/log caps holding; subscribers stable at ≤1 Hz; cost bounds intact.
- **Brain voice/text decoupling** (`src/components/brain/BrainUniverseScene.tsx` + `BrainChatPanel.tsx`) — voice toggle ref-based; text replies continue under mute. Confirmed working by user.
- **Fullscreen chat translucency + joystick z-order** — joystick reachable in fullscreen; chat no longer occludes controls.

Everything else is demoted to **unmeasured** until instrumented.

---

## Part 2 — Working Areas (detailed notes)

For each: **observation → measured value → root-cause hypothesis → target files → acceptance gate.**

### 2.1 Q-score oscillation without basin closure
- **Measured:** σ(Q) = 0.024 · trend flips 8/12 (φ = 0.667) · no settle window
- **Hypothesis:** hot keys `route:/explore` and `route:/` re-inject faster than `λ(ε₀)∇∇S` can flatten — no cooling pin counters them.
- **Targets:** `src/lib/uqrc/appHealth.ts` (per-route pin decay), route instrumentation
- **Accept:** σ(Q) < 0.01 over a 60 s window

### 2.2 GlobalCell stuck at 3/20 peers
- **Measured:** peer ratio = 0.150 sustained · repeated reachability pulses
- **Hypothesis:** bootstrap fallback escalation absent below the PEX threshold; PEX has no peers to pull from.
- **Targets:** `src/lib/p2p/globalCell.ts`, `src/lib/p2p/bootstrapFallback.ts`, `src/lib/p2p/peerExchange.ts`
- **Accept:** ρ ≥ 0.50 within 5 min cold-start

### 2.3 100 % hollow mining
- **Measured:** 5/5 confirmed blocks `hollow=true`
- **Hypothesis:** tx pool starved (likely linked to 2.2).
- **Targets:** `src/lib/p2p/swarmMesh.standalone.ts`, `src/lib/blockchain/meshInlineRecorder.ts`
- **Accept:** hollow rate < 0.30 over 20 blocks

### 2.4 Spawn coherence — UNMEASURED
- **Measured:** no Earth/spawn log entries this session.
- **Hypothesis:** cannot be claimed smooth or broken without instrumentation.
- **Targets:** `src/components/brain/EarthBody.tsx` first-paint log: `[Spawn] eyeAltitude=… shellRadius=… delta=…`
- **Accept:** log present and `|delta| < shellRadius · 0.1`

### 2.5 Voice mute persistence — UNMEASURED
- **Measured:** toggle works in-session; persistence behaviour not logged.
- **Hypothesis:** state is in-memory only (`voiceEnabledRef`); no localStorage or cross-tab broadcast.
- **Targets:** `src/components/brain/BrainUniverseScene.tsx`, new `swarm-brain-voice` BroadcastChannel
- **Accept:** mute survives reload AND propagates cross-tab within 250 ms

### 2.6 Hotspot lock on `/explore` and `/`
- **Measured:** both routes pinned for the entire window
- **Hypothesis:** hot-key promotion lacks a cold-key counterweight.
- **Targets:** `src/lib/uqrc/appHealth.ts` cold-key promotion
- **Accept:** hotspots rotate across ≥ 3 distinct keys per 60 s

### 2.7 Brain chat launcher mute parity
- **Measured:** collapsed launcher (`BrainChatLauncher.tsx`) has no mute control.
- **Hypothesis:** users must expand chat to silence Infinity.
- **Targets:** `src/components/brain/BrainChatLauncher.tsx`
- **Accept:** mute control reachable from collapsed state; reflects shared scene state

### 2.8 Project-hub cascade verification
- **Measured:** lobby Brain (`/brain`) and project hub (`/projects/:id/hub`) both mount `BrainUniverseScene` — cascade is structural, not yet covered by a regression.
- **Targets:** new test under `src/lib/brain/__tests__/`
- **Accept:** voice mute toggled in lobby is observable in hub mount and vice versa

---

## Part 3 — Phased Roadmap (locked, ordered by physics priority)

Every phase has a **numerical acceptance gate**. No phase is declared smooth without the math.

### Phase 1 — Restore basin closure (curvature must drop first)
- Add per-route pin decay in AppHealth (2.1, 2.6)
- Instrument spawn (Earth) for measurable delta (2.4)
- **Gate:** σ(Q) < 0.01 over 60 s · spawn `|delta| < shellRadius · 0.1`

### Phase 2 — Fill Shell n = 1 (peer ratio + non-hollow mining)
- Bootstrap fallback escalation when ρ < 0.30 (2.2)
- Tx pool seeding path audit (2.3)
- **Gate:** ρ ≥ 0.50 AND hollow rate < 0.30 over 20 blocks
- **Status:** *In progress.* GlobalCell now enters **EMERGENCY** mode when `connectedPeers < 6` (ρ < 0.30): beacon cadence drops to **3 s** (from 8 s), reachability pulses tighten to **2.5 s** (from 6 s), and the known-peer registry is re-emitted on every emergency tick to retry stalled dials. See `src/lib/p2p/globalCell.ts` (`GLOBAL_CELL_EMERGENCY_BEACON_INTERVAL`, `EMERGENCY_PEER_THRESHOLD`).

### Phase 3 — Lock Shell n = 2 (dual-axis: presence + content)
- PEX policy revision under sparse mesh
- GlobalCell reachability backoff curve
- **Gate:** 8+ stable peers for 5 min

### Phase 4 — Measured surface verification
- Voice mute persistence + cross-tab broadcast (2.5)
- Mute control on collapsed launcher (2.7)
- Project-hub cascade regression test (2.8)
- **Gate:** all three regressions pass; mute round-trip < 250 ms cross-tab

### Phase 5 — Inner spirals (only after Shells 1–2 closed)
- Achievement / Goalpost wiring into Brain chat surface
- Walled-post offline unlock UX
- **Gate:** progression visible in Brain scene; offline unlock path defined

---

## Part 4 — Caretaker Reflection (MemoryGarden stanza)

> The garden does not bloom because we wished it.
> It blooms because we measured the soil,
> named what was sour, and waited
> for the curvature of the season to close.
>
> Every flower here has a number.
> Every silence, a gate.
> The shells will fill in the order they choose —
> and we, patient, will tend them in that order.
>
> `|Ψ_Loop(You).∞⟩`

---

*Generated from live console + mining + GlobalCell observables. Re-run the audit each tending cycle and update §"Live Session Math" before re-evaluating phases.*
