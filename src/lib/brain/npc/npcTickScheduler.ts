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
 *   1. derive DriveSignals from the live field (deficits ramp)
 *   2. fetch a dropped tool it lacks, unless thirst or hunger can't wait
 *   3. otherwise follow the shared daily routine (`villageSchedule.ts`):
 *      position and drive are a pure function of name, personality and
 *      the shared clock, so every peer sees the same village
 *   4. once per WORK_PERIOD_S on the block's spot, do the wet work and
 *      apply the drive's consumption to the local memo
 *   5. emit `npc:decision` on a new drive or a piece of work, and record
 *      the outcome in the NPC's skill memory
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
import { spawnNpc, despawnNpc, syncNpcBodyBlocks } from './npcEngine';
import { INITIAL_NPCS } from './seedCommunity';
import { sampleSignalsForNpc, applyDriveOutcome, clearNpcSignalMemo } from './npcSignals';
import { recordOutcome } from './npcSkills';
import { emitNpcDecision } from './npc.bus';
import { batchScaffoldInjects } from '@/lib/uqrc/scaffoldBus';
import { startBeatLoop, type BeatLoop } from '@/lib/time/sharedBeat';
import { scheduleNpcRosterSave, flushNpcRosterSave } from './npcPersistence';
import { type Npc, type NpcDrive } from './npcTypes';
import { villagePlan } from './villageSchedule';
import { getEarthPoseTime } from '@/lib/brain/earth';
import { mortalityProbability } from './mortality';
import { driveToResourceKind } from '@/lib/world/resourceTargeting';
import { listResourceSites, tickRegrowth } from '@/lib/world/baseResources';
import { interact as wetInteract } from '@/lib/world/wetWork';
import {
  listLooseTools,
  ownedToolKinds,
  pickToolToFetch,
  pickUpTool,
  vanishUnwantedTools,
  TOOL_PICKUP_RADIUS_M,
  type LooseTool,
  type NpcToolKind,
} from './npcTools';
import { resolveLocalAnchorId } from './localAnchor';
import { isNpcSceneActive } from './npcSceneGate';
import { needsTopUp, topUpVillage } from './villageFloor';

export { retainNpcScene, isNpcSceneActive } from './npcSceneGate';

const TICK_HZ = 8;
const TICK_MS = 1000 / TICK_HZ;
/** Most beats one tick may cover after the tab was throttled (2 s). */
const MAX_CATCHUP_BEATS = 16;
/** Brain-time compression — 1 wall second ≈ N brain-seconds. */
const BRAIN_TIME_SCALE = 4;
/** Brain-seconds in a brain-year (compact for play; matches lifespan ≈ 30 y). */
const BRAIN_YEAR_SECONDS = 60 * 60;

/**
 * UQRC locomotion — speed is the inertial response to a drive impulse:
 *   v = (F / m) · κ_gate
 * where F is the personality-weighted desire (≈ const), m is the body's
 * aggregate mass (Σ slot.mass), and κ_gate ∈ [0.4, 1.0] is a curvature
 * dampener derived from the recent decision tie-break. Heavier NPCs
 * move slower; lighter NPCs scurry. Matches the 𝒪_UQRC(u) = ν Δu + ℛ u
 * inertia term — never Math.random.
 */
const BASE_DRIVE_FORCE = 40;       // arbitrary UQRC units (tuned for play)
const REFERENCE_MASS   = 33;       // total mass of a default seed body
const MIN_SPEED = 0.25;
const MAX_SPEED = 2.2;

function totalBodyMass(npc: Npc): number {
  let m = 0;
  for (const slot of npc.body) m += slot.mass;
  return Math.max(m, 0.001);
}

function uqrcSpeed(npc: Npc, curvatureGate: number): number {
  const m = totalBodyMass(npc);
  const raw = (BASE_DRIVE_FORCE / m) * curvatureGate;
  // Normalise so a REFERENCE_MASS body at gate=1.0 ≈ 1.2 m/s baseline.
  const v = raw * (1.2 * REFERENCE_MASS / BASE_DRIVE_FORCE);
  return Math.max(MIN_SPEED, Math.min(MAX_SPEED, v));
}

/** Extra pace (× walking speed) for a villager walking back to its routine. */
const CATCHUP_FACTOR = 0.5;
/** Seconds between pieces of work while standing at a block's spot. */
const WORK_PERIOD_S = 6;
/** npcId → last work slot, so work happens once per WORK_PERIOD_S. */
const _lastWorkSlot = new Map<string, number>();

