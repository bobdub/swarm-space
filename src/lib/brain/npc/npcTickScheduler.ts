/**
 * npcTickScheduler — the live 8 Hz heartbeat for the NPC layer.
 *
 * Phase 2 wiring. Discipline mirrors `coinFillScheduler`:
 *   • Singleton, HMR-safe (module-level state).
 *   • Pulls from existing pure modules — never duplicates math.
 *   • Honors a feature-flag kill-switch (`scaffoldBus`).
 *   • Uses a stress sampler so tests run without a real Field.
 *
 * Per tick, for every NPC:
 *   1. derive DriveSignals from the live field
 *   2. choose a drive via personality-weighted utility
 *   3. tie-break across "near-best" candidates with selectByMinCurvature
 *      (the |Ψ_Output⟩ rule — never Math.random())
 *   4. apply the drive's consumption to the local memo
 *   5. emit `npc:decision` on the scaffold bus and record an outcome
 *      in the NPC's skill memory
 *   6. age the NPC by `dt / brainYearSeconds`
 *
 * Population maintenance is light-touch here — `seedCommunity` is
 * spawned lazily on first start; reproduction stays in
 * `reproduce.ts` and is intentionally NOT triggered by this scheduler
 * yet (the harmony window requires sustained 600 brain-seconds and is
 * gated for Phase 3 stress-testing).
 */
import { getSharedFieldEngine } from '@/lib/uqrc/fieldEngine';
import { selectByMinCurvature } from '@/lib/uqrc/fieldProjection';
import { getFeatureFlags, subscribeToFeatureFlags } from '@/config/featureFlags';
import { listNpcs, update as updateNpc } from './npcRegistry';
import { spawnNpc } from './npcEngine';
import { INITIAL_NPCS } from './seedCommunity';
import { chooseIntent } from './npcDrives';
import { sampleSignalsForNpc, applyDriveOutcome, clearNpcSignalMemo } from './npcSignals';
import { recordOutcome } from './npcSkills';
import { emitNpcDecision } from './npc.bus';
import { scheduleNpcRosterSave, flushNpcRosterSave } from './npcPersistence';
import { NPC_LIFESPAN_YEARS, type Npc, type NpcDrive } from './npcTypes';

const TICK_HZ = 8;
const TICK_MS = 1000 / TICK_HZ;
/** Brain-time compression — 1 wall second ≈ N brain-seconds. */
const BRAIN_TIME_SCALE = 4;
/** Brain-seconds in a brain-year (compact for play; matches lifespan ≈ 30 y). */
const BRAIN_YEAR_SECONDS = 60 * 60;

let _timer: ReturnType<typeof setInterval> | null = null;
let _lastTickAt = 0;
let _seeded = false;
let _flagUnsub: (() => void) | null = null;
let _unloadHooked = false;

/** Spawn the initial roster on first start. Idempotent. */
function ensureSeed(): void {
  if (_seeded) return;
  _seeded = true;
  if (listNpcs().length > 0) return; // hydrated from persistence
  for (const spec of INITIAL_NPCS) {
    try {
      spawnNpc({
        name: spec.name,
        sex: spec.sex,
        anchorPeerId: 'self',
        seed: spec.baseString,
      });
    } catch (err) {
      console.warn('[npcTick] seed spawn failed for', spec.name, err);
    }
  }
}

/** Candidate verbs for tie-breaking (top-K by utility). */
function topKVerbs(scored: Array<[NpcDrive, number]>, k: number): NpcDrive[] {
  const sorted = [...scored].sort((a, b) => b[1] - a[1]);
  return sorted.slice(0, k).map(([d]) => d);
}

function tickOne(npc: Npc, dtSeconds: number): void {
  let engine;
  try { engine = getSharedFieldEngine(); } catch { return; }

  const hasTool = (npc.skills?.['craft'] ?? 0) > 0.55;
  const sig = sampleSignalsForNpc(engine, npc, dtSeconds, hasTool);

  // Primary choice via personality utility (deterministic, fast).
  const primary = chooseIntent(npc.seed, sig);

  // Tie-break against 2 alternates using the field's min-curvature rule.
  // Falls back to `primary` until the field is warmed up.
  const alternates: NpcDrive[] = (['rest', 'gather', 'socialise'] as const)
    .filter((d) => d !== primary)
    .slice(0, 2);
  const candidates: NpcDrive[] = [primary, ...alternates];
  const picked = selectByMinCurvature(
    candidates,
    engine,
    (d) => `npc:${npc.id}:verb:${d}`,
    0.18,
  ) ?? primary;

  // Outcome bookkeeping.
  applyDriveOutcome(npc.id, picked);
  const success = picked === primary; // tie-break agreement counts as a hit
  recordOutcome(npc.id, picked, success);

  // Aging in brain-years.
  const aged: Npc = {
    ...npc,
    ageYears: Math.min(NPC_LIFESPAN_YEARS, npc.ageYears + dtSeconds / BRAIN_YEAR_SECONDS),
  };
  updateNpc(aged);

  // Cheap qDelta proxy: agreement → 0, disagreement → small positive.
  const qDelta = success ? 0 : 0.05;
  emitNpcDecision({ npcId: npc.id, verb: picked, qDelta });
}

function tickAll(): void {
  if (!getFeatureFlags().scaffoldBus) return;
  const now = Date.now();
  const wallDt = _lastTickAt === 0 ? TICK_MS / 1000 : (now - _lastTickAt) / 1000;
  _lastTickAt = now;
  const brainDt = wallDt * BRAIN_TIME_SCALE;

  const roster = listNpcs();
  if (roster.length === 0) return;
  for (const npc of roster) {
    try { tickOne(npc, brainDt); } catch (err) {
      console.warn('[npcTick] tick failed for', npc.id, err);
    }
  }
  scheduleNpcRosterSave(roster);
}

function hookUnloadOnce(): void {
  if (_unloadHooked || typeof window === 'undefined') return;
  _unloadHooked = true;
  const flush = () => { try { flushNpcRosterSave(listNpcs()); } catch { /* noop */ } };
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('beforeunload', flush);
}

/** Start the live NPC heartbeat. Idempotent. */
export function startNpcTickScheduler(): void {
  if (_timer !== null) return;
  if (typeof window === 'undefined') return;
  ensureSeed();
  hookUnloadOnce();
  _lastTickAt = 0;
  _timer = setInterval(tickAll, TICK_MS);

  // Kill-switch: stop when scaffoldBus flips off, restart when it flips on.
  if (!_flagUnsub) {
    _flagUnsub = subscribeToFeatureFlags((flags) => {
      if (!flags.scaffoldBus && _timer !== null) {
        clearInterval(_timer);
        _timer = null;
      }
    });
  }
}

/** Stop and tear down (test + HMR safety). */
export function stopNpcTickScheduler(): void {
  if (_timer !== null) { clearInterval(_timer); _timer = null; }
  if (_flagUnsub) { _flagUnsub(); _flagUnsub = null; }
  for (const npc of listNpcs()) clearNpcSignalMemo(npc.id);
}

/** Test seam. */
export function _resetTickSchedulerForTest(): void {
  stopNpcTickScheduler();
  _seeded = false;
  _lastTickAt = 0;
  _unloadHooked = false;
}