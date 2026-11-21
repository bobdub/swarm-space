/**
 * wake — the fading trail a moving boat leaves on the water.
 *
 * Purely visual: every viewer keeps its own trail from the boat it sees
 * (its own boat, or someone else's dead-reckoned one), so nothing is sent.
 * Points are Earth-local stern positions, so the trail stays put on the
 * sea while the planet spins. The ribbon widens and fades with age, and
 * its strength follows the speed the boat had when it passed.
 *
 * Each point also radiates a ring of ripples from the bow (`ripples`).
 * Deep-water waves carry their energy at half their phase speed, and the
 * classic result is that a moving hull's waves all stay inside a V of
 * half-angle asin(1/3) ≈ 19.47° (the Kelvin wedge). Rings whose front
 * grows at a third of the speed the boat had when it left them draw
 * exactly that wedge as they overlap, so the V comes out of the rings
 * rather than being painted. Inside each ring the crests run outward at
 * the phase speed of their wavelength, √(gλ/2π), faster than the front,
 * so they are born behind it and die at it, and the amplitude falls as
 * 1/√r and with age. Everything sits on the shared tide (`seaSurface`).
 */

import type { Vec3 } from '../earth';
import { fromBoatFrame } from './boatDeck';
import type { BoatFrame } from './boatDeck';
import { HALF_L } from './boatHull';
import { starboardOf } from './dockSite';
import { tideAt } from './seaSurface';

/** Seconds a point of wake lasts. */
export const WAKE_LIFE_S = 8;
/** Seconds between wake points. */
export const WAKE_EVERY_S = 0.25;
/** Below this speed (m/s) the boat leaves no new wake. */
export const WAKE_MIN_SPEED = 0.4;
/** Speed (m/s) at which the wake is at full strength. */
const WAKE_FULL_SPEED = 3;
const MAX_POINTS = Math.ceil(WAKE_LIFE_S / WAKE_EVERY_S) + 2;

export interface WakePoint {
  n: Vec3;
  side: Vec3;
  t: number;
  strength: number;
  /** Where the bow was (ring centre). */
  bow: Vec3;
  /** Earth-local heading then (ring frame). */
  heading: Vec3;
  /** Speed then (m/s), which sets the ring's growth and wavelength. */
  speed: number;
}

/** sin of the Kelvin wedge half-angle: rings grow at this share of the
 *  boat's speed. */
export const KELVIN_SIN = 1 / 3;
/** Kelvin wedge half-angle (rad), ≈ 19.47°. */
export const KELVIN_HALF_ANGLE = Math.asin(KELVIN_SIN);
/** Shortest and longest ripple wavelength drawn (m). */
export const RIPPLE_MIN_WAVELENGTH = 0.9;
export const RIPPLE_MAX_WAVELENGTH = 3.2;
/** Grid cells per side of a ripple patch: keeps the flat cells within a
 *  few centimetres of the curved sea. */
export const RIPPLE_GRID = 4;
export const RIPPLE_VERTS = (RIPPLE_GRID + 1) * (RIPPLE_GRID + 1);
const G = 9.81;

/** Ripple wavelength (m) for a boat speed: the divergent waves are a
 *  fraction of the transverse 2πU²/g, clamped to what reads on screen. */
export function rippleWavelength(speed: number): number {
  const transverse = (2 * Math.PI * speed * speed) / G;
  return Math.min(RIPPLE_MAX_WAVELENGTH, Math.max(RIPPLE_MIN_WAVELENGTH, transverse / 3));
}

/** Deep-water phase speed (m/s) of a wavelength: √(gλ/2π). */
export function ripplePhaseSpeed(wavelength: number): number {
  return Math.sqrt((G * wavelength) / (2 * Math.PI));
}

/** Front radius (m) of a ring `age` seconds old, left at `speed`. */
export function rippleRadius(speed: number, age: number): number {
  return 0.6 + Math.abs(speed) * KELVIN_SIN * age;
}

export class WakeTrail {
  points: WakePoint[] = [];
  private lastAt = -Infinity;

  /** Add a point at the stern if it is time and the boat is moving. */
  sample(frame: BoatFrame, speed: number, t: number, radius: number): void {
    // Clock went backwards (a test, a resync): start over.
    if (t < this.lastAt) { this.points = []; this.lastAt = -Infinity; }
    while (this.points.length && t - this.points[0].t > WAKE_LIFE_S) this.points.shift();
    if (t - this.lastAt < WAKE_EVERY_S) return;
    const s = Math.abs(speed);
    if (s < WAKE_MIN_SPEED) return;
    this.lastAt = t;
    const n = fromBoatFrame(frame, 0, HALF_L + 0.3, radius);
    const bow = fromBoatFrame(frame, 0, -HALF_L * 0.8, radius);
    this.points.push({
      n,
      side: starboardOf(n, frame.heading),
      t,
      strength: Math.min(1, s / WAKE_FULL_SPEED),
      bow,
      heading: frame.heading,
      speed: s,
    });
    if (this.points.length > MAX_POINTS) this.points.shift();
  }

