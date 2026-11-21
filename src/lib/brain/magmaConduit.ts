/**
 * magmaConduit — the shared volcano's magma column, from the deep mantle
 * up through a narrow neck to the lava lake in the crater.
 *
 * Purely visual and read from the shared Earth clock, so every peer sees
 * the same column; nothing here touches the terrain, the physics floor or
 * the mantle field (`lavaMantle.ts`), so the crater you stand in is the
 * same baked ground as before.
 *
 * - Geometry: a hyperboloid sleeve along the volcano's centre normal. It
 *   is narrowest at the neck under the crater (`throatRadius`) and opens
 *   with depth, r(d) = r₀·√(1 + (d/a)²), into a plume head that reaches
 *   down to the core-mantle boundary at r ≈ 0.35 R (`CONDUIT_BASE_FRAC`),
 *   where hot plumes are born.
 * - Flow: buoyant magma rises along +n̂. Through a pipe a viscous melt
 *   flows as Poiseuille flow, u(ρ) = u₀(1 − ρ²): fastest on the axis and
 *   held back by drag at the walls (`upwellSpeedAt`). At the top it spreads
 *   radially across the lake; with no sink at the surface the area it
 *   covers grows steadily, so it slows as 1/r and crust thickens toward the
 *   rim, where it founders back down.
 * - Head: the lake level breathes. Gas slugs rise and burst on a shared
 *   Strombolian cycle (`STROMBOLIAN_PERIOD_S`), swelling the surface before
 *   each burst, and the solid-Earth tide pulls the column with the sea
 *   (`tideAt` at the vent), so the lake rises and falls with the Moon.
 */

import { EARTH_RADIUS } from './earth';
import { tideAt } from './sea/seaSurface';
import type { VolcanoOrgan } from './volcanoOrgan';
import { volcanoLavaRadius } from './volcanoEffects';

/** Where the conduit starts: the core-mantle boundary (fraction of R). */
export const CONDUIT_BASE_FRAC = 0.35;
/** Neck radius as a share of the crater radius. */
export const THROAT_FRAC = 0.3;
/** Depth scale (m) over which the sleeve opens out (hyperboloid `a`). */
export const CONDUIT_FLARE_M = 320;
/** Axial rise speed on the conduit's axis (m/s), drawn. */
export const UPWELL_AXIS_SPEED = 2.4;
/** Seconds between Strombolian gas-slug bursts, on the shared clock. */
export const STROMBOLIAN_PERIOD_S = 47;
/** How far a rising slug swells the lake before it bursts (m). */
export const SLUG_SWELL_M = 0.6;

export function throatRadius(organ: VolcanoOrgan): number {
  return organ.craterRadius * THROAT_FRAC;
}

/** Depth (m) from the lake surface down to the conduit's root. */
export function conduitDepth(organ: VolcanoOrgan): number {
  return volcanoLavaRadius(organ) - CONDUIT_BASE_FRAC * EARTH_RADIUS;
}

/** Sleeve radius (m) at depth `d` (m) below the lake: a hyperboloid. */
export function conduitRadiusAt(organ: VolcanoOrgan, d: number): number {
  const u = Math.max(0, d) / CONDUIT_FLARE_M;
  return throatRadius(organ) * Math.sqrt(1 + u * u);
}

/** Poiseuille rise speed (m/s) at normalised radius ρ (0 axis … 1 wall). */
export function upwellSpeedAt(rho: number): number {
  const r = Math.min(1, Math.max(0, Math.abs(rho)));
  return UPWELL_AXIS_SPEED * (1 - r * r);
}

/** Phase (0…1) through the Strombolian cycle at shared time `t`: the
 *  burst happens at 0. */
export function slugPhaseAt(t: number): number {
  const p = (t / STROMBOLIAN_PERIOD_S) % 1;
  return p < 0 ? p + 1 : p;
}

/**
 * Lake level offset (m) above its mean at shared time `t`: the slug swell
 * building through the cycle and dropping at the burst, plus the tide at
 * the vent.
 */
export function magmaHeadAt(organ: VolcanoOrgan, t: number): number {
  const p = slugPhaseAt(t);
  // Swells slowly as the slug rises (last third of the cycle), drops fast.
  const swell = p < 0.66 ? 0 : SLUG_SWELL_M * Math.pow((p - 0.66) / 0.34, 2);
  return swell + tideAt(organ.centerNormal, t);
}

/**
 * Lathe profile for the sleeve in the crater frame (+y up the centre
 * normal, y = 0 at the lake): [radius, y] pairs from the root to the neck.
 */
export function conduitProfile(organ: VolcanoOrgan, steps = 12): [number, number][] {
  const depth = conduitDepth(organ);
  const pts: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    // Denser near the neck, where the eye looks.
    const f = 1 - i / steps;
    const d = depth * f * f;
    pts.push([conduitRadiusAt(organ, d), -d]);
  }
  return pts;
}
