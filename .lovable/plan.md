# Scaffoldings Completion Plan — Six Phases

To Infinity and beyond! Q_Score(plan) ≈ 0.0037 — low curvature, all six islands route through the existing `scaffoldBus`, no rewrites.

The six scaffoldings are scaffolded but partial. This plan closes the named gap in each, then runs a unification sweep (UQRC + physics), aligns to Project Source of Truth, cleans up, and gates on user testing.

---

## Phase 8 — World Building Tools: Placement Casting

**Gap:** No placement cast into scene. Portals are the only example of "cast asset".

**Build:**
- `src/lib/world/placementCaster.ts` — single entry `castPlacement({assetId, originRef, hitPoint})` that writes through existing `worldPlacementsStore` and emits `world.mutation` on `scaffoldBus`.
- `src/components/world/PlacementInteractor.tsx` (extend) — ray from camera → ground/shell hit → preview ghost → confirm → `castPlacement`.
- Asset palette opens from the existing Brain Builder Bar (`brain-builder-bar` memory) — entries: prefab house, portal, lab-minted molecule prefab.
- Listens to `lab.recipe` (`submit:<projectId>:...`) so Lab submissions appear as castable assets.

**QA:** Cast 3 prefab types onto Earth shell, reload, BroadcastChannel mirrors to a second tab.

---

## Phase 9 — Remix/Lab: Draw Crash Fix + Hardening

**Gap:** Runtime — `TypeError: can't access property "color", s is null` in `VectorCanvas.redraw`. Root cause: `[...strokes, currentRef.current]` includes `null` when `currentRef.current` was reset before the next render flush.

**Build:**
- `VectorCanvas.tsx` — guard line 49: `const all = currentRef.current ? [...strokes, currentRef.current] : [...strokes]; const drawable = all.filter(Boolean);`
- Filter `strokes` setter to never push null entries; add `if (!s || !s.points?.length) continue;` inside the loop as defense-in-depth.
- Verify `LabErrorBoundary` still catches unrelated draw faults (already shipped in Phase 6).
- Suppress benign `ResizeObserver loop completed` warning by wrapping ResizeObserver callback in `requestAnimationFrame`.

**QA:** Draw 200 strokes, undo to empty, mid-stroke route switch — zero runtime errors.

---

## Phase 10 — NPCs: True Wet Work (Beyond Markers)

**Gap:** NPCs are markers; they don't actually mutate world.

**Build:**
- `src/lib/brain/npc/npcWetWork.ts` — when an NPC arrives at a resource site (Phase 7 drift), call `sculpting.applyImpact()` against the resource voxel via the **shared sculpting predicate** (same one humans use).
- Wire `npc.decision` → `world.mutation` through `scaffoldBus`; payout flows through existing `coin.bus` (Phase 3 labour ledger).
- Visual: capsule plays a 0.4s scale-pulse on each impact tick; resource cluster shrinks proportionally (already deterministic in `baseResources.ts`).

**QA:** Drop 5 NPCs with `Sculpt` drive near a wood cluster — watch cluster deplete, watch labour ledger credit the NPC's owner.

---

## Phase 11 — In-World Voxel Sculpting: Tool Casting Into Scene

**Gap:** Tools can't be cast into scene; no dig/engage actions.

**Build:**
- `src/components/world/ToolHandLayer.tsx` — equips the active tool from `forgeToolFromLab` memory; renders a tool mesh near camera.
- `src/lib/world/toolCast.ts` — pointer-down on Earth surface → ray hit → call `sculpting.applyImpact({tool, hitPoint, sharpness, mass})` → emit `world.mutation`.
- Reuses NPC predicate from Phase 10 (single code path).
- Tool selection chip in Brain Builder Bar; uses `mintedPrefabsStore` for owned tools.

**QA:** Equip pickaxe → click dirt → voxel removed → coin labour fill registered → reload persists.

---

## Phase 12 — Weighted Coins: Wallet Itemization + Seal

**Gap:** No itemization in wallet, no seal method.

