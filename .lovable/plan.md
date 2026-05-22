## Crafting / Smelting Tab — Blacksmith UX

Add a fourth tab to `/remix` that lets users condense harvested chemicals into weighted SWARM coins (Craft) or break sealed coins back into project-scoped chemicals (Smelt). Visual theme: forge / blacksmith (warm ember palette, anvil silhouettes, glowing fill gauge).

### 1. New tab wiring
- **`src/pages/Remix.tsx`** — add a `Crafting` tab (between Lab and Brains). Use the same `Tabs` API.

### 2. New store: `src/lib/remix/coinCraftingStore.ts`
Single source of truth for craft progress. Local-only (no P2P). IndexedDB `swarm-coin-crafting` v1, throttled writes, `BroadcastChannel('swarm:coin-craft')` for cross-tab sync.

State per `coinId`:
```ts
type CraftProgress = {
  coinId: string;
  contents: Record<string, number>; // symbol -> atoms deposited
  fill: number;                     // 0..0.85 hard cap
  startedAt: string;
  updatedAt: string;
};
```

API: `loadActive(coinId)`, `deposit(coinId, symbol, count)`, `finalizeCraft(coinId)`, `cancelCraft(coinId)`, `subscribe(fn)`.

Fill math: each atom contributes weight proportional to its element's standard weight (read from existing element catalog in `src/lib/remix/moleculeCatalog.ts` if available, else atomic mass table). `fill = min(0.85, depositedWeight / coin.maxWeight)`. **Hard cap 85%** per spec — UI disables deposit beyond cap.

### 3. Coin lifecycle bridge
- **Craft finalize** updates the coin via existing chain APIs:
  - Mark `fillState: 'filling'` on first deposit, persist `weight` and a new optional `wrappedChemicals: { symbol, count }[]` field.
  - On `Craft` button click: set `fill` to current value, `fillState: 'sealed'` (carryable across projects), assign `ownerId` to the user wallet.
- **Smelt**: only `fillState === 'sealed'` coins. Smelting:
  1. Calls `recordHarvestForProject(projectId, contents)` — new helper in `harvestedInventory.ts` writing into a project-scoped namespace (`project:<id>`).
  2. Resets coin: clears `wrappedChemicals`, sets `fillState: 'pool'`, `ownerId: 'pool'`, `status: 'pool'` (returns to community pool).
  3. Only one smelt at a time — UI single-select + disabled state during async work.

### 4. New types extension
Add optional `wrappedChemicals?: { symbol: string; count: number }[]` to `SwarmCoin` in `src/lib/blockchain/types.ts` (optional, legacy-safe).

### 5. UI: `src/components/remix/CraftingTab.tsx`
Sub-tabs (Tabs/Toggle) `Craft | Smelt` — default `Craft`.

**Craft view (Blacksmith Forge):**
- Header: "Forge" with anvil/flame iconography (lucide `Hammer`, `Flame`).
- Left rail: list of user's unsealed coins (`fillState in ['pool','bound','filling']`) — click loads the crafter.
- Center "Anvil panel":
  - Glowing coin gauge (radial progress with ember gradient, capped visually at 85%).
  - Empty state: "Mine a SWARM coin first" if user has none.
- Right rail "Materials": grid of harvested chemicals with amount badges. Click → number input + `Deposit` button. Disabled rows: insufficient atoms or coin at 85%.
- Footer: `Craft Coin` button (enabled when `fill > 0`), `Cancel` returns deposits to inventory.

**Smelt view:**
- Grid of sealed coins (ownerId === user). Each card shows wrappedChemicals chips.
- Select one → `Smelt to Project` CTA (uses active projectId from `labProjectBridge.getActiveProjectId()`; gated if none).
- Confirm modal explains: "Coin returns to community pool; chemicals enter this project."

### 6. Helpers
- `harvestedInventory.ts` — add `recordHarvestForProject(projectId, parts)` and `getHarvestedForProject(projectId)` (separate IDB key per project).
- `coinCraftingStore.ts` — small element→atomic-weight table inline (covers H, C, N, O, common shells from workspace knowledge).

### Files
**New:** `src/lib/remix/coinCraftingStore.ts`, `src/components/remix/CraftingTab.tsx`, `src/components/remix/forge/ForgeAnvil.tsx`, `src/components/remix/forge/MaterialsRail.tsx`, `src/components/remix/forge/SmeltGrid.tsx`

**Edited:** `src/pages/Remix.tsx`, `src/lib/blockchain/types.ts` (optional field), `src/lib/remix/harvestedInventory.ts` (project-scoped helpers), `src/main.tsx` (hydrate crafting store).

### Out of scope
- P2P gossip of craft progress (local-only by design).
- Changes to mining or `coinFillScheduler` — craft fill is separate from UQRC stress fill (Craft writes `weight`/`wrappedChemicals`; UQRC scheduler still owns `stressAccrued`).
- Visual design directions — using existing tokens + ember accent palette.
