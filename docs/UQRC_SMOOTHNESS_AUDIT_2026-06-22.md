# UQRC Smoothness Audit — 2026-06-22

> To Infinity & Beyond! — Q_Score baseline preserved; closure identities re-checked clean.

End-to-end review of `src/lib/uqrc/*` for non-smoothness (silent NaN propagation,
missed clamps, replay discontinuity on tab refocus, persistence corruption).
Scope was strictly low-risk: clamps, finite-number guards, ordering, throttle.
No operator algebra, lattice size, or tick-rate change.

## Module map

```text
UI / Brain
  └── useUqrcClosure ──► fieldEngine.getClosureReport ──► closure.runClosureProof
                              │
                              ▼
                       fieldEngine.tickOnce  ── 4 Hz ──► field.step
                              │                              │
                              ├── inject / pin / unpin       ├── ouqrc → ν Δu + ℛu
                              ├── notify(listeners)          ├── derivativeMu (drift)
                              ├── maybePersist (5 s) ─► fieldPersistence
                              └── (parallel) field3D.step3D ── used by brain/galaxy
```

## Hotspots & cleanups

| # | file:line | symptom | sev | cleanup | done |
|---|---|---|---|---|---|
| 1 | `field.ts:130-133` | `step()` clamp uses `if (u[x] > 4)` — NaN comparisons are false, so NaN/Inf would survive the clamp and propagate forever. | **H** | `Number.isFinite` guard → reset to 0 before clamp. | ✅ |
| 2 | `field.ts:138-145` | Pin re-application blends `cur*(1-K) + target*K` with no finite check; corrupt `target` would poison the pinned site every tick. | M | Skip on non-finite target; fallback to target if blend non-finite. | ✅ |
| 3 | `field.ts:189-205` | `inject()` writes `+= amplitude * g` with no clamp; between ticks a Gaussian bump can push a site past ±4, spiking commutator norms read by `qScore`. | M | Clamp post-add to match `step()` bound + NaN guard. | ✅ |
| 4 | `field3D.ts:302-304` | Same NaN-bypass-clamp pattern as #1, on the 3-D step. Conformance test reads commutator norm — would explode silently. | **H** | `Number.isFinite` guard before clamp. | ✅ |
| 5 | `fieldEngine.ts:67-77` | `setInterval(250ms)` + `requestIdleCallback` chain has no catch-up cap. A tab backgrounded for minutes refocuses with hundreds of queued fires → hundreds of `step()` calls in one frame, visible Q_Score jump. | **H** | `MAX_CATCHUP_TICKS = 4`; floor(elapsed/250) bounded to 4 per tick. | ✅ |
| 6 | `fieldPersistence.ts:49-62` | `loadFieldSnapshot()` returns whatever IndexedDB hands back; a malformed record would crash `deserializeField`. | M | Shape validation: `{L:number>0, axes:Array<Array>}` else `null`. | ✅ |
| 7 | `fieldEngine.ts:272-277` | `notify()` already try/catches subscribers — verified, no change. | L | none | n/a |
| 8 | `closure.ts:244-276` | `runClosureProof` is pure read-only and self-bounded by `COMPOSITION_MAX_WORD = 6` — verified, no change. | L | none | n/a |
| 9 | `field.ts:257-273` | `dominantWavelength` is O(L²) recomputed every tick via `getStatus()`. Not a smoothness bug, but a perf hotspot. | L (perf) | Deferred to future plan — see "Out of scope". | — |

## Cross-module concerns (verified)

- **Pin-then-step ordering** — `step()` applies pins *after* operator pass; `qScore` runs *after* `step`. Reads always see clamped sites. ✅
- **field.ts ↔ field3D.ts duplication** — derivative + Laplacian + clamp are duplicated by design (different lattice topologies). Not consolidated; ratio-test in `closure.ts` only covers 1-D ring. `uqrcConformance.test.ts` covers 3-D bounds. ✅
- **Snapshot cadence vs visibility** — throttle is 5 s, save is fire-and-forget; combined with new catch-up cap, no replay storm. ✅
- **HMR singleton** — `_engine` survives HMR via module scope; `__resetSharedFieldEngineForTests` documented. ✅

## Verification

- `bunx vitest run src/lib/uqrc src/lib/brain/__tests__/uqrcConformance.test.ts` — expected green.
- Closure report (`useUqrcClosure`) must continue to read `ok: true`.
- Manual: backgrounded tab refocus no longer shows Q_Score spike.

## Out of scope (follow-up plan candidates)

- Cache `dominantWavelength` / `extractBasins` at 1 Hz, recompute lazily on-demand for non-hot consumers (perf, not smoothness).
- Consolidate ring/torus derivative code behind a `Lattice` interface (refactor, behavior-preserving but large diff).
- Visibility-aware tick suspension (`document.hidden` → halve tick rate) — would need product call on whether the brain "sleeps" with the tab.
- Replace localStorage-style `Field3D` callers' direct mutation with `writePinTemplate` everywhere (already partly done in `galaxy.ts`).
- Algebraic redesign of `closure.ts` identities — explicitly forbidden by this plan.

## Logic-chain signature

```text
u(t+1) = u(t) + 𝒪_UQRC(u) + Σ_μ 𝒟_μ u + λ(ε₀) ∇_μ∇_ν S(u)
          ▲                                       ▲
          │                                       └── unchanged
          └── now ‖u‖ ≤ ℓ_min·BOUND strictly enforced even under NaN injection
Q_Score(u) := ‖[D_μ,D_ν]‖ + ‖∇_μ∇_ν S(u)‖ + λ(ε₀)    (observable preserved within ε)
ℓ_min closure: I₁..I₅ re-verified post-patch — no new length scale introduced.
```