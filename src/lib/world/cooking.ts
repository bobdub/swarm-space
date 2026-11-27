/**
 * cooking — the grill over a fire pit.
 *
 * A player puts a raw catch they own (an egg, a fish, a chicken, a shark)
 * on the grill of a burning pit. The raw good leaves their bag at once,
 * and after its cook time a cooked one takes its place. If the fire goes
 * out before then, the food comes back raw: nothing is lost, but nothing
 * is cooked either.
 *
 * Cooked food is only ever made here. The Trading Stand lists raw goods
 * only (`tradingStand/pricing.ts`), so nobody can buy a cooked meal: you
 * catch or buy raw food and cook it yourself.
 *
 * What cooked food is for: energy. Rowing burns food (`sea/crew.ts`), and
 * a cooked meal carries the oars much further than a unit of raw Food.
 *
 * Grill jobs live on this device only (the bag is per device too), kept in
 * localStorage so a reload mid-cook does not lose the food.
 */
import {
  bagOfDraw,
  getHarvested,
  recordHarvestInBag,
  spendHarvested,
  spendHarvestedDraws,
} from '@/lib/remix/harvestedInventory';
import { burnUntil, isFireLit, litThrough } from '@/lib/world/fireStore';

export type RawFoodId = 'egg' | 'fish' | 'chicken' | 'shark';
export type CookedFoodId = 'cooked_egg' | 'cooked_fish' | 'cooked_chicken' | 'cooked_shark';

export interface CookableFood {
  raw: RawFoodId;
  cooked: CookedFoodId;
  /** What goes on the grill. */
  rawLabel: string;
  /** What comes off it. */
  label: string;
  icon: string;
  cookedIcon: string;
  /** How long it takes over a burning fire (ms). */
  cookMs: number;
  /** Metres of rowing one cooked serving is worth. */
  rowMetres: number;
}

/**
 * Metres of rowing one unit of raw Food (fruit, honey: the bag's Food
 * material) is worth. Every cooked meal is worth more than this.
 */
export const RAW_FOOD_ROW_METRES = 60;

export const COOKABLE_FOODS: readonly CookableFood[] = [
  { raw: 'egg', cooked: 'cooked_egg', rawLabel: 'Egg', label: 'Fried Egg', icon: '🥚', cookedIcon: '🍳', cookMs: 6_000, rowMetres: 150 },
  { raw: 'fish', cooked: 'cooked_fish', rawLabel: 'Fish', label: 'Grilled Fish', icon: '🐟', cookedIcon: '🍢', cookMs: 10_000, rowMetres: 240 },
  { raw: 'chicken', cooked: 'cooked_chicken', rawLabel: 'Chicken', label: 'Roast Chicken', icon: '🐔', cookedIcon: '🍗', cookMs: 15_000, rowMetres: 420 },
  { raw: 'shark', cooked: 'cooked_shark', rawLabel: 'Shark', label: 'Shark Steak', icon: '🦈', cookedIcon: '🥩', cookMs: 25_000, rowMetres: 1200 },
];

/** Most items one player can have on one grill at once. */
export const GRILL_SLOTS = 4;

const BY_RAW = new Map(COOKABLE_FOODS.map((f) => [f.raw, f]));
const BY_COOKED = new Map(COOKABLE_FOODS.map((f) => [f.cooked, f]));

export function cookableFor(raw: string): CookableFood | undefined {
  return BY_RAW.get(raw as RawFoodId);
}

export function cookedFood(id: string): CookableFood | undefined {
  return BY_COOKED.get(id as CookedFoodId);
}

export function isCookedFood(id: string): id is CookedFoodId {
  return BY_COOKED.has(id as CookedFoodId);
}

const goodKey = (id: string) => `good:${id}`;

export function heldRaw(raw: RawFoodId): number {
  return Math.floor(getHarvested(goodKey(raw)));
}

export function heldCooked(cooked: CookedFoodId): number {
  return Math.floor(getHarvested(goodKey(cooked)));
}

/** Cooked servings held, by id. */
export function cookedTotals(): Record<CookedFoodId, number> {
  const out = {} as Record<CookedFoodId, number>;
  for (const f of COOKABLE_FOODS) out[f.cooked] = heldCooked(f.cooked);
  return out;
}

export function totalCookedServings(): number {
  return COOKABLE_FOODS.reduce((n, f) => n + heldCooked(f.cooked), 0);
}

/**
 * Eat one cooked serving: the one worth the least rowing first, so the
 * big meals (a shark steak) are kept for a long pull. Returns the metres
 * of rowing it gives, or 0 when no cooked food is held.
 */
export function eatCookedServing(): number {
  const order = [...COOKABLE_FOODS].sort((a, b) => a.rowMetres - b.rowMetres);
  for (const f of order) {
    if (heldCooked(f.cooked) > 0 && spendHarvested([{ symbol: goodKey(f.cooked), count: 1 }])) {
      return f.rowMetres;
    }
  }
  return 0;
}

// ── Grill jobs ────────────────────────────────────────────────────────────

export interface GrillJob {
  id: string;
  pitId: string;
  raw: RawFoodId;
  startedAt: number;
  doneAt: number;
  /**
   * The fire is known to have burned without a break from `startedAt` to
   * here (ms). Kept on the job, so the outcome does not depend on fuel
   * facts that may be pruned before the job is settled (after a long
   * time away).
   */
  coveredUntil?: number;
  /** Bag the raw food was drawn from (`bagOfDraw`); what comes off goes back there. */
  bag?: string;
}

export type GrillOutcome = 'cooked' | 'cold';

export interface GrillResult {
  job: GrillJob;
  outcome: GrillOutcome;
}

