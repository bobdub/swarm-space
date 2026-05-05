/**
 * npcSignals — derive DriveSignals for an NPC from the live UQRC field.
 *
 * Pure-ish reader. Touches only the FieldEngine PUBLIC surface
 * (`getCurvatureForText`, `getQScore`) — never raw `field.axes`.
 * Internal accumulators are kept in a small per-NPC memo so the
 * deficit drives (hydration / energy / fatigue) ramp smoothly across
 * ticks instead of snapping with field noise.
 */
import type { FieldEngine } from '@/lib/uqrc/fieldEngine';
import type { DriveSignals } from './npcDrives';
import type { Npc } from './npcTypes';

interface Memo {
  hydration: number;     // 0 fully hydrated, 1 critical
  energy: number;
  fatigue: number;
  cropTimer: number;
  lastTouch: number;     // ms timestamp
}

const MEMO = new Map<string, Memo>();

const HYDRATION_DECAY_PER_S = 1 / (60 * 12);   // critical in ~12 brain-min
const ENERGY_DECAY_PER_S    = 1 / (60 * 18);
const FATIGUE_RATE_PER_S    = 1 / (60 * 25);
const CROP_RATE_PER_S       = 1 / (60 * 30);

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function ensureMemo(id: string): Memo {
  let m = MEMO.get(id);
  if (!m) {
    m = { hydration: 0.1, energy: 0.1, fatigue: 0, cropTimer: 0, lastTouch: Date.now() };
    MEMO.set(id, m);
  }
  return m;
}

/** Drop a memo (call on despawn). */
export function clearNpcSignalMemo(id: string): void {
  MEMO.delete(id);
}

/** Test seam. */
export function _resetSignalMemoForTest(): void {
  MEMO.clear();
}

/**
 * Sample drive signals for `npc` using `engine` curvature as a proxy
 * for environmental gradient. Curvature peaks become "interesting
 * regions" the NPC is drawn toward.
 */
export function sampleSignalsForNpc(
  engine: FieldEngine,
  npc: Npc,
  dtSeconds: number,
  hasTool: boolean,
): DriveSignals {
  const memo = ensureMemo(npc.id);
  const dt = Math.max(0, Math.min(5, dtSeconds));

  // Smooth deficit accumulators — bounded, monotone unless reset.
  memo.hydration = clamp01(memo.hydration + HYDRATION_DECAY_PER_S * dt);
  memo.energy    = clamp01(memo.energy    + ENERGY_DECAY_PER_S    * dt);
  memo.fatigue   = clamp01(memo.fatigue   + FATIGUE_RATE_PER_S    * dt);
  memo.cropTimer = clamp01(memo.cropTimer + CROP_RATE_PER_S       * dt);

  // Field-derived gradients. Use stable text keys so the lattice mapping
  // is deterministic across reloads.
  const baseKey   = `npc:${npc.id}`;
  const preyText  = `world:prey:${npc.anchorPeerId}`;
  const fishText  = `world:water:${npc.anchorPeerId}`;
  const gathText  = `world:gather:${npc.anchorPeerId}`;
  const socialKey = `npc:social:${npc.anchorPeerId}`;

  // Map curvature [0..~1] → gradient. Larger curvature = stronger draw.
  const c = engine.getCurvatureForText(baseKey);
  const cAmp = clamp01(0.2 + Math.abs(c));
  const preyGradient     = clamp01(engine.getCurvatureForText(preyText)  + cAmp * 0.1);
  const fishGradient     = clamp01(engine.getCurvatureForText(fishText)  + cAmp * 0.05);
  const resourceGradient = clamp01(engine.getCurvatureForText(gathText)  + 0.15);
  const socialAlignment  = clamp01(engine.getCurvatureForText(socialKey) + 0.10);

  // Crafting readiness: high if energy is OK and field is calm.
  const calm = 1 - clamp01(engine.getQScore() / 10);
  const craftReadiness = clamp01(calm * (1 - memo.energy));

  memo.lastTouch = Date.now();

  return {
    hydrationDeficit: memo.hydration,
    energyDeficit:    memo.energy,
    preyGradient,
    fishGradient,
    resourceGradient,
    cropNeglectTimer: memo.cropTimer,
    craftReadiness,
    socialAlignment,
    fatigue: memo.fatigue,
    hasTool,
  };
}

/**
 * Apply the consumption side of a chosen drive to the memo, so the
 * deficits relax when the NPC actually does the thing.
 */
export function applyDriveOutcome(npcId: string, drive: string): void {
  const m = MEMO.get(npcId);
  if (!m) return;
  switch (drive) {
    case 'drink':     m.hydration = Math.max(0, m.hydration - 0.5); break;
    case 'eat':       m.energy    = Math.max(0, m.energy    - 0.45); break;
    case 'hunt':      m.energy    = Math.max(0, m.energy    - 0.30); m.fatigue = Math.min(1, m.fatigue + 0.10); break;
    case 'fish':      m.energy    = Math.max(0, m.energy    - 0.25); break;
    case 'gather':    m.energy    = Math.max(0, m.energy    - 0.10); break;
    case 'grow':      m.cropTimer = 0; break;
    case 'craft':     m.fatigue   = Math.min(1, m.fatigue   + 0.05); break;
    case 'socialise': m.fatigue   = Math.max(0, m.fatigue   - 0.10); break;
    case 'rest':      m.fatigue   = Math.max(0, m.fatigue   - 0.40); break;
  }
}