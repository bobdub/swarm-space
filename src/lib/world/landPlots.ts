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

/** Private plots are owner-only; commons are dev-laid public ground. */
export type LandPlotKind = 'private' | 'commons';

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
  /** Defaults to 'private' for legacy records. */
  kind?: LandPlotKind;
  /** Optional label shown on the surface marker (e.g. "Main Road"). */
  label?: string;
}

export function plotKind(plot: LandPlot): LandPlotKind {
  return plot.kind === 'commons' ? 'commons' : 'private';
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

/** Test hook — drops the in-memory cache so storage is re-read. */
export function clearLandPlotsCache(): void {
  memCache.clear();
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
    if (rectsIntersect(rect, p.cellRect)) return true;
  }
  return false;
}

/** Do two cell rects share at least one cell? */
export function rectsIntersect(a: PlotCellRect, b: PlotCellRect): boolean {
  return a.cx0 < b.cx1 && a.cx1 > b.cx0 && a.cz0 < b.cz1 && a.cz1 > b.cz0;
}

/**
 * True when `rect` overlaps ANY existing plot — own, foreign or
 * commons. Overlapping claims are never allowed; adjacent same-owner
 * claims are the supported way to grow a holding (they merge).
 */
export function rectOverlapsAny(rect: PlotCellRect, ns?: string): boolean {
  for (const p of read(ns)) {
    if (rectsIntersect(rect, p.cellRect)) return true;
  }
  return false;
}

/** Rects touch edge-to-edge (share a boundary with non-zero overlap). */
export function rectsAdjacent(a: PlotCellRect, b: PlotCellRect): boolean {
  const xOverlap = a.cx0 < b.cx1 && a.cx1 > b.cx0;
  const zOverlap = a.cz0 < b.cz1 && a.cz1 > b.cz0;
  if (xOverlap && (a.cz1 === b.cz0 || b.cz1 === a.cz0)) return true;
  if (zOverlap && (a.cx1 === b.cx0 || b.cx1 === a.cx0)) return true;
  return false;
}

function unionRect(a: PlotCellRect, b: PlotCellRect): PlotCellRect {
  return {
    cx0: Math.min(a.cx0, b.cx0),
    cz0: Math.min(a.cz0, b.cz0),
    cx1: Math.max(a.cx1, b.cx1),
    cz1: Math.max(a.cz1, b.cz1),
  };
}

/**
 * Merge same-owner, same-kind, same-anchor plots whose rects touch and
 * whose union is exactly covered by the pair (i.e. the result is still
 * a clean rectangle). Runs to a fixed point. Plots that only form an
 * L-shape stay separate records but render as one group.
 */
export function mergeAdjacentPlots(plots: LandPlot[]): LandPlot[] {
  const out = plots.slice();
  let merged = true;
  while (merged) {
    merged = false;
    outer:
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i], b = out[j];
        if (a.ownerId !== b.ownerId) continue;
        if (plotKind(a) !== plotKind(b)) continue;
        if (a.anchorId !== b.anchorId) continue;
        if (!rectsAdjacent(a.cellRect, b.cellRect)) continue;
        const u = unionRect(a.cellRect, b.cellRect);
        if (rectBoxCount(u) !== rectBoxCount(a.cellRect) + rectBoxCount(b.cellRect)) continue;
        const combined: LandPlot = {
          ...a,
          cellRect: u,
          priceSwarm: (a.priceSwarm || 0) + (b.priceSwarm || 0),
          claimedAt: Math.min(a.claimedAt, b.claimedAt),
          unlocksLandmarks: a.unlocksLandmarks || b.unlocksLandmarks,
        };
        out.splice(j, 1);
        out[i] = combined;
        merged = true;
        break outer;
      }
    }
  }
  return out;
}

/**
 * Persist a claim. Does NOT debit SWARM — caller is responsible.
 * Throws when the rect overlaps an existing plot.
 */
export function claimLandPlot(input: {
  ownerId: string;
  cellRect: PlotCellRect;
  anchorId: string;
  priceSwarm: number;
  kind?: LandPlotKind;
  label?: string;
  ns?: string;
}): LandPlot {
  if (rectOverlapsAny(input.cellRect, input.ns)) {
    throw new Error('That area overlaps land that is already claimed.');
  }
  const plot: LandPlot = {
    id: `plot:${Date.now().toString(36)}:${Math.floor(Math.random() * 0xffff).toString(36)}`,
    ownerId: input.ownerId,
    cellRect: input.cellRect,
    anchorId: input.anchorId,
    priceSwarm: input.priceSwarm,
    claimedAt: Date.now(),
    unlocksLandmarks: input.kind !== 'commons',
    kind: input.kind ?? 'private',
    label: input.label,
  };
  const next = mergeAdjacentPlots(read(input.ns).concat(plot));
  write(next, input.ns);
  // The claim may have been folded into a neighbouring parcel; return
  // whichever record now covers it.
  const covering = next.find((p) => rectsIntersect(p.cellRect, plot.cellRect));
  return covering ?? plot;
}

/**
 * Build permission for a lattice cell.
 *
 * - Unclaimed ground → anyone may build.
 * - Private plot     → owner only.
 * - Commons (roads / squares) → devs only; everyone else is blocked so
 *   public ground stays walkable.
 */
export function canBuildAtCell(
  cx: number,
  cz: number,
  actorId: string,
  opts?: { isDev?: boolean; ns?: string },
): { ok: boolean; reason?: string; plot?: LandPlot } {
  const plot = getPlotAtCell(cx, cz, opts?.ns);
  if (!plot) return { ok: true };
  if (plotKind(plot) === 'commons') {
    return opts?.isDev
      ? { ok: true, plot }
      : { ok: false, reason: 'This is communal land.', plot };
  }
  if (plot.ownerId === actorId) return { ok: true, plot };
  return { ok: false, reason: 'This land belongs to another player.', plot };
}

/** Same gate, from a tangent-plane point (metres). */
export function canBuildAtTangent(
  tx: number,
  tz: number,
  actorId: string,
  opts?: { isDev?: boolean; ns?: string },
): { ok: boolean; reason?: string; plot?: LandPlot } {
  const { cx, cz } = tangentToCell(tx, tz);
  return canBuildAtCell(cx, cz, actorId, opts);
}

/**
 * Largest horizontal span (metres) of everything `ownerId` owns, taken
 * across the bounding box of their parcels. 0 when they own nothing.
 * Used to frame the builder Top view so all owned land fits.
 */
export function ownedFootprintSpanM(ownerId: string, ns?: string): number {
  let cx0 = Infinity, cz0 = Infinity, cx1 = -Infinity, cz1 = -Infinity;
  let any = false;
  for (const p of read(ns)) {
    if (p.ownerId !== ownerId || plotKind(p) === 'commons') continue;
    any = true;
    cx0 = Math.min(cx0, p.cellRect.cx0);
    cz0 = Math.min(cz0, p.cellRect.cz0);
    cx1 = Math.max(cx1, p.cellRect.cx1);
    cz1 = Math.max(cz1, p.cellRect.cz1);
  }
  if (!any) return 0;
  return Math.max((cx1 - cx0), (cz1 - cz0)) * PLOT_CELL;
}