export interface StartCookingResult {
  ok: boolean;
  /** The job started (when ok). */
  job?: GrillJob;
  /** Why nothing went on the grill (when not ok). */
  reason?: 'unknown' | 'cold' | 'none' | 'full';
}

const STORAGE_KEY = 'brain.grillJobs.v1';

const jobs = new Map<string, GrillJob>();
const listeners = new Set<() => void>();
const doneListeners = new Set<(results: GrillResult[]) => void>();
let hydrated = false;
let seq = 0;

function isJob(v: unknown): v is GrillJob {
  const j = v as GrillJob | null;
  return !!j
    && typeof j.id === 'string'
    && typeof j.pitId === 'string' && j.pitId.length > 0
    && BY_RAW.has(j.raw)
    && Number.isFinite(j.startedAt)
    && Number.isFinite(j.doneAt)
    && j.doneAt >= j.startedAt
    && (j.coveredUntil === undefined || Number.isFinite(j.coveredUntil));
}

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return;
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return;
    for (const j of list) if (isJob(j)) jobs.set(j.id, j);
  } catch { /* storage blocked or corrupt */ }
}

function persist(): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify([...jobs.values()]));
  } catch { /* storage blocked */ }
}

function notify(): void {
  for (const fn of listeners) {
    try { fn(); } catch { /* noop */ }
  }
}

/** This player's food on the grill of `pitId`, oldest first. */
export function grillJobs(pitId?: string): GrillJob[] {
  hydrate();
  return [...jobs.values()]
    .filter((j) => pitId === undefined || j.pitId === pitId)
    .sort((a, b) => a.startedAt - b.startedAt || (a.id < b.id ? -1 : 1));
}

/**
 * Put one raw `raw` on the grill of `pitId`. The fire must be burning, the
 * player must hold the raw good, and their grill must have a free slot.
 */
export function startCooking(pitId: string, raw: string, now = Date.now()): StartCookingResult {
  hydrate();
  const food = cookableFor(raw);
  if (!food) return { ok: false, reason: 'unknown' };
  if (!isFireLit(pitId, now)) return { ok: false, reason: 'cold' };
  if (grillJobs(pitId).length >= GRILL_SLOTS) return { ok: false, reason: 'full' };
  const draws = heldRaw(food.raw) >= 1 ? spendHarvestedDraws([{ symbol: goodKey(food.raw), count: 1 }]) : null;
  if (!draws || draws.length === 0) return { ok: false, reason: 'none' };
  const job: GrillJob = {
    id: `grill:${pitId}:${now}:${seq++}`,
    pitId,
    raw: food.raw,
    startedAt: now,
    doneAt: now + food.cookMs,
    // Fuel already on the fire can't be taken back, so it burns at least
    // until its current end.
    coveredUntil: burnUntil(pitId),
    // Whatever comes off the grill goes back to the bag the raw food came
    // from, so an offline catch never comes back as an online one.
    bag: bagOfDraw(draws[0].key),
  };
  jobs.set(job.id, job);
  persist();
  notify();
  ensureTicking();
  return { ok: true, job };
}

/**
 * Take finished food off the grill. A job is done when its cook time is
 * up (cooked if the fire burned the whole time, raw again if not), or as
 * soon as its fire goes out (raw again). Returns what was settled.
 */
export function settleGrill(now = Date.now()): GrillResult[] {
  hydrate();
  const results: GrillResult[] = [];
  let coverageGrew = false;
  for (const job of [...jobs.values()]) {
    const food = BY_RAW.get(job.raw);
    if (!food) { jobs.delete(job.id); continue; }
    // Wood added since the job began may have kept the fire going longer.
    const end = burnUntil(job.pitId);
    if (end > (job.coveredUntil ?? 0) && litThrough(job.pitId, job.startedAt, end)) {
      job.coveredUntil = end;
      coverageGrew = true;
    }
    let outcome: GrillOutcome | null = null;
    if (now >= job.doneAt) {
      outcome = (job.coveredUntil ?? 0) >= job.doneAt || litThrough(job.pitId, job.startedAt, job.doneAt) ? 'cooked' : 'cold';
    } else if (!isFireLit(job.pitId, now)) {
      outcome = 'cold';
    }
    if (!outcome) continue;
    jobs.delete(job.id);
    // Jobs saved before the bags were split drew from the online bag.
    recordHarvestInBag(job.bag ?? '', goodKey(outcome === 'cooked' ? food.cooked : food.raw), 1);
    results.push({ job, outcome });
  }
  if (coverageGrew && results.length === 0) persist();
  if (results.length > 0) {
    persist();
    notify();
    for (const fn of doneListeners) {
      try { fn(results); } catch { /* noop */ }
    }
  }
  return results;
}

let ticker: ReturnType<typeof setInterval> | null = null;

function ensureTicking(): void {
  if (ticker !== null || typeof setInterval !== 'function') return;
  ticker = setInterval(() => {
    settleGrill();
    if (jobs.size === 0 && ticker !== null) {
      clearInterval(ticker);
      ticker = null;
    }
  }, 500);
}

/** Pick up grill jobs left from before a reload. Safe to call often. */
export function resumeGrill(): void {
  hydrate();
  settleGrill();
  if (jobs.size > 0) ensureTicking();
}

export function subscribeGrill(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Called with each batch of food taken off the grill. */
export function onGrillDone(fn: (results: GrillResult[]) => void): () => void {
  doneListeners.add(fn);
  return () => { doneListeners.delete(fn); };
}

export function _resetCookingForTest(): void {
  jobs.clear();
  listeners.clear();
  doneListeners.clear();
  if (ticker !== null) { clearInterval(ticker); ticker = null; }
  hydrated = true;
  seq = 0;
}
