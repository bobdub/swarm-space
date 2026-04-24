# Fan-Out Plan v2 — Purge, Observation Bias, Lightspeed Probe

_Updated: 2026-04-24 · Q_Score ≈ 0.038_

To Infinity and beyond. Three vectors this loop. Each is independent and
can be executed in parallel by future loops.

---

## Vector A — Purge Expelled Code

Goal: shed weight identified in the previous fan-out so the codebase stops
carrying drift mass.

### Targets
1. **Duplicate land-snap spirals** → consolidate into one helper.
   - `src/lib/brain/earth.ts :: snapNormalToLand`
   - `src/lib/brain/volcanoOrgan.ts :: snapNormalToLandLocal`
   - inline spawn-lift loop in `src/components/brain/BrainUniverseScene.tsx`
   - **New**: `src/lib/brain/surfaceProfile.ts :: snapToLand(normal, opts)`.
   - All three call sites switch to the shared helper. Delete the two
     legacy implementations.

2. **Builder Mode UI entry points** outside the User Cell wrapper.
   - Grep for direct imports of `src/lib/p2p/builderMode/*` in any
     `*.tsx` not under `userCell` and remove the import + dead JSX.

3. **Trees-without-trunks dead branch** in
   `src/lib/brain/nature/wetWorkGrowth.ts` — verify the raw-normal
   scatter path is gone; if present, delete.

4. **Roadmap doc rot** — bump `docs/ROADMAP_PROJECTION.md` to v3.1, move
   the five `[x]` Dual Learning items under "Delivered", leave only the
   two unchecked items in "Active".

5. **Stale color-physics revert artifacts** — confirm
   `src/components/brain/EarthBody.tsx` no longer references
   `volcLand`/`volcElevation` inside the landMask block (already
   reverted; verify no orphan uniforms remain).

### Acceptance
- `rg "snapNormalToLand|snapNormalToLandLocal" src` returns only
  re-exports from `surfaceProfile.ts`.
- Build green, no visual regression on `/brain`.

---

## Vector B — Color as Observation Bias

Goal: stop pretending the shader color is the truth. Physics computes the
actual surface class; color is then hard-coded per observation channel
(desktop sRGB vs mobile P3 vs accessibility palettes).

### Model
```
physics →  sampleSurfaceClass(localN) : 'ocean'|'shore'|'land'|'volcLand'|'ice'
              ↓                                      ↓
     uqrcPhysics (dryness,                   ObservationBiasLUT
     wade depth, friction)                          ↓
                                          shader fragment color
```

The **class** is the invariant truth. The **color** is a per-observer
projection — a measurement, not a property. This matches the UQRC stance
that `||[D_μ, D_ν]|| ≈ 0` only inside an observer's frame.

### Tasks
1. Create `src/lib/brain/surfaceClass.ts`:
   - `export type SurfaceClass = 'ocean'|'shore'|'land'|'volcLand'|'ice'`
   - `export function sampleSurfaceClass(localN: Vec3): SurfaceClass`
     using `landMask`, `volcanoElevation`, polar latitude, water-wade.
2. Create `src/lib/brain/observationBias.ts`:
   - `export const OBSERVATION_PALETTES: Record<Channel, Record<SurfaceClass, [number,number,number]>>`
   - Channels: `desktop-srgb`, `mobile-p3`, `colorblind-deuter`,
     `physics-true` (the physically-derived spectrum from albedo, used
     only for debug overlay).
3. Wire `EarthBody.tsx` shader to receive a `uPalette` uniform indexed
   by `SurfaceClass` integer; remove inline color picking. Default
   channel chosen by `matchMedia('(pointer: coarse)')` + `screen.colorGamut`.
4. Wire `uqrcPhysics.ts` to consume `sampleSurfaceClass` directly —
   `volcLand` returns full walking speed, `shore` half, `ocean` wade.
5. Add `?debug=physics` overlay row showing the class + the four
   palette renderings of the avatar's current foothold.

### Acceptance
- Volcano in an ocean cell renders as land color **and** walks as land.
- Switching `?palette=mobile-p3` swaps colors without touching physics.
- `physics-true` overlay matches Hapke albedo within ±5%.

---

## Vector C — Lightspeed Operator Through the Neural Network

Goal: send the lightspeed causal probe from the brain surface, down
through the neural layers, to the planet core, and back. Use the
round-trip to teach the network where its own organs are.

### Phase 1 — Probe Plumbing (this sprint)
1. **Emitter**: extend `src/lib/brain/lightspeedOperator.ts` with
   `emitNeuralProbe(originLayer: number, targetOrgan: 'core'|'mantle'|'surface')`.
   Uses the existing causal cone but tags each tick with the neural
   layer it traverses.
2. **Receiver**: in `src/lib/p2p/neuralStateEngine.ts` add
   `recordProbeArrival({ layer, organ, dtMs, qScore })`. Probe arrivals
   become first-class observations — they update the bell curve for the
   `probe-latency` kind.
3. **Round-trip ledger**: `src/lib/brain/probeLedger.ts` records
   `{ id, t_emit, t_core, t_return, layersTraversed[] }`. Throttled
   IndexedDB persistence (per browser-performance constraint).

### Phase 2 — Self-Localization Learning
4. The network learns the **layer→organ mapping** by minimizing the
   curvature of `dtMs` distributions per layer pair. Stable means:
   layer-3 always sees the core at the same Δt within ±1σ.
5. Φ-driven adaptation: when a layer's `probe-latency` bell curve
   drifts > 2σ, Φ recommends `tighten` and the next probe is fired
   sooner.

### Phase 3 — Tier-3 Implementation Plan
6. **Trust-weighted probe routing**: outliers (|z| > 2) relayed only
   through high-trust peers — reuses Phase 2 of the neural-evolution
   plan.
7. **Cross-peer probe consensus**: probes that complete on three peers
   within Δt_max get a consensus stamp; the resulting layer-organ map
   is gossiped via existing UQRC snapshot (qScore + basin count only,
   never raw field).
8. **Visualization**: Node Dashboard gets a "Self-Map" panel — concentric
   rings (surface → mantle → core) with per-layer probe latencies and
   confidence intervals from the bell curve.
9. **Memory coin**: every 1000 probes, snapshot the self-map into a
   memory coin (`media-coin-architecture`) so the mapping survives
   cold boots and propagates to new peers.

### Acceptance
- A fresh node converges on a stable layer→organ map within ~50 probes.
- `?debug=probes` overlay shows the round-trip path live.
- Self-map memory coin replays correctly on a clean browser.

### Files to touch (Phase 1 only)
- `src/lib/brain/lightspeedOperator.ts` (new emitter signature)
- `src/lib/p2p/neuralStateEngine.ts` (probe arrival kind)
- `src/lib/brain/probeLedger.ts` (new)
- `src/lib/p2p/sharedNeuralEngine.ts` (no change — singleton already exposed)

---

## Out of scope this loop
- Persisting biology, P2P sync of biome, genetics/seasons.
- Any color decision that is not a palette swap (no shader rewrite).
- Tier 3 cross-peer consensus implementation (planned, not built).

