/**
 * FieldEngine — stateful singleton wrapper over the pure UQRC field math.
 * Owns the lattice, ticks at 4 Hz via setInterval (with rIC fallback),
 * notifies subscribers, and persists snapshots through fieldPersistence.
 */

import {
  createField,
  step,
  inject as fieldInject,
  pin as fieldPin,
  unpin as fieldUnpin,
  qScore as fieldQScore,
  extractBasins,
  curvatureMap,
  dominantWavelength,
  serializeField,
  deserializeField,
  textSites,
  type Field,
  type FieldSnapshot,
  FIELD_LENGTH,
} from './field';
import {
  loadFieldSnapshot,
  saveFieldSnapshot,
} from './fieldPersistence';
import { runClosureProof, type ClosureReport } from './closure';

export interface FieldStatus {
  ticks: number;
  qScore: number;
  basinCount: number;
  dominantWavelength: number;
  pinCount: number;
}

const TICK_INTERVAL_MS = 250;     // 4 Hz
const SNAPSHOT_THROTTLE_MS = 5000;
const COLD_START_TICKS = 50;

export class FieldEngine {
  private field: Field;
  private listeners = new Set<(s: FieldStatus) => void>();
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private lastSaveAt = 0;
  private restored = false;

  constructor(L: number = FIELD_LENGTH) {
    this.field = createField(L);
  }

  async restore(): Promise<void> {
    if (this.restored) return;
    this.restored = true;
    try {
      const snap = await loadFieldSnapshot();
      if (snap) {
        this.field = deserializeField(snap);
      }
    } catch (err) {
      console.warn('[FieldEngine] restore failed:', err);
    }
  }

