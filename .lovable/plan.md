# Small Improvements & Clean-up

Four focused passes — no new features, just polish, alignment, and cleanup.

## 1. Craft view — focus on the chosen coin

**File:** `src/components/remix/CraftingTab.tsx` (CraftView)

- Default behavior: show up to the **first 5 empty coins** in the rail.
- When the user picks one (`activeCoinId` set by the user, not auto), collapse the rail to **only that coin** + a small "Show all (N)" link to re-expand.
- Auto-selection of the first coin stays, but treat it as "preview" — clicking another or the same coin enters "focused" mode.
- Keeps anvil/materials columns unchanged.

## 2. Builder Bar — Lab creations as native tiles

**Files:** `src/components/brain/builder/BrainBuilderBar.tsx`, remove/retire `src/components/remix/LabPopover.tsx`

- Add a new `'lab'` virtual section to the bar (alongside House/Consumables/etc.). It does not exist in `PREFAB_SECTIONS`; the bar handles it as a special case.
- When `activeSection === 'lab'`, render tiles from `subscribeMintedPrefabs()` filtered by `projectId` using the same `PrefabTile` look (swatch, label, formula, size tier glyph). Each tile calls `selectPrefab(prefab.id)` the same way.
- **First tile** in the lab section is a compact "+ Create New" tile that navigates to `/remix?projectId=…` (replaces the popover entry point).
- Drop the floating `LabPopover` button from the top row; the section tab + first-tile CTA replaces it.
- Delete `src/components/remix/LabPopover.tsx` after removing its only import.

## 3. Hide mobile bottom nav

**Files:** `src/components/MobileBottomBar.tsx` (or its render site in `App.tsx`)

- Stop rendering `MobileBottomBar` entirely. Simplest: have the component return `null`. Leaves the desktop nav untouched. Users must leave the Brain via in-app affordances (top nav / route changes) before the social site chrome appears — which already matches the desktop pattern.
- Reclaims bottom safe-area for the Builder Bar on mobile.

## 4. Cleanup & doc alignment

- **NPC bug marker:** verify `docs/KNOWN_ISSUES.md` lists "NPCs not appearing in world" under a Bugged section (added previously). If missing, add a one-liner pointing at `NpcSwarmLayer.tsx` / `wetWork.ts`.
- **Dead scaffolding sweep (read-only audit first, then trim):**
  - `src/components/remix/LabPopover.tsx` → deleted in §2.
  - Remove the "SCAFFOLD STAGE" comment block in `BrainBuilderBar.tsx` header now that selection→commit is wired through `selectPrefab`.
  - Check `src/components/remix/ElementPicker.tsx`, `LabTab.tsx`, `VectorCanvas.tsx`, `lab.bus.ts`, `labProjectBridge.ts` for unused exports/dead branches introduced during the Lab iterations and prune.
- **Docs to refresh:** `docs/REMIX_LAB.md`, `docs/REMIX_LAB_BUGFIXES.md`, `docs/KNOWN_ISSUES.md`, and `.lovable/memory/features/remix-elemental-lab.md` — update the Lab/Builder Bar/Crafting sections to reflect: section-tab-based Lab tiles (no popover), 5-coin rail with focus-on-select, mobile bottom nav removed.
- Do **not** touch business logic in `coinCraftingStore.ts`, `harvestedInventory.ts`, `brainSubmissionsStore.ts`, or wallet/coin types — UI/cleanup only.

## Out of scope
- No changes to mint/smelt/craft math.
- No NPC fixes (still flagged Bugged).
- No new screens or design directions.
