/**
 * wake — the fading trail a moving boat leaves on the water.
 *
 * Purely visual: every viewer keeps its own trail from the boat it sees
 * (its own boat, or someone else's dead-reckoned one), so nothing is sent.
 * Points are Earth-local stern positions, so the trail stays put on the
 * sea while the planet spins. The ribbon widens and fades with age, and
 * its strength follows the speed the boat had when it passed.
 */

import type { Vec3 } from '../earth';
import { fromBoatFrame } from './boatDeck';
import type { BoatFrame } from './boatDeck';
import { HALF_L } from './boatHull';
import { starboardOf } from './dockSite';

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
    this.points.push({ n, side: starboardOf(n, frame.heading), t, strength: Math.min(1, s / WAKE_FULL_SPEED) });
    if (this.points.length > MAX_POINTS) this.points.shift();
  }

  /**
   * Ribbon vertices (Earth-local, two per point: port then starboard) and
   * RGBA alpha per vertex, ready for a triangle strip. Returns the count
   * of points written.
   */
  ribbon(t: number, radius: number, elevation: number, pos: Float32Array, alpha: Float32Array): number {
    let k = 0;
    const r = radius + elevation;
    for (const p of this.points) {
      if (2 * (k + 1) * 3 > pos.length) break;
      const age = Math.max(0, t - p.t);
      if (age > WAKE_LIFE_S) continue;
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
}

export const WAKE_MAX_POINTS = MAX_POINTS;