  start(): void {
    if (this.tickTimer || typeof window === 'undefined') return;
    this.tickTimer = setInterval(() => {
      const run = () => this.tickOnce();
      // Yield to idle if available
      const ric = (window as unknown as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void;
      }).requestIdleCallback;
      if (ric) ric(run, { timeout: 200 });
      else run();
    }, TICK_INTERVAL_MS);
  }

  stop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private tickOnce(): void {
    try {
      step(this.field);
      this.notify();
      this.maybePersist();
    } catch (err) {
      console.warn('[FieldEngine] tick error:', err);
    }
  }

  private maybePersist(): void {
    const now = Date.now();
    if (now - this.lastSaveAt < SNAPSHOT_THROTTLE_MS) return;
    this.lastSaveAt = now;
    void saveFieldSnapshot(serializeField(this.field)).catch((err) => {
      console.warn('[FieldEngine] snapshot save failed:', err);
    });
  }

  inject(text: string, opts: { amplitude?: number; axis?: number; reward?: number; trust?: number } = {}): void {
    const baseAmp = opts.amplitude ?? 0.3;
    const rewardBoost = opts.reward !== undefined ? Math.min(2, opts.reward) * 0.2 : 0;
    const trustBoost = opts.trust !== undefined ? Math.min(1, opts.trust / 100) * 0.1 : 0;
    fieldInject(this.field, text, baseAmp + rewardBoost + trustBoost, opts.axis ?? 0);
    if (opts.reward !== undefined) {
      fieldInject(this.field, text, Math.min(1, opts.reward) * 0.2, 2); // reward axis
    }
  }

  pin(text: string, target: number = 1.0, axis: number = 0): void {
    fieldPin(this.field, text, target, axis);
  }

  /** Remove pins associated with a text/axis. Returns number of sites unpinned. */
  unpin(text: string, axis: number = 0): number {
    return fieldUnpin(this.field, text, axis);
  }

  /** Lattice length (sites). */
  getLatticeLength(): number {
    return this.field.L;
  }

  /** Compute lattice site indices for a text via the same hash as inject(). */
  getSitesForText(text: string): number[] {
    return textSites(text, this.field.L);
  }

  /**
   * Inject directly at provided site indices (bypassing text hashing).
   * Used by attractor logic to reinforce one speaker's text at *another*
   * speaker's lattice region.
   */
  injectAtSites(sites: number[], amplitude: number = 0.3, axis: number = 0): void {
    if (axis < 0 || sites.length === 0) return;
    const L = this.field.L;
    const sigma = 3;
    for (const c of sites) {
      const cw = ((c % L) + L) % L;
      for (let dx = -sigma * 2; dx <= sigma * 2; dx++) {
        const x = ((cw + dx) % L + L) % L;
        const g = Math.exp(-(dx * dx) / (2 * sigma * sigma));
        if (this.field.axes[axis]) {
          this.field.axes[axis][x] += amplitude * g;
        }
      }
    }
  }

  /** Pin a single lattice site directly (used by attractor midpoint bridges). */
  pinSite(site: number, target: number, axis: number = 0): void {
    const L = this.field.L;
    if (axis < 0 || axis >= 3) return;
    const s = ((site % L) + L) % L;
    const key = ((axis & 0xff) << 24) | (s & 0xffffff);
    this.field.pins.set(key, target);
    this.field.axes[axis][s] = target;
  }

  /** Unpin a single lattice site directly. */
  unpinSite(site: number, axis: number = 0): boolean {
    const L = this.field.L;
    if (axis < 0 || axis >= 3) return false;
    const s = ((site % L) + L) % L;
    const key = ((axis & 0xff) << 24) | (s & 0xffffff);
    return this.field.pins.delete(key);
  }

  /** Read current Q_Score (cheap; recomputed on demand). */
  getQScore(): number {
    return fieldQScore(this.field);
  }

  getBasins() {
    return extractBasins(this.field);
  }

  getCurvatureMap(): Float32Array {
    return curvatureMap(this.field);
  }

  /** Per-site curvature lookup. Site is wrapped to lattice length. */
  getCurvatureAtSite(site: number): number {
    const map = curvatureMap(this.field);
    const L = this.field.L;
    const i = ((site % L) + L) % L;
    return map[i] ?? 0;
  }

  /**
   * Mean curvature at the lattice sites a piece of text hashes to.
   * Useful for "how stressed is this peer's region of the field?".
   */
  getCurvatureForText(text: string): number {
    if (!text) return 0;
    const L = this.field.L;
    const sites = textSites(text, L);
    if (sites.length === 0) return 0;
    const map = curvatureMap(this.field);
    let sum = 0;
    for (const s of sites) sum += map[s] ?? 0;
    return sum / sites.length;
  }

  /** Are any of this text's lattice sites currently inside a stable basin? */
  isTextInBasin(text: string): boolean {
    if (!text) return false;
    const L = this.field.L;
    const sites = textSites(text, L);
    const basins = extractBasins(this.field);
    if (sites.length === 0 || basins.length === 0) return false;
    for (const s of sites) {
      for (const b of basins) {
        if (s >= b.start && s <= b.end) return true;
      }
    }
    return false;
  }

  getDominantWavelength(): number {
    return dominantWavelength(this.field);
  }

  getTicks(): number {
    return this.field.ticks;
  }

  isWarmedUp(): boolean {
    return this.field.ticks >= COLD_START_TICKS;
  }

  /** Number of currently-pinned lattice sites (for cap checks). */
  getPinCount(): number {
    return this.field.pins.size;
  }

  getStatus(): FieldStatus {
    return {
      ticks: this.field.ticks,
      qScore: this.getQScore(),
      basinCount: this.getBasins().length,
      dominantWavelength: this.getDominantWavelength(),
      pinCount: this.field.pins.size,
    };
  }

  /** For projection: clone current field to test a candidate without mutating. */
  cloneSnapshot(): FieldSnapshot {
    return serializeField(this.field);
  }

  /**
   * ℓ_min closure report — verifies invariance of the lattice spacing
   * under the full operator algebra. Read-only; no field mutation.
   * See `closure.ts` for the algebraic statement and bounds.
   */
  getClosureReport(): ClosureReport {
    return runClosureProof(this.field);
  }

  subscribe(fn: (s: FieldStatus) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    if (this.listeners.size === 0) return;
    const status = this.getStatus();
    for (const fn of this.listeners) {
      try { fn(status); } catch { /* ignore listener errors */ }
    }
  }
}

// ── Singleton ────────────────────────────────────────────────────────

let _engine: FieldEngine | null = null;

export function getSharedFieldEngine(): FieldEngine {
  if (!_engine) {
    _engine = new FieldEngine();
    void _engine.restore().then(() => _engine?.start());
  }
  return _engine;
}

/** Test helper — destroys the singleton so a new one can be made. */
export function __resetSharedFieldEngineForTests(): void {
  if (_engine) _engine.stop();
  _engine = null;
}