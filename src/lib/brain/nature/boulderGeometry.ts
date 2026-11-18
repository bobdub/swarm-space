/**
 * boulderGeometry — procedural granite boulder mesh.
 *
 * Stone in the world is generated, not imported: an icosphere whose
 * vertices are pushed in and out by a seeded hash so every boulder has
 * its own lumpy, faceted silhouette. Same seed → identical shape on every
 * peer. Vertices that share a position move together so the surface
 * never tears.
 */
import * as THREE from 'three';

/** Deterministic [0,1) PRNG (LCG) seeded by an integer. */
function seeded(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Number of random bumps blended into the surface. */
const BUMPS = 7;

/**
 * Radial displacement for a unit direction: a base radius plus a few
 * seeded smooth bumps and dents, plus a flattened underside so the rock
 * sits on the ground instead of balancing on a point.
 */
export function boulderRadius(dir: [number, number, number], seed: number): number {
  const r = seeded(seed);
  let radius = 1;
  for (let i = 0; i < BUMPS; i++) {
    // Random bump centre on the unit sphere.
    const z = r() * 2 - 1;
    const a = r() * Math.PI * 2;
    const k = Math.sqrt(1 - z * z);
    const cx = Math.cos(a) * k, cy = z, cz = Math.sin(a) * k;
    const amp = (r() - 0.45) * 0.36;
    const width = 3 + r() * 5;
    const dot = dir[0] * cx + dir[1] * cy + dir[2] * cz;
    radius += amp * Math.exp(-width * (1 - dot));
  }
  if (dir[1] < -0.35) radius *= 0.75 + 0.25 * (1 + dir[1]) / 0.65;
  return Math.max(0.55, Math.min(1.45, radius));
}

export function buildBoulderGeometry(seed: number, detail = 2): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const cache = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = Math.hypot(x, y, z) || 1;
    const key = `${(x / n).toFixed(4)},${(y / n).toFixed(4)},${(z / n).toFixed(4)}`;
    let rad = cache.get(key);
    if (rad === undefined) {
      rad = boulderRadius([x / n, y / n, z / n], seed);
      cache.set(key, rad);
    }
    pos.setXYZ(i, (x / n) * rad, (y / n) * rad, (z / n) * rad);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}
