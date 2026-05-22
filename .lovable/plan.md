## Goal

Mark NPC embodiment as known-bugged, then deliver Phase: Lab UX upgrades. Lab becomes the canonical entrypoint for project-scoped creations, with live element accounting, harvested-vs-locked gating, project-detection from origin, minted assets always landing in the originating project's Builder Bar (under the Lab icon), and a clearer size dropdown.

## Part A — Mark NPCs as bugged (defer)

- Add `docs/KNOWN_ISSUES.md` entry: "NPCs not embodied in world — markers removed, bodies fail to render after anchor heal. Re-anchor logic in `npcEngine.reanchorNpc` runs but `BuilderBlockEngine` does not produce visible bodies in scene. Deferred."
- Add a small `BUGGED` banner in `NpcSwarmLayer.tsx` dev overlay (only when `?debug=npc`) so we don't keep re-debugging it.
- Append caretaker note to `MemoryGarden.md`.
- No code changes to NPC pipeline. Scheduler still runs (cheap, idempotent).

## Part B — Lab upgrades

### B1. Lab icon in Builder Bar opens a popover with project creations

Replace the current direct `navigate('/remix')` button in `BrainBuilderBar.tsx` with a popover:

- Lists existing Lab submissions for the active project (via `listSubmissionsForProject(projectId)` + `listMintedPrefabs()` filtered by project tag).
- Each row is selectable as a Builder prefab tile (calls `selectPrefab`).
- Top row: a "+ Create New" button that navigates to `/remix?projectId=<id>`.
- Popover uses `shadcn/ui Popover`. No `<form>` element — `role="form"` + `type="button"` per project rules.

### B2. Auto-detect project from origin

- `BrainBuilderBar` knows the active project id (already drives the universe). It passes `projectId` to the Lab popover and to the `/remix?projectId=…` link.
- `LabTab.tsx` reads `?projectId` from `useSearchParams` on mount. If present, calls `setActiveProjectId(id)` and pre-selects it in `ProjectPicker`. Picker still visible as override but no longer required.

### B3. Show harvested chemicals (in-world inventory)

- New module `src/lib/remix/harvestedInventory.ts`:
  - Subscribes to `wetWork`/`toolActions` harvest events (existing buses) and accumulates element-symbol counts per actor.
  - Persists to IndexedDB `swarm-harvested-inventory` v1 (non-destructive upgrade pattern).
  - Exposes `subscribeHarvested(fn)`, `getHarvested(symbol): number`, `listHarvested()`.
- Hydrate from `src/main.tsx` on idle.
- Wire `setHoldingLookup` in `elementHoldings.ts` to a composite source: wallet (existing) OR harvested inventory. Harvested counts unlock elements via the existing sticky-unlock path.

### B4. Visual locked icon for un-harvested elements

- `ElementPicker.tsx`: for each element/molecule tile, compute `isElementUnlocked(symbol)` for every constituent. If any are locked, overlay a `Lock` glyph (lucide) and show count requirement in tooltip (`Needs: 2× O, 1× H`).
- Locked tiles remain clickable (so user sees the requirement) but show a `Locked` toast on draw attempt.

### B5. Live chemical deduction while drawing

- `VectorCanvas.tsx` already emits stroke events to `labField`. Add a per-stroke accountant:
  - On each stroke commit, compute consumed atoms = stroke-length × density × molecule.constituents.
  - Subtract from a session ledger held in `harvestedInventory` (commits debit on successful Mint/Submit; pending strokes show "−N" preview).
- `LabTab.tsx` HUD strip gains a "Chemicals" panel: live row per symbol showing `held − pending = remaining`. Updates at the existing 4 Hz subscribe rate.

### B6. Minted assets always go to project Builder Bar

- `mintMolecule` already routes to `mintedPrefabsStore`. Extend `MintedRecord` with optional `projectId`.
- `LabTab.handleMint` reads active projectId and passes it through, so the mint is tagged.
- `Submit to Project` button additionally calls `mintMolecule` (so it also "mints to wallet" / Builder Bar). The two flows become: Mint = local only; Submit = mint + project-tag + bridge gossip.
- Builder Bar Lab popover filters mints by `projectId` so each project shows only its own creations.

### B7. Size dropdown in Lab

- Replace the hardcoded `0.4×0.4×0.4` defaults in `labMint.deriveMintedPrefab` with a `size` enum:
  - `small`     — 0.25×0.25×0.30 (tools, always used when user selected Forge as Tool)
  - `standard`  — 1.0×0.2×2.4 (wall-sized)
  - `structure` — 4.0×4.0×3.0 (traversable building)
  - `painting`  — 1.2×0.05×0.8 (hangs on `standard`/`structure`; section = `decor`)
- Add `SIZE_PRESETS` map in `labMint.ts`; `LabMintOptions` gains `sizePreset?: 'small'|'standard'|'structure'|'painting'`.
- `LabTab.tsx` adds a shadcn `Select` next to Mint button. Forge as Tool always forces `small`.
- For `painting`, set `sectionId: 'decor'` and add a `mountable: true` flag on the Prefab so the placement controller snaps it to wall surfaces (placement logic itself is out of scope; flag only).

## Technical changes

| File | Change |
|---|---|
| `docs/KNOWN_ISSUES.md` (new) | Log NPC embodiment bug |
| `MemoryGarden.md` | Caretaker reflection |
| `src/components/brain/npc/NpcSwarmLayer.tsx` | `?debug=npc` BUGGED banner only |
| `src/components/brain/builder/BrainBuilderBar.tsx` | Lab icon → Popover (creations + Create New); accept `projectId` prop |
| `src/components/remix/LabPopover.tsx` (new) | Popover UI for Lab creations in Builder Bar |
| `src/lib/remix/harvestedInventory.ts` (new) | IDB inventory, subscribe API |
| `src/lib/remix/elementHoldings.ts` | Wire composite holding lookup |
| `src/main.tsx` | Hydrate harvested inventory on idle |
| `src/components/remix/LabTab.tsx` | Read `?projectId`, size dropdown, chemicals HUD, Submit also mints |
| `src/components/remix/ElementPicker.tsx` | Lock overlay + tooltip |
| `src/components/remix/VectorCanvas.tsx` | Emit per-stroke consumption to inventory ledger |
| `src/lib/remix/labMint.ts` | `SIZE_PRESETS`, `sizePreset` option, `mountable` flag for painting |
| `src/lib/remix/labProjectBridge.ts` | Submit also calls `mintMolecule` with `projectId` |
| `src/lib/remix/mintedPrefabsStore.ts` | Optional `projectId` on `MintedRecord` |

## Out of scope

- Actually fixing NPC embodiment (deferred — bug logged).
- Painting wall-snap placement logic (flag only).
- P2P sync of harvested inventory (local IDB only).
- Wallet integration for minted-asset payouts beyond what already exists.

## Expected result

- NPCs explicitly flagged bugged; no more debugging churn this cycle.
- Builder Bar Lab icon shows that project's creations inline with a "+ Create New".
- Lab opens already scoped to the originating project, no manual pick.
- Users see exactly which chemicals they have, what's locked, and what each stroke costs.
- Every mint lands in the originating project's Builder Bar; Submit additionally gossips and mints.
- Asset size is a clear dropdown (Small/Standard/Structure/Painting) with sane defaults per tier.
