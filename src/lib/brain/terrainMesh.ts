/**
 * terrainMesh — one terrain manifold shared by the renderer and physics.
 *
 * Before this module the Earth had two terrains:
 *   - the GPU drew it, re-deriving the continents noise in GLSL float32 on
 *     a 256×128 sphere and linearly interpolating between vertices;
 *   - physics walked on the analytic float64 noise, sampled continuously.
 *
 * The two disagree. The value-noise hash is chaotic (`fract` of large
 * products), so float32 and float64 land on different sides of the
 * coastline for ~0.5 % of the planet: the GPU draws a 6 m land plateau
 * where physics sees open ocean (the player stands inside the hill) or
 * the reverse. Between vertices the triangles cut corners the analytic
 * curve does not. In UQRC terms the render operator and the physics
 * operator did not commute — ‖[D_render, D_physics]‖ ≠ 0 — and the
 * residual showed up as sinking through the ground and a broken horizon.
 *
 * Here the terrain is evaluated ONCE per vertex, in JS (float64), and
 * baked into a lat/long grid that matches three.js `SphereGeometry`
 * vertex-for-vertex. The renderer displaces the sphere with these baked
 * heights; physics and feet placement intersect the very same triangles
 * via `sampleTerrainLift`. Same vertices, same triangles, same surface:
 * the commutator is zero by construction.
 *
 * Pure data — no React, no three.js. The geometry itself is assembled in
 * EarthBody.tsx from `getTerrainGrid()`.
 */
import { EARTH_RADIUS, EARTH_SPHERE_RINGS, EARTH_SPHERE_SEGMENTS } from './earth';
import { getVolcanoOrgan, SHARED_VOLCANO_ANCHOR_ID, sampleVolcanoElevation } from './volcanoOrgan';
import { sampleContinents, LAND_LIFT, landMaskFromContinents, seaDepthFromContinents } from './surfaceProfile';

type Vec3 = [number, number, number];

export interface TerrainGrid {
  /** Width segments (longitude). */
  W: number;
  /** Height segments (latitude rings). */
  H: number;
  /** Unit directions, (H+1)·(W+1)·3, in three.js SphereGeometry order. */
  dirs: Float64Array;
  /** Metres above sea level (EARTH_RADIUS) at each vertex: land lift +
   *  volcano on land, negative (the sea floor) out at sea. */
  lift: Float64Array;
  /** Continents noise value at each vertex (drives colour bands). */
  continents: Float64Array;
  /** Volcano elevation (m) at each vertex (drives volcanic colour). */
  volcano: Float64Array;
}

let _grid: TerrainGrid | null = null;

/**
 * Vertex direction exactly as three.js SphereGeometry builds it
 * (phiStart = 0, phiLength = 2π, thetaStart = 0, thetaLength = π):
 *   x = −cos(φ)·sin(θ),  y = cos(θ),  z = sin(φ)·sin(θ)
 */
function vertexDir(ix: number, iy: number, W: number, H: number): Vec3 {
  const phi = (ix / W) * Math.PI * 2;
  const theta = (iy / H) * Math.PI;
  const st = Math.sin(theta);
  return [-Math.cos(phi) * st, Math.cos(theta), Math.sin(phi) * st];
}

/** Bake (once) the terrain heights at every rendered vertex. */
export function getTerrainGrid(): TerrainGrid {
  if (_grid) return _grid;
  const W = EARTH_SPHERE_SEGMENTS;
  const H = EARTH_SPHERE_RINGS;
  const count = (W + 1) * (H + 1);
  const dirs = new Float64Array(count * 3);
  const lift = new Float64Array(count);
  const continents = new Float64Array(count);
  const volcano = new Float64Array(count);
  const organ = getVolcanoOrgan(SHARED_VOLCANO_ANCHOR_ID);
  let i = 0;
  for (let iy = 0; iy <= H; iy++) {
    for (let ix = 0; ix <= W; ix++, i++) {
      const d = vertexDir(ix, iy, W, H);
      dirs[i * 3] = d[0];
      dirs[i * 3 + 1] = d[1];
      dirs[i * 3 + 2] = d[2];
      const c = sampleContinents(d);
      const v = sampleVolcanoElevation(organ, d);
      continents[i] = c;
      volcano[i] = v;
      const land = landMaskFromContinents(c);
      const raised = land * LAND_LIFT + v;
      // Off the coast the ground is the sea floor: shelf, slope, ocean bed.
      // The volcano cone still rises out of the sea where it reaches it.
      lift[i] = raised - seaDepthFromContinents(c) * (1 - Math.min(1, v / 2));
    }
  }
  _grid = { W, H, dirs, lift, continents, volcano };
  return _grid;
}

