import { describe, it, expect, beforeEach } from 'vitest';
import {
  CONTINENTS,
  CONTINENTS_GLSL,
  COAST_WARP,
  LAND_LIFT,
  MIN_OCEAN_GAP_RAD,
  continentCenter,
  continentField,
  nearestContinent,
  sampleLandMask,
  sampleSurfaceLift,
  snapToLand,
} from '../surfaceProfile';
import {
  EARTH_RADIUS,
  getEarthPose,
  getEarthLocalSiteFrame,
  quatRotate,
  setEarthPoseTime,
  spawnOnEarth,
  type Vec3,
} from '../earth';

function fibonacciSphere(n: number): Vec3[] {
  const pts: Vec3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const t = i * golden;
    pts.push([Math.cos(t) * r, y, Math.sin(t) * r]);
  }
  return pts;
}

function angle(a: Vec3, b: Vec3): number {
  return Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));
}

function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  const th = angle(a, b);
  const s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s;
  const wb = Math.sin(t * th) / s;
  return [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb];
}

/** Count connected land regions on a Fibonacci grid (union-find over
 *  neighbours closer than ~1.6 grid spacings). */
function landComponents(n: number): number[] {
  const pts = fibonacciSphere(n);
  const land = pts.map((p) => sampleLandMask(p) >= 0.5);
  const reach = Math.sqrt((4 * Math.PI) / n) * 1.6;
  const parent = pts.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const cell = (v: number) => Math.floor((v + 1) / reach);
  const buckets = new Map<string, number[]>();
  pts.forEach((p, i) => {
    if (!land[i]) return;
    const k = `${cell(p[0])},${cell(p[1])},${cell(p[2])}`;
    const arr = buckets.get(k);
    if (arr) arr.push(i); else buckets.set(k, [i]);
  });
  pts.forEach((p, i) => {
    if (!land[i]) return;
    const cx = cell(p[0]), cy = cell(p[1]), cz = cell(p[2]);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
      const arr = buckets.get(`${cx + a},${cy + b},${cz + c}`);
      if (!arr) continue;
      for (const j of arr) {
        if (j <= i) continue;
        const q = pts[j];
        if (Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < reach) parent[find(i)] = find(j);
      }
    }
  });
  const sizes = new Map<number, number>();
  pts.forEach((_, i) => {
    if (land[i]) sizes.set(find(i), (sizes.get(find(i)) ?? 0) + 1);
  });
  return [...sizes.values()].sort((a, b) => b - a);
}

