# World Sculpting & Tools (UQRC)

Status: **light scaffolding** — modules exist and compile, no behavioural
wiring yet (no User click handler, no NPC drive body, no renderer
mutation of the planet mesh).

## Premise

Users (and NPCs) sculpt the world voxel-style by **placing** real,
composite hand-tools and **swinging** them at targets. There is no
special "creative mode" — placement and use both flow through the same
`BuilderBlockEngine` path that powers House prefabs, and every swing is
resolved by the same predicate.

## The single predicate

`src/lib/brain/sculpting.ts → applyImpact(...)` returns `cut: true` when

```text
effectiveCut = (swingEnergy * tool.sharpness) / resistance ≥ 1

resistance   = W_DENSITY · density
             + W_BOND    · bondTerm
             + W_CURVE   · ||[D_μ, D_ν]||
```

Density **contributes** to resistance — it does not define it. A sharp
knife can slowly whittle bedrock; a dull shovel cannot dig granite even
if the density alone would allow it.

## Tools (Phase 1)

| Tool          | Action     | Handle | Head | Binding |
|---------------|-----------|--------|------|---------|
| Stone Knife   | `whittle` | C (oak)| Si   | C (vine)|
| Stone Axe     | `chop`    | C      | Si   | C       |
| Stone Shovel  | `dig`     | C      | Si   | C       |

Each tool is published as both:
1. A **Prefab** in `prefabHouseCatalog.ts` (so the Builder Bar's `Tools`
   tab places it through the existing path).
2. A **Tool** in `toolCatalog.ts` (carrying derived `baseSharpness`,
   `headDensity`, and `actionKind`).

Once placed, the tool's underlying `BuilderBlock` is the persistent
state carrier (`block.meta.sharpness`).

## Sharpening

`Salt Rock` (NaCl) is the consumable. `toolSharpening.ts → sharpenTool`
grows sharpness toward 1.0 with diminishing returns and consumes the
salt block. Wear is automatic (`applyToolWear`) per swing.

## NPC parity

NPC drives `craft` and `sculpt` (stubs in `npcDrives.ts`, follow-up)
look up nearby tool blocks and call `applyImpact` exactly like Users.
There is no NPC-only mutation path.

## Pre-patches landed alongside

- **Earth shells** (`earthShells.ts`) — symmetric N=0..4..0 stratigraphy
  with per-layer density and sharpness threshold.
- **Horizon fade** (`horizonFade.ts`) — `evolutionHorizonAlpha(d)` smooth
  ramp around `√(2·R·h) ≈ 76 m`.

See `docs/EARTH_CORE_SHELLS.md` for the layer table.

## Out of scope (follow-ups)

- Click target picker + ghost preview.
- Per-shell secondary basin minima in `lavaMantle.ts` (so dug cavities
  rest the body on bedrock instead of sliding to the core).
- `<HorizonFog/>` component + LOD swap in `EarthBody`.
- Renderer for opened shell cavities.
- Persistence of carved cells.