/** Test hook: drop the baked grid (e.g. after a volcano organ reset). */
export function resetTerrainGrid(): void {
  _grid = null;
}

function vertexPos(g: TerrainGrid, idx: number): Vec3 {
  const r = EARTH_RADIUS + g.lift[idx];
  return [g.dirs[idx * 3] * r, g.dirs[idx * 3 + 1] * r, g.dirs[idx * 3 + 2] * r];
}

/**
 * Ray (from the centre along unit `d`) against triangle (a, b, c).
 * Returns the hit distance and the most negative barycentric weight
 * (≥ 0 means the ray passes inside the triangle).
 */
function rayTriangle(d: Vec3, a: Vec3, b: Vec3, c: Vec3): { t: number; inside: number } | null {
  const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
  const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
  // Plane normal n = e1 × e2; t = (n·a)/(n·d).
  const nx = e1y * e2z - e1z * e2y;
  const ny = e1z * e2x - e1x * e2z;
  const nz = e1x * e2y - e1y * e2x;
  const nd = nx * d[0] + ny * d[1] + nz * d[2];
  if (Math.abs(nd) < 1e-12) return null;
  const t = (nx * a[0] + ny * a[1] + nz * a[2]) / nd;
  // Barycentrics of p = t·d.
  const px = d[0] * t - a[0], py = d[1] * t - a[1], pz = d[2] * t - a[2];
  const d00 = e1x * e1x + e1y * e1y + e1z * e1z;
  const d01 = e1x * e2x + e1y * e2y + e1z * e2z;
  const d11 = e2x * e2x + e2y * e2y + e2z * e2z;
  const d20 = px * e1x + py * e1y + pz * e1z;
  const d21 = px * e2x + py * e2y + pz * e2z;
  const den = d00 * d11 - d01 * d01;
  if (Math.abs(den) < 1e-18) return null;
  const v = (d11 * d20 - d01 * d21) / den;
  const w = (d00 * d21 - d01 * d20) / den;
  const u = 1 - v - w;
  return { t, inside: Math.min(u, v, w) };
}

/**
 * Metres above EARTH_RADIUS of the RENDERED ground along an Earth-local
 * unit normal: the exact intersection of that ray with the displaced
 * triangle the GPU draws there. Includes land lift and the volcano cone;
 * negative out at sea, where the ground is the sea floor.
 */
export function sampleTerrainLift(localN: Vec3): number {
  const g = getTerrainGrid();
  const { W, H } = g;
  const len = Math.hypot(localN[0], localN[1], localN[2]) || 1;
  const d: Vec3 = [localN[0] / len, localN[1] / len, localN[2] / len];
  const theta = Math.acos(Math.max(-1, Math.min(1, d[1])));
  let phi = Math.atan2(d[2], -d[0]);
  if (phi < 0) phi += Math.PI * 2;
  let ix = Math.floor((phi / (Math.PI * 2)) * W);
  let iy = Math.floor((theta / Math.PI) * H);
  ix = Math.min(W - 1, Math.max(0, ix));
  iy = Math.min(H - 1, Math.max(0, iy));

  let best: { t: number; inside: number } | null = null;
  // Test this cell and its neighbours: floating-point rounding at a cell
  // edge must never pick a triangle the ray does not pass through.
  for (let oy = -1; oy <= 1; oy++) {
    const cy = iy + oy;
    if (cy < 0 || cy >= H) continue;
    for (let ox = -1; ox <= 1; ox++) {
      const cx = (ix + ox + W) % W;
      const a = cy * (W + 1) + cx + 1;
      const b = cy * (W + 1) + cx;
      const c = (cy + 1) * (W + 1) + cx;
      const dd = (cy + 1) * (W + 1) + cx + 1;
      // Same triangle split as three.js SphereGeometry: (a,b,d) except on
      // the top cap row, (b,c,d) except on the bottom cap row.
      if (cy !== 0) {
        const hit = rayTriangle(d, vertexPos(g, a), vertexPos(g, b), vertexPos(g, dd));
        if (hit && hit.t > 0 && (!best || hit.inside > best.inside)) best = hit;
      }
      if (cy !== H - 1) {
        const hit = rayTriangle(d, vertexPos(g, b), vertexPos(g, c), vertexPos(g, dd));
        if (hit && hit.t > 0 && (!best || hit.inside > best.inside)) best = hit;
      }
    }
  }
  if (!best) return 0;
  return best.t - EARTH_RADIUS;
}
