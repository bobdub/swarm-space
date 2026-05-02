---
name: Remix / Lab scaffolding bug-fix pass
description: Fixes for Lab crash on draw (canvas can't resolve CSS vars), missing back button, default brush = wood, basics (wood/stone/vine), Test Mixes sandbox, holdings-gated Au, always-unlocked C, asset size tiers (tool/block/structure/nature), Brains tab Starter card + Submit Brain entry, mobile HUD (collapse Chat/Portal labels, safe-area pad on Builder Bar).
type: feature
---

- `VectorCanvas` must route stroke colors through `safeStroke()` — Canvas
  2D does NOT resolve `hsl(var(--…))`. Default brush is concrete hex.
- Lab default brush: `mol:cellulose_wood` (`#a47148`). Basics in
  `moleculeCatalog.ts`: `cellulose_wood`, `stone_granite`, `vine_lignin`.
- Element colors should pass through
  `src/lib/remix/fieldElementColor.ts::fieldColor(symbol, shell, q)` once
  the field tick is wired. Static `ELEMENT_COLORS` is the *base* only.
- Holdings gate: `src/lib/remix/elementHoldings.ts`. `Au` requires liquid
  holdings (sticky unlock); `C` always unlocked. `maxConsumable(symbol)`
  caps single-creation usage.
- Size tiers: `src/lib/brain/assetSizing.ts::classifySize()` returns
  `tool | block | structure | nature`. Builder Bar tile shows the chip.
- HUD on mobile: `Chat` + `Portal` buttons collapse to icon-only on
  `< sm`. Builder Bar uses
  `pb-[max(env(safe-area-inset-bottom),16px)]` to clear bottom nav.
- Brains tab: ships a Starter `Project Brain` remix card (navigates to
  `/brain`) and a `Submit Brain` button (toast scaffold for now).

See `docs/REMIX_LAB_BUGFIXES.md` for the full pass.