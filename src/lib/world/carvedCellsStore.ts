/**
 * ═══════════════════════════════════════════════════════════════════════
 * CARVED CELLS STORE — persistent record of every dug cell on the planet
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Digging is resolved by the SINGLE sculpting predicate
 * (`applyImpact` in `src/lib/brain/sculpting.ts`). This module only
 * remembers the *result*: for a quantised surface cell, how deep the
 * hole currently is and which Earth shell its floor sits in.
 *
 * INVARIANT — no renderer, no physics, no field access here. Pure state
 * plus a throttled write-behind so the browser is never blocked.
 */

import { EARTH_RADIUS, type Vec3 } from '@/lib/brain/earth';
import { sampleShellAt, type EarthShell } from '@/lib/brain/earthShells';

/** Arc length of one dig cell (m) — matches the builder grid pitch. */
export const DIG_CELL_M = 2.5;
/** Depth removed by one successful cut (m). */
export const DIG_STEP_M = 3.4;
/** Hard floor so a player cannot tunnel into the mantle by hand. */
export const DIG_MAX_DEPTH_M = EARTH_RADIUS * 0.06;

export interface CarvedCell {
  /** Quantised cell key (stable across sessions and peers). */
  cellKey: string;
  /** Earth-LOCAL unit normal at the cell centre (spin-invariant). */
  normal: Vec3;
  /** Depth of the pit below the local ground surface (m). */
  depth: number;
  /** Shell id at the current pit floor. */
  shellId: string;
  /** Last mutation time (ms). */
  updatedAt: number;
}

const STORAGE_KEY = 'brain.carvedCells.v1';
const WRITE_THROTTLE_MS = 2500;

const cells = new Map<string, CarvedCell>();
const listeners = new Set<() => void>();
let hydrated = false;
let writeTimer: ReturnType<typeof setTimeout> | null = null;

// ────────────────────────────────────────────────────────────────────────
//  Cell quantisation — spherical bins of ~DIG_CELL_M arc length.
// ────────────────────────────────────────────────────────────────────────

const D_THETA = DIG_CELL_M / EARTH_RADIUS;

export function digCellKeyFor(localNormal: Vec3): string {
  const n = normalise(localNormal);
  const theta = Math.acos(Math.max(-1, Math.min(1, n[1])));
  const phi = Math.atan2(n[2], n[0]);
  const i = Math.round(theta / D_THETA);
  const ring = Math.max(1e-6, Math.sin(Math.max(1e-4, i * D_THETA)));
  const j = Math.round((phi * ring) / D_THETA);
  return `${i}:${j}`;
}

export function digCellNormal(cellKey: string): Vec3 {
  const [is, js] = cellKey.split(':');
  const i = Number(is);
  const j = Number(js);
  const theta = Math.max(1e-4, i * D_THETA);
  const ring = Math.max(1e-6, Math.sin(theta));
  const phi = (j * D_THETA) / ring;
  return [
    Math.sin(theta) * Math.cos(phi),
    Math.cos(theta),
    Math.sin(theta) * Math.sin(phi),
  ];
}

function normalise(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

// ────────────────────────────────────────────────────────────────────────
//  Shell lookup at a pit floor
// ────────────────────────────────────────────────────────────────────────

/** Shell containing the floor of a pit `depth` metres below the surface. */
export function shellAtDepth(depth: number): EarthShell | null {
  const rFrac = (EARTH_RADIUS - Math.max(0, depth)) / EARTH_RADIUS;
  return sampleShellAt(Math.min(0.9999, rFrac));
}

// ────────────────────────────────────────────────────────────────────────
//  Public state API
// ────────────────────────────────────────────────────────────────────────

export function hydrateCarvedCells(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as CarvedCell[];
    if (!Array.isArray(parsed)) return;
    for (const c of parsed) {
      if (!c || typeof c.cellKey !== 'string') continue;
      if (!Number.isFinite(c.depth)) continue;
      cells.set(c.cellKey, c);
    }
    notify();
  } catch (err) {
    console.warn('[carvedCells] hydrate failed', err);
  }
}

export function listCarvedCells(): CarvedCell[] {
  return Array.from(cells.values());
}

export function getCarvedDepth(cellKey: string): number {
  return cells.get(cellKey)?.depth ?? 0;
}

/**
 * Deepen a cell by one dig step. Returns the updated record, or null when
 * the pit already bottomed out at `DIG_MAX_DEPTH_M`.
 */
export function carveCell(localNormal: Vec3, step: number = DIG_STEP_M): CarvedCell | null {
  const cellKey = digCellKeyFor(localNormal);
  const prev = cells.get(cellKey);
  const depth = (prev?.depth ?? 0) + Math.max(0.1, step);
  if (depth > DIG_MAX_DEPTH_M) return null;
  const shell = shellAtDepth(depth);
  const next: CarvedCell = {
    cellKey,
    normal: prev?.normal ?? normalise(localNormal),
    depth,
    shellId: shell?.id ?? 'unknown',
    updatedAt: Date.now(),
  };
  cells.set(cellKey, next);
  notify();
  scheduleWrite();
  return next;
}

/** Merge a peer-authored carve (last-writer-wins on depth). */
export function acceptPeerCarve(rec: CarvedCell): void {
  const prev = cells.get(rec.cellKey);
  if (prev && prev.depth >= rec.depth) return;
  cells.set(rec.cellKey, rec);
  notify();
  scheduleWrite();
}

export function subscribeCarvedCells(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function _resetCarvedCellsForTest(): void {
  cells.clear();
  hydrated = false;
}

function notify(): void {
  for (const fn of listeners) {
    try { fn(); } catch (err) { console.warn('[carvedCells] listener', err); }
  }
}

function scheduleWrite(): void {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(listCarvedCells()));
    } catch (err) {
      console.warn('[carvedCells] persist failed', err);
    }
  }, WRITE_THROTTLE_MS);
}