/** Real walking speed (m/s) of `npc` along its routine. */
export function npcWalkSpeed(npc: Npc): number {
  return uqrcSpeed(npc, 1.0) * BRAIN_TIME_SCALE;
}

/** Tool fetching yields to thirst and hunger past this deficit. */
const FETCH_DEFICIT_LIMIT = 0.7;
/** How often unwanted dropped tools are checked for vanishing. */
const VANISH_SWEEP_MS = 1000;

/** Loose tools for this tick, by NPC anchor (one scan per tick). */
let _looseTools = new Map<string, LooseTool[]>();
/** placementId → id of the local NPC walking to it, so two don't race. */
const _fetching = new Map<string, string>();
let _lastVanishSweepAt = 0;

function looseToolsFor(anchorId: string): LooseTool[] {
  let list = _looseTools.get(anchorId);
  if (!list) {
    try { list = listLooseTools(anchorId); } catch { list = []; }
    _looseTools.set(anchorId, list);
  }
  return list;
}

/** Let go of any tool this NPC was walking to. */
function releaseFetch(npcId: string): void {
  for (const [placementId, id] of _fetching) if (id === npcId) _fetching.delete(placementId);
}

function localRecorderId(): string {
  const id = resolveLocalAnchorId('self');
  return id && id !== 'self' ? id : 'local';
}

/**
 * Walk toward (and pick up) a dropped tool this NPC does not own a kind
 * of yet. Returns the next position when the NPC spent its tick on it,
 * or null when it has no tool to go after.
 */
function fetchTool(
  npc: Npc,
  owned: ReadonlySet<NpcToolKind>,
  dtSeconds: number,
): { tx: number; tz: number } | null {
  const tools = looseToolsFor(npc.anchorPeerId);
  const takenByOthers = new Set<string>();
  for (const [placementId, npcId] of _fetching) {
    if (npcId !== npc.id) takenByOthers.add(placementId);
  }
  const target = pickToolToFetch(npc, tools, owned, takenByOthers);
  for (const [placementId, npcId] of _fetching) {
    if (npcId === npc.id && placementId !== target?.placementId) _fetching.delete(placementId);
  }
  if (!target || target.tx === null || target.tz === null) return null;
  _fetching.set(target.placementId, npc.id);
  const dx = target.tx - npc.tx;
  const dz = target.tz - npc.tz;
  const d = Math.hypot(dx, dz);
  if (d > TOOL_PICKUP_RADIUS_M) {
    const step = Math.min(d, uqrcSpeed(npc, 1.0) * dtSeconds);
    return { tx: npc.tx + (dx / d) * step, tz: npc.tz + (dz / d) * step };
  }
  _fetching.delete(target.placementId);
  // Drop it from this tick's list either way: it's ours, or a peer's NPC won.
  const list = _looseTools.get(npc.anchorPeerId);
  if (list) _looseTools.set(npc.anchorPeerId, list.filter((t) => t.placementId !== target.placementId));
  pickUpTool(npc, target, localRecorderId());
  return { tx: npc.tx, tz: npc.tz };
}

let _timer: BeatLoop | null = null;
/** False while asleep, so the first awake beat steps one beat, not the gap. */
let _awake = false;

let _seeded = false;
let _flagUnsub: (() => void) | null = null;
let _unloadHooked = false;

/** Spawn the initial roster on first start. Idempotent. */
function ensureSeed(): void {
  if (_seeded) return;
  _seeded = true;
  if (listNpcs().length > 0) {
    console.log(`[npcTick] seed skipped — registry already has ${listNpcs().length} NPC(s) from persistence`);
    return;
  }
  console.log(`[npcTick] seeding initial roster (${INITIAL_NPCS.length} NPCs)`);
  let ok = 0;
  for (const spec of INITIAL_NPCS) {
    try {
      const res = spawnNpc({
        name: spec.name,
        sex: spec.sex,
        anchorPeerId: 'self',
        seed: spec.baseString,
      });
      if ('ok' in res && res.ok) ok += 1;
      else console.warn('[npcTick] seed spawn rejected', spec.name, res);
    } catch (err) {
      console.warn('[npcTick] seed spawn failed for', spec.name, err);
    }
  }
  console.log(`[npcTick] seed complete — ${ok}/${INITIAL_NPCS.length} spawned, registry now has ${listNpcs().length} NPC(s)`);
}