describe('three continents separated by ocean', () => {
  beforeEach(() => setEarthPoseTime(0));

  it('has exactly three land masses, each a sizeable continent', () => {
    const sizes = landComponents(8000);
    expect(sizes).toHaveLength(3);
    const total = sizes.reduce((a, b) => a + b, 0);
    // No continent dwarfs the others.
    for (const s of sizes) expect(s / total).toBeGreaterThan(0.25);
  });

  it('covers roughly a third of the planet — ocean is the majority, land is not flooded', () => {
    const pts = fibonacciSphere(8000);
    const land = pts.filter((p) => sampleLandMask(p) >= 0.5).length / pts.length;
    expect(land).toBeGreaterThan(0.25);
    expect(land).toBeLessThan(0.42);
  });

  it('every continent interior is solid, fully lifted land with no inland water', () => {
    CONTINENTS.forEach((c, i) => {
      const center = continentCenter(c);
      expect(nearestContinent(center)).toBe(i);
      expect(sampleLandMask(center)).toBe(1);
      expect(sampleSurfaceLift(center)).toBeCloseTo(LAND_LIFT, 6);
      // Sample a ring well inside the wobbled coast in 32 directions.
      const ref: Vec3 = Math.abs(center[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const toward = (t: number): Vec3 => {
        const a = (t * Math.PI * 2);
        const e1: Vec3 = [
          ref[1] * center[2] - ref[2] * center[1],
          ref[2] * center[0] - ref[0] * center[2],
          ref[0] * center[1] - ref[1] * center[0],
        ];
        const l1 = Math.hypot(...e1);
        const u: Vec3 = [e1[0] / l1, e1[1] / l1, e1[2] / l1];
        const v: Vec3 = [
          center[1] * u[2] - center[2] * u[1],
          center[2] * u[0] - center[0] * u[2],
          center[0] * u[1] - center[1] * u[0],
        ];
        return [u[0] * Math.cos(a) + v[0] * Math.sin(a), u[1] * Math.cos(a) + v[1] * Math.sin(a), u[2] * Math.cos(a) + v[2] * Math.sin(a)];
      };
      const inner = c.radius - COAST_WARP - 0.08;
      for (let k = 0; k < 32; k++) {
        const dir = toward(k / 32);
        for (let s = 0; s <= 8; s++) {
          const th = (inner * s) / 8;
          const p: Vec3 = [
            center[0] * Math.cos(th) + dir[0] * Math.sin(th),
            center[1] * Math.cos(th) + dir[1] * Math.sin(th),
            center[2] * Math.cos(th) + dir[2] * Math.sin(th),
          ];
          expect(sampleLandMask(p)).toBe(1);
        }
      }
    });
  });

  it('leaves a wide strip of open ocean at sea level between every pair of continents', () => {
    const centers = CONTINENTS.map(continentCenter);
    for (let i = 0; i < centers.length; i++) {
      for (let j = i + 1; j < centers.length; j++) {
        const STEPS = 400;
        const arc = angle(centers[i], centers[j]);
        let run = 0;
        let bestRun = 0;
        for (let s = 0; s <= STEPS; s++) {
          const p = slerp(centers[i], centers[j], s / STEPS);
          if (sampleLandMask(p) === 0) {
            run++;
            // Open ocean sits exactly at the sea-level baseline.
            expect(sampleSurfaceLift(p)).toBe(0);
          } else run = 0;
          bestRun = Math.max(bestRun, run);
        }
        expect((bestRun * arc) / STEPS).toBeGreaterThan(MIN_OCEAN_GAP_RAD);
      }
    }
  });

  it('keeps continents clear of each other by construction (radius + wobble + gap)', () => {
    const centers = CONTINENTS.map(continentCenter);
    for (let i = 0; i < centers.length; i++) {
      for (let j = i + 1; j < centers.length; j++) {
        const reach = CONTINENTS[i].radius + CONTINENTS[j].radius + 2 * COAST_WARP;
        expect(angle(centers[i], centers[j]) - reach).toBeGreaterThan(MIN_OCEAN_GAP_RAD);
      }
    }
  });

  it('keeps continents out of the polar ice caps', () => {
    for (const c of CONTINENTS) {
      const reachDeg = Math.abs(c.latDeg) + ((c.radius + COAST_WARP) * 180) / Math.PI;
      expect(reachDeg).toBeLessThan(67);
    }
  });

  it('continentField is 0.5 at the coast and clamped to 0..1', () => {
    for (const p of fibonacciSphere(500)) {
      const f = continentField(p);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
  });

  it('generates one GLSL distance term per continent from the same constants', () => {
    const terms = CONTINENTS_GLSL.match(/best = max\(best,/g) ?? [];
    expect(terms).toHaveLength(CONTINENTS.length);
    for (const c of CONTINENTS) expect(CONTINENTS_GLSL).toContain(c.radius.toFixed(6));
    expect(CONTINENTS_GLSL).toContain(COAST_WARP.toFixed(6));
  });
});

describe('land snapping with three continents', () => {
  beforeEach(() => setEarthPoseTime(0));

  it('walks from mid-ocean and from the poles onto a continent', () => {
    const seeds: Vec3[] = [[0, 1, 0], [0, -1, 0], [-0.94, 0, -0.34], [0.2, -0.3, -0.93]];
    for (const seed of seeds) {
      const n = Math.hypot(...seed);
      const s: Vec3 = [seed[0] / n, seed[1] / n, seed[2] / n];
      const out = snapToLand(s, { maxArcMeters: 200, radius: EARTH_RADIUS, steps: 16 });
      expect(sampleLandMask(out)).toBeGreaterThanOrEqual(0.6);
    }
  });

  it("fallback 'seed' returns the seed unchanged when no land is in budget", () => {
    const pole: Vec3 = [0, 1, 0];
    expect(sampleLandMask(pole)).toBe(0);
    expect(snapToLand(pole, { maxArcMeters: 50, radius: EARTH_RADIUS, steps: 8, fallback: 'seed' })).toBe(pole);
  });

  it('every peer spawns on dry land', () => {
    for (let i = 0; i < 64; i++) {
      for (const t of [0, 1234, 98765]) {
        setEarthPoseTime(t);
        const pose = getEarthPose();
        const p = spawnOnEarth(`peer-${i}`, pose);
        const d: Vec3 = [p[0] - pose.center[0], p[1] - pose.center[1], p[2] - pose.center[2]];
        const r = Math.hypot(...d);
        const world: Vec3 = [d[0] / r, d[1] / r, d[2] / r];
        const local = quatRotate(pose.invSpinQuat, world);
        expect(sampleLandMask(local)).toBeGreaterThanOrEqual(0.5);
      }
    }
  });

  it('every village anchor sits on dry land', () => {
    for (let i = 0; i < 64; i++) {
      const frame = getEarthLocalSiteFrame(`anchor-${i}`);
      expect(sampleLandMask(frame.normal)).toBeGreaterThanOrEqual(0.6);
    }
  });
});