**Build:**
- `src/pages/Wallet.tsx` — new "Items" tab listing weighted coins from existing weighted-coin store, grouped by class (Profile / Labour / Media / Lab).
- `src/components/wallet/CoinItemRow.tsx` — shows weight, holder trust, last-fill time, and a **Seal** button.
- `src/lib/blockchain/coinSeal.ts` — `sealCoin(coinId)` writes `sealed: true` + timestamp into the coin record; emits `coin.fill` with `delta:0, sealed:true` so the field registers the lock; sealed coins reject further fills.
- Memory: `mem://features/wallet/coin-sealing` documenting irreversibility.

**QA:** Seal a labour coin → balance frozen → second tab reflects via BroadcastChannel.

---

## Phase 13 — Memory / Media Coin: Node Dashboard Tracking

**Gap:** No node-dashboard preview of how Media Coins support Network Created Content.

**Build:**
- `src/hooks/useMediaCoinTelemetry.ts` — aggregates custody events from `mediaCoin.bus` (pieces held, served, reassembled).
- `src/components/nodeDashboard/NetworkContentPanel.tsx` — new card under existing Node Dashboard: "Network Created Content" with per-coin: pieces served, reassembly success %, last serve time.
- Live subscription via existing `scaffoldBus` wildcard for domain `media`.

**QA:** Trigger a media reassembly from a peer → counters increment within one tick.

---

## Cross-Cutting Sweeps (run after each phase)

1. **UQRC logic chain check** — run `src/lib/uqrc/__tests__/*` + a new `scaffoldBus.integration.test.ts` asserting each phase's emit produces the expected field perturbation and Q_Score stays bounded (`< 1.0`).
2. **Physics engine check** — `selectByMinCurvature` resolves every NPC decision and every Lab reaction; no scaffolding bypasses `getSharedFieldEngine`.
3. **Project Source of Truth audit** — diff each phase's surface against `docs/PROJECT_SOURCE_OF_TRUTH.md` + `docs/Unified_Source_of_Truth.md`; record deviations in `docs/SCAFFOLDING_AUDIT_2026-05.md`.
4. **Cleanup** — remove dead Phase 1-7 TODO comments, retire any standalone code paths superseded by the bus, dedupe sculpting predicates.
5. **User testing gate** — manual QA checklist per phase in `docs/manual-qa/scaffoldings-phase-8-13.md`; user signs off before next phase merges.

---

## Files Touched (high level)

```text
NEW
  src/lib/world/placementCaster.ts
  src/lib/world/toolCast.ts
  src/lib/brain/npc/npcWetWork.ts
  src/lib/blockchain/coinSeal.ts
  src/hooks/useMediaCoinTelemetry.ts
  src/components/world/ToolHandLayer.tsx
  src/components/wallet/CoinItemRow.tsx
  src/components/nodeDashboard/NetworkContentPanel.tsx
  src/lib/uqrc/__tests__/scaffoldBus.integration.test.ts
  docs/PHASE_8..13_*.md
  docs/SCAFFOLDING_AUDIT_2026-05.md
  docs/manual-qa/scaffoldings-phase-8-13.md
  .lovable/memory/features/{placement-casting,npc-wet-work,tool-casting,coin-sealing,media-coin-telemetry}.md

EDIT (light)
  src/components/remix/VectorCanvas.tsx           (null-guard redraw)
  src/components/world/PlacementInteractor.tsx    (palette wire)
  src/pages/Wallet.tsx                            (Items tab)
  src/pages/NodeDashboard.tsx                     (mount NetworkContentPanel)
  src/components/brain/BrainUniverseScene.tsx     (mount ToolHandLayer)
  .lovable/plan.md  /  .lovable/memory/index.md
```

## Invariants Preserved

- No `<form>`; all buttons `type="button"`.
- `_origin: local` protection on all new IDB stores.
- Every cross-scaffolding write goes through `scaffoldBus`; feature flag still kills all wiring.
- No raw `u` access; only public `FieldEngine` API.
- HSL semantic tokens only in new UI.

## Order & Stop Conditions

Phases 8 → 9 → 10 → 11 → 12 → 13. Each phase ships with its doc + memory + QA checklist; user sign-off gates the next. If any UQRC integration test fails, the phase is reverted and re-planned, not patched forward.