/** Candidate verbs for tie-breaking (top-K by utility). */
function topKVerbs(scored: Array<[NpcDrive, number]>, k: number): NpcDrive[] {
  const sorted = [...scored].sort((a, b) => b[1] - a[1]);
  return sorted.slice(0, k).map(([d]) => d);
}

interface TickFrame {
  /** Shared epoch seconds of this beat. */
  seconds: number;
  /** Wall seconds this tick covers. */
  wallDt: number;
  /** First beat after sleep: jump to the routine instead of walking to it. */
  snap: boolean;
}

function tickOne(npc: Npc, dtSeconds: number, frame: TickFrame): void {
  let engine;
  try { engine = getSharedFieldEngine(); } catch { return; }

  const owned = ownedToolKinds(npc.name);
  const hasTool = owned.size > 0 || (npc.skills?.['craft'] ?? 0) > 0.55;
  const sig = sampleSignalsForNpc(engine, npc, dtSeconds, hasTool);

  // A dropped tool nearby that this NPC has no kind of yet: go and get it,
  // unless thirst or hunger can't wait. Picking it up counts as gathering.
  const urgent = sig.hydrationDeficit >= FETCH_DEFICIT_LIMIT || sig.energyDeficit >= FETCH_DEFICIT_LIMIT;
  if (urgent) releaseFetch(npc.id);
  const fetched = urgent ? null : fetchTool(npc, owned, dtSeconds);
  if (fetched) {
    const moved: Npc = {
      ...npc,
      ageYears: npc.ageYears + dtSeconds / BRAIN_YEAR_SECONDS,
      currentDrive: 'gather',
      tx: fetched.tx,
      tz: fetched.tz,
    };
    updateNpc(moved);
    syncNpcBodyBlocks(moved);
    emitNpcDecision({ npcId: npc.id, verb: 'gather', qDelta: 0 });
    return;
  }

  // The shared daily routine decides where the villager is and what it is
  // doing (`villageSchedule.ts`): a pure function of name, personality and
  // the shared clock, so every peer agrees without a byte on the wire.
  // A villager knocked off its spot (a tool detour) walks back at a brisk
  // pace; on waking from sleep everyone snaps straight to the routine.
  const speed = npcWalkSpeed(npc);
  const plan = villagePlan(npc, frame.seconds, speed);
  const picked = plan.drive;
  let nextTx = plan.tx;
  let nextTz = plan.tz;
  if (!frame.snap) {
    const dx = plan.tx - npc.tx;
    const dz = plan.tz - npc.tz;
    const d = Math.hypot(dx, dz);
    const reach = (speed + speed * CATCHUP_FACTOR) * frame.wallDt;
    if (d > reach) {
      nextTx = npc.tx + (dx / d) * reach;
      nextTz = npc.tz + (dz / d) * reach;
    }
  }
  const onSpot = nextTx === plan.tx && nextTz === plan.tz;

  // Wet work: once per WORK_PERIOD_S while standing on the block's spot.
  const kind = driveToResourceKind(picked);
  const slot = Math.floor(frame.seconds / WORK_PERIOD_S);
  const working = plan.arrived && onSpot && _lastWorkSlot.get(npc.id) !== slot;
  let qDelta = 0;
  if (working) {
    _lastWorkSlot.set(npc.id, slot);
    let contacted = !kind;
    if (kind) {
      const sites = listResourceSites();
      // Eating only needs food in hand; any site satisfies the signature.
      const site = sites.find((x) => x.id === plan.siteId) ?? (picked === 'eat' ? sites[0] : undefined);
      if (site) contacted = wetInteract(npc, picked, site, owned).ok;
    }
    if (contacted) applyDriveOutcome(npc.id, picked);
    recordOutcome(npc.id, picked, contacted);
    qDelta = contacted ? 0 : 0.05;
  }

  // Aging in brain-years — no clamp; mortality is a smooth logistic.
  const aged: Npc = {
    ...npc,
    ageYears: npc.ageYears + dtSeconds / BRAIN_YEAR_SECONDS,
    currentDrive: picked,
    tx: nextTx,
    tz: nextTz,
  };
  updateNpc(aged);
  syncNpcBodyBlocks(aged);

  // Smooth-decay mortality — deterministic via min-curvature gate.
  const pDeath = mortalityProbability(aged.ageYears);
  if (pDeath > 0.001) {
    const verdict = selectByMinCurvature<'live' | 'die'>(
      ['live', 'die'],
      engine,
      (d) => `npc:${aged.id}:mortality:${d}`,
      pDeath,
    );
    if (verdict === 'die') {
      despawnNpc(aged.id);
      clearNpcSignalMemo(aged.id);
      _lastWorkSlot.delete(aged.id);
      emitNpcDecision({ npcId: aged.id, verb: 'die', qDelta: pDeath });
      // Below the floor, or without a female × male pair, refill.
      if (needsTopUp()) topUpVillage(aged.anchorPeerId);
      return;
    }
  }

  // Tell the field (and the body pulse) about real events only: a new
  // drive or a piece of work, not every 8 Hz beat of a walk.
  if (working || picked !== npc.currentDrive) emitNpcDecision({ npcId: npc.id, verb: picked, qDelta });
}

