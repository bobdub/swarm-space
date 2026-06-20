/**
 * landPlots — owned, walk-claimed parcels of land.
 *
 * A plot is an axis-aligned rectangle in the lattice-origin tangent
 * frame (`WORLD_GRID_ORIGIN_ANCHOR`), expressed in integer
 * WALL_PITCH-sized cells. One "box" = WALL_PITCH × WALL_PITCH.
 * Cost is `boxes * BOX_PRICE_SWARM` and is debited via SWARM burn.
 *
 * Persistence: per-universe localStorage. No new IndexedDB schema and
 * no new chain logic — claims are local + (future) P2P gossip, same
 * trust model as `loadPieces`.
 */
import { WALL_PITCH } from './buildGrid';

export const BOX_PRICE_SWARM = 3;
/** Side length (metres) of a single "box" cell on the plot grid. */
export const PLOT_CELL = WALL_PITCH;

export interface PlotCellRect {
  /** Min cell index along the lattice-origin right axis (inclusive). */
  cx0: number;
  /** Min cell index along the lattice-origin forward axis (inclusive). */
  cz0: number;
  /** Max cell index along right (exclusive). */
  cx1: number;
  /** Max cell index along forward (exclusive). */
  cz1: number;
}

export interface LandPlot {
  id: string;
  ownerId: string;
  cellRect: PlotCellRect;
  /** Frame the rect lives in. Always WORLD_GRID_ORIGIN_ANCHOR today. */
  anchorId: string;
  priceSwarm: number;
  claimedAt: number;
  /** Future: landmark catalog unlocked by this plot. */
  unlocksLandmarks: boolean;
}

const STORE_KEY = 'brain-land-plots-v1';

function keyFor(ns?: string): string {
  return !ns || ns === 'global' ? STORE_KEY : `${STORE_KEY}:${ns}`;
}

const listeners = new Set<(plots: LandPlot[]) => void>();
const memCache = new Map<string, LandPlot[]>();

function read(ns?: string): LandPlot[] {
  const k = keyFor(ns);
  if (memCache.has(k)) return memCache.get(k)!;
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null;
    const parsed = raw ? (JSON.parse(raw) as LandPlot[]) : [];
    memCache.set(k, parsed);
    return parsed;
  } catch {
    memCache.set(k, []);
    return [];
  }
}

function write(plots: LandPlot[], ns?: string): void {
  const k = keyFor(ns);
  memCache.set(k, plots);
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(k, JSON.stringify(plots));
  } catch { /* ignore quota */ }
  for (const fn of listeners) {
    try { fn(plots); } catch { /* ignore */ }
  }
}

export function loadLandPlots(ns?: string): LandPlot[] {
  return read(ns).slice();
}

export function subscribeLandPlots(fn: (plots: LandPlot[]) => void, ns?: string): () => void {
  listeners.add(fn);
  fn(loadLandPlots(ns));
  return () => { listeners.delete(fn); };
}

/** Snap a tangent-plane point (m) to its containing cell index. */
export function tangentToCell(tx: number, tz: number): { cx: number; cz: number } {
  return { cx: Math.floor(tx / PLOT_CELL), cz: Math.floor(tz / PLOT_CELL) };
}

/** Number of boxes covered by a rect. */
export function rectBoxCount(rect: PlotCellRect): number {
  const w = Math.max(0, rect.cx1 - rect.cx0);
  const d = Math.max(0, rect.cz1 - rect.cz0);
  return w * d;
}

/** Price (SWARM) for a rect, rounded up to whole boxes. */
export function priceForRect(rect: PlotCellRect): number {
  return rectBoxCount(rect) * BOX_PRICE_SWARM;
}

/** AABB of a tangent-plane trail, snapped outward to whole cells. */
export function cellRectFromTrail(trail: Array<{ tx: number; tz: number }>): PlotCellRect | null {
  if (trail.length < 3) return null;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of trail) {
    if (p.tx < x0) x0 = p.tx;
    if (p.tz < z0) z0 = p.tz;
    if (p.tx > x1) x1 = p.tx;
    if (p.tz > z1) z1 = p.tz;
  }
  if (!isFinite(x0)) return null;
  return {
    cx0: Math.floor(x0 / PLOT_CELL),
    cz0: Math.floor(z0 / PLOT_CELL),
    cx1: Math.max(Math.floor(x0 / PLOT_CELL) + 1, Math.ceil(x1 / PLOT_CELL)),
    cz1: Math.max(Math.floor(z0 / PLOT_CELL) + 1, Math.ceil(z1 / PLOT_CELL)),
  };
}

/** Does cell (cx,cz) lie inside rect? */
export function cellInRect(cx: number, cz: number, rect: PlotCellRect): boolean {
  return cx >= rect.cx0 && cx < rect.cx1 && cz >= rect.cz0 && cz < rect.cz1;
}

/** First plot covering tangent point (tx,tz), or null. */
export function getPlotAtTangent(
  tx: number, tz: number, ns?: string,
): LandPlot | null {
  const { cx, cz } = tangentToCell(tx, tz);
  return getPlotAtCell(cx, cz, ns);
}

export function getPlotAtCell(cx: number, cz: number, ns?: string): LandPlot | null {
  const plots = read(ns);
  for (const p of plots) {
    if (cellInRect(cx, cz, p.cellRect)) return p;
  }
  return null;
}

/** True if any cell inside `rect` is owned by someone other than `ownerId`. */
export function rectOverlapsForeign(
  rect: PlotCellRect,
  ownerId: string,
  ns?: string,
): boolean {
  const plots = read(ns);
  for (const p of plots) {
    if (p.ownerId === ownerId) continue;
    if (rect.cx0 < p.cellRect.cx1 && rect.cx1 > p.cellRect.cx0 &&
        rect.cz0 < p.cellRect.cz1 && rect.cz1 > p.cellRect.cz0) return true;
  }
  return false;
}

/** Persist a claim. Does NOT debit SWARM — caller is responsible. */
export function claimLandPlot(input: {
  ownerId: string;
  cellRect: PlotCellRect;
  anchorId: string;
  priceSwarm: number;
  ns?: string;
}): LandPlot {
  const plot: LandPlot = {
    id: `plot:${Date.now().toString(36)}:${Math.floor(Math.random() * 0xffff).toString(36)}`,
    ownerId: input.ownerId,
    cellRect: input.cellRect,
    anchorId: input.anchorId,
    priceSwarm: input.priceSwarm,
    claimedAt: Date.now(),
    unlocksLandmarks: true,
  };
  const next = read(input.ns).concat(plot);
  write(next, input.ns);
  return plot;
}