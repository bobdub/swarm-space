---
name: Causal Probe Dead-State Classifier
description: Local UQRC field saturation detector. Per-tab, observer-only. NEVER triggers WebRTC/swarm reconnect — basin relax is field-side only.
type: feature
---

The 𝒞_light causal probe (`src/lib/brain/lightspeed.ts`) is a pure observer
of the local UQRC field `u(t)`. It never writes to the field and never
touches the network.

## State labels (`classifyCausalState`)

`|u| ≤ FIELD3D_BOUND (= 4)` and `κ = 1` ⇒ `n_max = 5.0` is a hard ceiling.

| State | Trigger |
|---|---|
| `live` | default — field still evolving |
| `creep` | `n ≥ 4.999` AND ΔdelayRel < 5e-4 |
| `saturated` | `n ≥ 4.999` AND ‖∇u‖ < 1e-9 |
| `dead` | `|delay| < 1e-6` AND ‖∇u‖ < 1e-9 (or `rayLength = 0`) |

## Scope (CRITICAL)

- **Per-tab, in-memory, observer-only.** Local to one user's field engine.
- **Independent of WebRTC, bandwidth, peer health, or system state.**
- A `creep` / `saturated` / `dead` reading is a *cognitive condition* of
  this user's substrate — not a network or system fault.

## Basin relax (intended response)

When `creep` or `saturated` fires, the response is **field-side only**:

1. Reduce pin stiffness (currently `0.85` in `fieldEngine.ts`) for one tick.
2. Allow diffusion `ν Δu` to smooth the plateau.
3. Re-apply pins on the next tick.

**Do NOT disconnect WebRTC, leave the swarm, or rebuild peer connections
in response to a dead-state classification.** The transport is healthy;
the observer just hit a numerical ceiling. Bridging the two is a
category error.

**Why:** the field lives in this tab; the swarm lives across peers. They
operate on different substrates with different failure modes.

Tests: `src/lib/brain/__tests__/lightspeed.test.ts` (12 cases).
Doc: `docs/UQRC_BRAIN_MAP.md` § "𝒞_light Causal Probe and Dead-State Classifier".
