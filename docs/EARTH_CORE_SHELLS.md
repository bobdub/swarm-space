# Earth Core Shells (UQRC stratigraphy)

Symmetric N = 0 → 4 → 0 stack. Source of truth: `src/lib/brain/earthShells.ts`.
Fractions are of `EARTH_RADIUS`. Boring straight down passes through every
entry from top to bottom and back up the antipode.

| Side    | n | Layer            | r (frac)        | Density g/cm³ | Sharpness ≥ |
|---------|---|------------------|-----------------|---------------|-------------|
| outer   | 0 | Air              | 1.000 .. 1.060  | 0.0012        | 0.00        |
| outer   | 1 | Grass            | 0.992 .. 1.000  | 0.4           | 0.05        |
| outer   | 1 | Soil             | 0.984 .. 0.992  | 1.3           | 0.05        |
| outer   | 1 | Dirt             | 0.972 .. 0.984  | 1.6           | 0.10        |
| outer   | 1 | Mixed Earth      | 0.940 .. 0.972  | 1.9           | 0.15        |
| outer   | 2 | Bedrock          | 0.850 .. 0.940  | 2.7           | 0.45        |
| outer   | 2 | Coal Seam        | 0.800 .. 0.850  | 1.4           | 0.30        |
| outer   | 2 | Oil Reservoir    | 0.760 .. 0.800  | 0.9           | 0.20        |
| outer   | 2 | Mixed Minerals   | 0.680 .. 0.760  | 3.4           | 0.55        |
| outer   | 2 | Gold Vein        | 0.620 .. 0.680  | 19.3          | 0.50        |
| outer   | 2 | Platinum         | 0.550 .. 0.620  | 21.4          | 0.65        |
| outer   | 3 | Diamond (Upper)  | 0.480 .. 0.550  | 3.5           | 0.95        |
| outer   | 3 | Deep Aquifer     | 0.420 .. 0.480  | 1.0           | 0.10        |
| outer   | 3 | Obsidian         | 0.380 .. 0.420  | 2.6           | 0.70        |
| outer   | 3 | Lava             | 0.200 .. 0.380  | 3.1           | 1.00 (burns)|
| center  | 4 | CENTER           | 0.000 .. 0.200  | 12.0          | 1.00        |
| inner   | … | mirrored …       | …               | …             | …           |

The `inner` half is `OUTER_DESCENT.reverse().map(mirror)` — same data,
suffixed `_mirror`. The renderer never needs to know about the mirror;
`sampleShellAt(rFrac)` walks the outer half only.

## Why the layers

- **n=1 surface biosphere** is a thin skin a Shovel can clear quickly.
- **n=2 resource zone** is the deepest carve-able shell with
  prospecting payoff (ore veins).
- **n=3 mantle transition** mixes the only shells where sharpness
  alone gates progress (Diamond ≥ 0.95; Lava is permanent stop).
- **n=4 CENTER** is a singular point — sculpting cannot enter it.

## Pre-patch invariant

The mantle's secondary basin minima (one per shell, follow-up wiring in
`lavaMantle.ts`) ensure a body that falls into a dug cavity rests on
the next shell down, not on the mantle floor. Without that, digging
through soil drops the avatar to the core.