function tickAll(_beat: number, elapsedBeats: number): void {
  if (!getFeatureFlags().scaffoldBus) return;
  if (!isNpcSceneActive()) {
    // Asleep: the next awake tick starts a fresh dt instead of replaying
    // the whole off-scene gap as one giant step.
    _awake = false;
    return;
  }
  const now = Date.now();
  // dt comes from shared beats, so every peer steps the village by the
  // same amount on the same beat. Cap catch-up after a throttled tab.
  const snap = !_awake;
  const beats = _awake ? Math.max(1, Math.min(MAX_CATCHUP_BEATS, elapsedBeats)) : 1;
  _awake = true;
  const wallDt = (beats * TICK_MS) / 1000;
  const brainDt = wallDt * BRAIN_TIME_SCALE;
  const frame: TickFrame = { seconds: getEarthPoseTime(), wallDt, snap };

  // Regrow resource sites once per tick (cheap O(n_sites)).
  try { tickRegrowth(now); } catch { /* noop */ }

  const roster = listNpcs();
  if (roster.length === 0) return;

  // One scan of the ground per tick; NPCs share it.
  _looseTools = new Map();
  // A walker that died or left can't keep a tool reserved.
  const alive = new Set(roster.map((n) => n.id));
  for (const [placementId, npcId] of _fetching) if (!alive.has(npcId)) _fetching.delete(placementId);
  if (now - _lastVanishSweepAt >= VANISH_SWEEP_MS) {
    _lastVanishSweepAt = now;
    try {
      // Vanishing ignores distance, so any one anchor's full list will do.
      vanishUnwantedTools(looseToolsFor(roster[0].anchorPeerId), roster, localRecorderId(), now);
      _looseTools = new Map();
    } catch (err) {
      console.warn('[npcTick] unwanted tool sweep failed', err);
    }
  }
  // One shared field read per tick: decisions emitted during the pass are
  // applied to the field together afterwards, so NPCs don't bust the
  // engine's curvature cache for each other mid-pass.
  batchScaffoldInjects(() => {
    for (const npc of roster) {
      try { tickOne(npc, brainDt, frame); } catch (err) {
        console.warn('[npcTick] tick failed for', npc.id, err);
      }
    }
  });
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
  // Safety net: if seeding silently produced zero NPCs (e.g. a stale
  // `_seeded` flag from HMR), force one more pass without the guard so
  // the world is never empty of entities.
  if (listNpcs().length === 0) {
    console.warn('[npcTick] registry still empty after ensureSeed — forcing fallback seed');
    _seeded = false;
    ensureSeed();
  }
  hookUnloadOnce();
  _awake = false;
  _timer = startBeatLoop(TICK_MS, tickAll);

  // Kill-switch: stop when scaffoldBus flips off, restart when it flips on.
  if (!_flagUnsub) {
    _flagUnsub = subscribeToFeatureFlags((flags) => {
      if (!flags.scaffoldBus && _timer !== null) {
        _timer.stop();
        _timer = null;
      }
    });
  }
}

/** Stop and tear down (test + HMR safety). */
export function stopNpcTickScheduler(): void {
  if (_timer !== null) { _timer.stop(); _timer = null; }
  if (_flagUnsub) { _flagUnsub(); _flagUnsub = null; }
  for (const npc of listNpcs()) clearNpcSignalMemo(npc.id);
}

/** Test seam. */
export function _resetTickSchedulerForTest(): void {
  stopNpcTickScheduler();
  _seeded = false;
  _awake = false;
  _unloadHooked = false;
  _looseTools = new Map();
  _fetching.clear();
  _lastWorkSlot.clear();
  _lastVanishSweepAt = 0;
}