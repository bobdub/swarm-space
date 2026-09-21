# Brain Tools — unlocked starters and a Stone Pick

## Goal

The five starter tools (Axe, Shovel, Knife, Bucket, Pick) are what you use to gather everything else, so they must never be locked behind gathered materials. A Pick is currently missing entirely.

## What changes

1. **Starter tools are free.** Axe, Shovel, Knife, Bucket and Pick show "Free" in the inventory, are never dimmed, and can always be picked up and held. Everything else (walls, roofs, doors) keeps its material cost exactly as today.

2. **New Stone Pick.** A fifth starter tool appears in the Tools section — a stone-headed pick on a timber handle, held and swung like the axe.

3. **Mining.** Swinging the Pick at rock — mountain and volcano rock faces — chips stone loose and drops it on the ground to pick up, the same way chopping a tree drops wood. Swinging it into the ground breaks into stone shells as well. The Axe stays the wood tool; the Pick is the stone tool.

## Technical notes

- `prefabHouseCatalog.ts`: add `tool_pick_stone` in the `tools` section (C₁₃·SiO₂, density ~1.7, ~0.12×0.04×0.70 m), mirroring the axe entry.
- `toolCatalog.ts`: add a matching `ToolSpec` with handle/head/binding parts and a new `'mine'` action kind, so `getToolAny` resolves it and the impact predicate derives mass/sharpness/head density like the other tools.
- `materials.ts`: `prefabCostFor` returns an empty cost for a `STARTER_TOOL_IDS` set (knife, axe, shovel, bucket, pick). That single point makes tiles read "Free", keeps the inventory button enabled, and makes any spend path a no-op.
- `toolActions.ts`: `verbFor` maps `tool_pick` → `'mine'`; a `mineRock` branch runs the shared `applyImpact` swing against `mountain` / `volcano` targets and, on a successful cut, calls `spawnDrop({ kind: 'stone' })` near the hit; `digShell` already accepts any tool with a resolved spec, so the pick digs stone shells.
- Verify with typecheck, build, and a Playwright pass through the inventory confirming all five tool tiles are enabled and read "Free".
