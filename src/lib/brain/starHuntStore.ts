/**
 * Device-local state for the star hunt: which night's chart you have read,
 * your star log (finds per constellation), and the live gaze progress the
 * HUD shows. Nothing here is sent to peers. The log persists in
 * localStorage when it is available and works without it.
 */
import { useSyncExternalStore } from 'react';

export interface StarLogEntry {
  /** Night index of the first find. */
  firstNight: number;
  /** Night index of the latest find. */
  lastNight: number;
  /** Nights on which this figure was found. */
  count: number;
}

export interface StarHuntState {
  /** Night index whose chart this device last read, or null. */
  chartNight: number | null;
  log: Record<string, StarLogEntry>;
  /** 0..1 hold progress for the on-screen ring (0 hides it). */
  progress: number;
}

const STORAGE_KEY = 'brain.starHunt.v1';

function load(): Pick<StarHuntState, 'chartNight' | 'log'> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return { chartNight: null, log: {} };
    const parsed = JSON.parse(raw) as Partial<StarHuntState>;
    return {
      chartNight: typeof parsed.chartNight === 'number' ? parsed.chartNight : null,
      log: parsed.log && typeof parsed.log === 'object' ? parsed.log : {},
    };
  } catch {
    return { chartNight: null, log: {} };
  }
}

function save(s: StarHuntState): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({ chartNight: s.chartNight, log: s.log }));
  } catch {
    /* private mode or storage blocked: the hunt still works this session */
  }
}

let state: StarHuntState = { ...load(), progress: 0 };
const listeners = new Set<() => void>();
const foundListeners = new Set<(id: string, entry: StarLogEntry) => void>();

function set(next: StarHuntState) {
  state = next;
  listeners.forEach((l) => l());
}

export function getStarHunt(): StarHuntState {
  return state;
}

export function subscribeStarHunt(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useStarHunt(): StarHuntState {
  return useSyncExternalStore(subscribeStarHunt, getStarHunt, getStarHunt);
}

/** Called when you stand at the chart: tonight's hunt is open to you. */
export function markChartRead(night: number): void {
  if (state.chartNight === night) return;
  const next = { ...state, chartNight: night };
  save(next);
  set(next);
}

/** Whether `id` has already been logged on night `night`. */
export function foundTonight(id: string, night: number): boolean {
  return state.log[id]?.lastNight === night;
}

/** Log a find. Once per constellation per night. */
export function logFind(id: string, night: number): StarLogEntry | null {
  if (foundTonight(id, night)) return null;
  const prev = state.log[id];
  const entry: StarLogEntry = prev
    ? { firstNight: prev.firstNight, lastNight: night, count: prev.count + 1 }
    : { firstNight: night, lastNight: night, count: 1 };
  const next = { ...state, log: { ...state.log, [id]: entry }, progress: 0 };
  save(next);
  set(next);
  foundListeners.forEach((l) => l(id, entry));
  return entry;
}

/** Update the on-screen hold ring. Ignores changes too small to see. */
export function setGazeProgress(progress: number): void {
  if (Math.abs(progress - state.progress) < 0.02 && !(progress === 0 && state.progress !== 0)) return;
  set({ ...state, progress });
}

export function onStarFound(listener: (id: string, entry: StarLogEntry) => void): () => void {
  foundListeners.add(listener);
  return () => { foundListeners.delete(listener); };
}

/** Test hook: forget everything. */
export function resetStarHuntForTests(): void {
  state = { chartNight: null, log: {}, progress: 0 };
  listeners.forEach((l) => l());
}

// Indoors flag, written by the bar each frame and read by the hunt. Plain
// variable, not React state: nothing renders from it.
let indoors = false;
export function setIndoors(value: boolean): void { indoors = value; }
export function isIndoors(): boolean { return indoors; }