  /**
   * Ribbon vertices (Earth-local, two per point: port then starboard) and
   * RGBA alpha per vertex, ready for a triangle strip. Returns the count
   * of points written.
   */
  ribbon(t: number, radius: number, elevation: number, pos: Float32Array, alpha: Float32Array): number {
    let k = 0;
    for (const p of this.points) {
      if (2 * (k + 1) * 3 > pos.length) break;
      const age = Math.max(0, t - p.t);
      if (age > WAKE_LIFE_S) continue;
      const r = radius + elevation + tideAt(p.n, t);
      const f = age / WAKE_LIFE_S;
      const half = 0.6 + 2.4 * Math.sqrt(f);
      const a = 0.55 * p.strength * (1 - f) * (1 - f);
      for (let s = -1; s <= 1; s += 2) {
        const o = (2 * k + (s < 0 ? 0 : 1)) * 3;
        // Offset across the trail by `half` metres, on the sphere.
        const nx = p.n[0] + (p.side[0] * s * half) / radius;
        const ny = p.n[1] + (p.side[1] * s * half) / radius;
        const nz = p.n[2] + (p.side[2] * s * half) / radius;
        const l = Math.hypot(nx, ny, nz) || 1;
        pos[o] = (nx / l) * r; pos[o + 1] = (ny / l) * r; pos[o + 2] = (nz / l) * r;
        alpha[(2 * k + (s < 0 ? 0 : 1))] = a;
      }
      k++;
    }
    return k;
  }

  /**
   * Ripple patches, `RIPPLE_VERTS` vertices each on a (RIPPLE_GRID+1)² grid:
   * `pos` Earth-local position on the sea (3 per vertex), `off` metres from
   * the ring centre (2 per vertex) and `ring` per vertex
   * [front radius m, strength·fade, wavenumber rad/m, crest phase rad].
   * Returns the number of patches written.
   */
  ripples(
    t: number,
    radius: number,
    elevation: number,
    pos: Float32Array,
    off: Float32Array,
    ring: Float32Array,
  ): number {
    let k = 0;
    for (const p of this.points) {
      if ((k + 1) * RIPPLE_VERTS * 3 > pos.length) break;
      const age = Math.max(0, t - p.t);
      if (age > WAKE_LIFE_S) continue;
      const f = age / WAKE_LIFE_S;
      const fade = p.strength * (1 - f) * (1 - f) * Math.min(1, age / 0.3);
      if (fade <= 0.002) continue;
      const R = rippleRadius(p.speed, age);
      const lambda = rippleWavelength(p.speed);
      const kw = (2 * Math.PI) / lambda;
      const phase = kw * ripplePhaseSpeed(lambda) * age;
      const r = radius + elevation + tideAt(p.bow, t);
      const e1 = starboardOf(p.bow, p.heading);
      const e2 = p.heading;
      for (let j = 0; j <= RIPPLE_GRID; j++) {
        for (let i = 0; i <= RIPPLE_GRID; i++) {
          const x = (2 * i / RIPPLE_GRID - 1) * R;
          const z = (2 * j / RIPPLE_GRID - 1) * R;
          const nx = p.bow[0] + (e1[0] * x + e2[0] * z) / radius;
          const ny = p.bow[1] + (e1[1] * x + e2[1] * z) / radius;
          const nz = p.bow[2] + (e1[2] * x + e2[2] * z) / radius;
          const l = Math.hypot(nx, ny, nz) || 1;
          const v = k * RIPPLE_VERTS + j * (RIPPLE_GRID + 1) + i;
          pos[v * 3] = (nx / l) * r; pos[v * 3 + 1] = (ny / l) * r; pos[v * 3 + 2] = (nz / l) * r;
          off[v * 2] = x; off[v * 2 + 1] = z;
          ring[v * 4] = R; ring[v * 4 + 1] = fade; ring[v * 4 + 2] = kw; ring[v * 4 + 3] = phase;
        }
      }
      k++;
    }
    return k;
  }
}

/** Triangle indices for `count` ripple patches. */
export function rippleIndices(count: number): number[] {
  const idx: number[] = [];
  const row = RIPPLE_GRID + 1;
  for (let k = 0; k < count; k++) {
    const base = k * RIPPLE_VERTS;
    for (let j = 0; j < RIPPLE_GRID; j++) {
      for (let i = 0; i < RIPPLE_GRID; i++) {
        const a = base + j * row + i;
        idx.push(a, a + row, a + 1, a + 1, a + row, a + row + 1);
      }
    }
  }
  return idx;
}

/** Indices per ripple patch. */
export const RIPPLE_INDICES = RIPPLE_GRID * RIPPLE_GRID * 6;

export const WAKE_MAX_POINTS = MAX_POINTS;
