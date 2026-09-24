# Remix / Lab — Scaffolding Bug-Fix Pass

_Tracks the user-reported scaffolding bugs in the Lab + Builder Bar HUD
and the light-touch fixes applied in this pass. None of the changes wire
new field behavior — they correct broken interactions and stand up the
missing surfaces for follow-up wiring._

## Builder Bar / HUD (mobile)

- **Top-right cluster cluttered, Portal sits below the hammer icon.** The
  HUD row already wraps via `flex-wrap`. We tightened it by collapsing
  the `Chat` and `Portal` button labels on `< sm` breakpoints (icon-only
  on phones, label appears at `sm:` and up). `BuilderActivator` keeps its
  circular icon footprint.
- **Builder Bar clipped below the viewport.** Replaced the bare `py-2`
  with `pb-[max(env(safe-area-inset-bottom),16px)] pt-2` so the bar
  always clears the iOS/Android home indicator and the floating bottom
  nav.

## Lab

- **No way back to Builder Mode.** Added an `ArrowLeft Builder` ghost
  button at the top of `LabTab` (navigates to `/`).
- **Drawing crash when no element selected.** `Canvas2D.strokeStyle` does
  not resolve CSS custom properties; the previous default
  `'hsl(var(--primary))'` produced an invalid color and on some browsers
  the resulting NaN line width crashed the raster. `VectorCanvas` now
  routes every color through `safeStroke()` which falls back to a
  concrete hex.
- **Defaults & basics.** Brush now defaults to `mol:cellulose_wood`
  (`#a47148`). `moleculeCatalog.ts` ships three new "Basics" molecules at
  the top of its list:
  - `cellulose_wood` — Wood (Cellulose), `(C₆H₁₀O₅)ₙ`
  - `stone_granite` — Stone (Granite), `SiO₂·Fe`
  - `vine_lignin`   — Tree Vine (Lignin), `C₉H₁₀O₂`
- **Elemental colors should be field-driven.** Added
  `src/lib/remix/fieldElementColor.ts` exposing `fieldColor(symbol, shell, q)`
  — modulates CPK base color by shell index and local Q-score. Call sites
  opt-in once the field tick is wired.
- **Test Mixes sandbox.** `TestMixesPanel` mounts under the canvas; lets
  the user pick 1–4 element slots and previews the resulting blended
  color, formula and shell tags via the same `blendColor` used for
  prefabs.

## Holdings-gated elements

`src/lib/remix/elementHoldings.ts` codifies:

- **Au (Gold)** — locked unless the user holds Gold tokens. A creation
  may not consume more `Au` atoms than the user holds in liquid form.
- **C (Carbon)** — always unlocked (diamond is compressed carbon).
- **Sticky unlock** — once an element is observed as held in a session
  it stays unlocked even if the balance later drops to zero.

The wallet bridge wires `setHoldingLookup(...)` in a follow-up.

## Asset sizing tiers

`src/lib/brain/assetSizing.ts` exposes `classifySize()` and
`SIZE_TIER_META`. The Builder Bar tile now displays a small chip showing
the tier (`Tool`, `Block`, `Structure`, `Nature`) so users can predict
how big the asset will be before placement.

## Brains tab

- **Starter Brain.** `BrainsTab` now ships a "Starter — Project Brain"
  card with a `Remix this Brain` button (navigates to `/brain`; the real
  clone-into-fresh-project flow lands with the Brains gallery).
- **Submit Brain.** A top-right `Submit Brain` button stands the entry
  point up with a toast confirming the gallery wiring follow-up.