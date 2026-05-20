/**
 * reproductionScheduler — periodic harmony evaluator + birth gate.
 *
 * Phase 8 wiring. Runs once every REPRO_CHECK_MS wall-ms while the NPC
 * tick scheduler is alive. For every female × male pair currently in
 * the registry it:
 *   1. samples the field's pairwise curvature commutator proxy,
 *   2. updates a smooth-relations edge (Welford-smoothed),
 *   3. on harmonyOk + canBond + reserves, deterministically merges
 *      personality seeds and spawns the child via npcEngine.spawnNpc.
 *
 * No Math.random anywhere — drift seed is a deterministic time-slot
 * key; sex is hash-derived from the pairId.
 */
import { getSharedFieldEngine } from '@/lib/uqrc/fieldEngine';
import { getFeatureFlags } from '@/config/featureFlags';
import { listNpcs, isSeedUnique, npcCount } from './npcRegistry';
import { spawnNpc } from './npcEngine';
import { tryReproduce } from './reproduce';
import { pairId, newEdge, updateEdge } from './relations';
import { canBond, type StandardsContext } from './socialStandards';
import { getInventory } from './npcChemistry';
import { emitNpcDecision } from './npc.bus';
import { NPC_CAP, type Npc, type NpcSex, type RelationalEdge } from './npcTypes';

const REPRO_CHECK_MS = 30 * 1000;
const BRAIN_TIME_SCALE = 4;

const _edges = new Map<string, RelationalEdge>();
let _timer: ReturnType<typeof setInterval> | null = null;
let _lastAt = 0;

function sexFromPairId(pid: string): NpcSex {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < pid.length; i++) {
    h ^= pid.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h & 1) === 0 ? 'female' : 'male';
}

function deterministicName(parentA: Npc, parentB: Npc, slot: number): string {
  // Tiny deterministic name from parents — readable, no RNG.
  const a = parentA.name[0] ?? 'X';
  const b = parentB.name[0] ?? 'X';
  return `${a}${b}-${slot.toString(36)}`;
}

function sampleCommutator(a: Npc, b: Npc): number {
  let engine;
  try { engine = getSharedFieldEngine(); } catch { return 0.2; }
  const ka = `npc:${a.id}:verb:${a.currentDrive ?? 'rest'}`;
  const kb = `npc:${b.id}:verb:${b.currentDrive ?? 'rest'}`;
  const ca = engine.getCurvatureForText(ka);
  const cb = engine.getCurvatureForText(kb);
  return Math.abs(ca - cb);
}

function tick(): void {
  if (!getFeatureFlags().scaffoldBus) return;
  if (npcCount() >= NPC_CAP) return;

  const now = Date.now();
  const wallDt = _lastAt === 0 ? REPRO_CHECK_MS / 1000 : (now - _lastAt) / 1000;
  _lastAt = now;
  const brainDt = wallDt * BRAIN_TIME_SCALE;

  const roster = listNpcs();
  const females = roster.filter((n) => n.sex === 'female');
  const males = roster.filter((n) => n.sex === 'male');

  const ctx: StandardsContext = { pendingGestations: new Set<string>() };

  for (const f of females) {
    for (const m of males) {
      const pid = pairId(f.id, m.id);
      const prev = _edges.get(pid) ?? newEdge(f.id, m.id, now);
      const commutator = sampleCommutator(f, m);
      const edge = updateEdge(prev, commutator, brainDt, now);
      _edges.set(pid, edge);

      // Standards gate cheaply, before merging seeds.
      if (!canBond(f, m, ctx).allowed) continue;

      const invF = getInventory(f.id);
      const invM = getInventory(m.id);
      const reservesA = invF.food + invF.water;
      const reservesB = invM.food + invM.water;

      const slot = Math.floor(now / (60 * 60 * 1000));
      const result = tryReproduce({
        parentA: f,
        parentB: m,
        edge,
        reservesA,
        reservesB,
        standardsCtx: ctx,
        isSeedUnique,
        driftSeed: `${pid}:${slot}`,
      });
      if (!result.allowed) continue;

      const sex = sexFromPairId(pid + ':' + slot);
      const childName = deterministicName(f, m, slot);
      const spawned = spawnNpc({
        name: childName,
        sex,
        anchorPeerId: f.anchorPeerId,
        seed: result.childSeed,
      });
      if (spawned.ok) {
        emitNpcDecision({ npcId: spawned.npc.id, verb: 'reproduce', qDelta: 0 });
        // Reset the harmony streak so the same pair doesn't immediately re-reproduce.
        _edges.set(pid, { ...edge, harmonyStreakSeconds: 0 });
      }
      if (npcCount() >= NPC_CAP) return;
    }
  }
}

export function startReproductionScheduler(): void {
  if (_timer !== null) return;
  if (typeof window === 'undefined') return;
  _lastAt = 0;
  _timer = setInterval(tick, REPRO_CHECK_MS);
}

export function stopReproductionScheduler(): void {
  if (_timer !== null) { clearInterval(_timer); _timer = null; }
}

/** Test seam. */
export function _resetReproductionForTest(): void {
  stopReproductionScheduler();
  _edges.clear();
  _lastAt = 0;
}
