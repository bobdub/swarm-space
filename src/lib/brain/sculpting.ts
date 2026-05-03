/**
 * ═══════════════════════════════════════════════════════════════════════
 * SCULPTING — single UQRC predicate for tool-driven world mutation
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Both User clicks and NPC drives funnel through `applyImpact` so there
 * is exactly ONE place where "energy meets structural resistance" decides
 * whether a cut happens. Density CONTRIBUTES to resistance — it does not
 * define it. Bond term and local curvature load (||[D_μ,D_ν]||) round
 * the answer out.
 *
 * INVARIANT — this module never touches the field directly. Block targets
 * are mutated through `BuilderBlockEngine`; planet targets are reported
 * via the `'cell-carved'` event so the renderer / persistence layer can
 * pick them up without coupling sculpting to either.
 */

import type { Tool } from './toolCatalog';
import type { EarthShell } from './earthShells';
import type { BuilderBlock } from './builderBlockEngine';
import { applyToolWear } from './toolSharpening';
import { emitWorldMutation } from '@/lib/world/world.bus';

export type ImpactTarget =
  | { kind: 'shell'; shell: EarthShell; rFrac: number; cellKey: string }
  | { kind: 'block'; block: BuilderBlock; hp?: number; bondTerm?: number };

export interface ImpactInput {
  tool: Tool;
  /** Current sharpness (0..1) of the placed tool block. Defaults to baseline. */
  sharpness?: number;
  /** Stable id of the placed tool block (for wear callback). */
  toolBlockId?: string;
  /** Per-action energy. User click = constant; NPC drives compute their own. */
  swingEnergy: number;
  /** Local field commutator norm at the impact point. Default 0 (calm). */
  curvatureLoad?: number;
  target: ImpactTarget;
  /** Stable id of the actor (user peerId / npc id). When present, a
   *  WorldMutationEvent is emitted onto the scaffold bus on success. */
  actorId?: string;
}

export interface ImpactResult {
  /** True if the cut succeeded (effectiveCut ≥ 1). */
  cut: boolean;
  /** Computed resistance scalar (0..∞). */
  resistance: number;
  /** Effective cut depth this swing. */
  effectiveCut: number;
  /** New tool sharpness after wear, when known. */
  newSharpness: number | null;
  /** Reason a cut was rejected, when applicable. */
  reason?: 'sharpness_below_threshold' | 'wrong_action_kind' | 'lava_burns_tool';
}

/** Resistance weights — kept as named constants so they're easy to tune. */
const W_DENSITY = 0.55;
const W_BOND    = 0.30;
const W_CURVE   = 0.15;

function actionMatchesTarget(action: Tool['actionKind'], target: ImpactTarget): boolean {
  if (target.kind === 'block') return true; // any tool can damage a block (gated by sharpness)
  // Shell targets: dig for n=1 surfaces, chop for fibrous (rare in shells), whittle for harder.
  const n = target.shell.n;
  if (action === 'dig') return n <= 1;
  if (action === 'chop') return n === 1 || n === 2;
  if (action === 'whittle') return true;
  return false;
}

function shellResistance(shell: EarthShell): { density: number; bond: number } {
  const density = shell.density;
  // Bond term: n=2/3 mineral lattices bond more strongly; n=1 loose grains less.
  const bond = shell.n === 0 ? 0
    : shell.n === 1 ? 0.3
    : shell.n === 2 ? 0.7
    : shell.n === 3 ? 1.1
    : 2.0;
  return { density, bond };
}

/**
 * The single sculpting predicate. Pure function; safe in tests.
 */
export function applyImpact(input: ImpactInput): ImpactResult {
  const { tool, target, swingEnergy } = input;
  const sharpness = input.sharpness ?? tool.baseSharpness;
  const curvatureLoad = input.curvatureLoad ?? 0;

  // Hard floors
  if (target.kind === 'shell') {
    if (target.shell.id.startsWith('lava')) {
      return { cut: false, resistance: Infinity, effectiveCut: 0, newSharpness: null, reason: 'lava_burns_tool' };
    }
    if (sharpness < target.shell.sharpnessThreshold) {
      return { cut: false, resistance: NaN, effectiveCut: 0, newSharpness: null, reason: 'sharpness_below_threshold' };
    }
  }
  if (!actionMatchesTarget(tool.actionKind, target)) {
    return { cut: false, resistance: NaN, effectiveCut: 0, newSharpness: null, reason: 'wrong_action_kind' };
  }

  // Resistance composition
  let densityTerm: number;
  let bondTerm: number;
  if (target.kind === 'shell') {
    const { density, bond } = shellResistance(target.shell);
    densityTerm = density;
    bondTerm = bond;
  } else {
    // Block targets supply their own bond term (or default mid).
    densityTerm = Math.max(0.5, tool.headDensity * 0.4);
    bondTerm = target.bondTerm ?? 0.5;
  }
  const resistance =
    W_DENSITY * densityTerm +
    W_BOND    * bondTerm +
    W_CURVE   * curvatureLoad;

  const effectiveCut = (swingEnergy * sharpness) / Math.max(0.01, resistance);
  const cut = effectiveCut >= 1;

  // Wear (only when a real swing happened, hit or miss)
  let newSharpness: number | null = null;
  if (input.toolBlockId !== undefined) {
    const r01 = Math.max(0, Math.min(1, resistance / 8));
    newSharpness = applyToolWear(input.toolBlockId, r01);
  }

  // Bus emission — only on a real cut, only when the actor is known.
  if (cut && input.actorId) {
    const targetKey = target.kind === 'shell' ? target.cellKey : target.block.id;
    try {
      emitWorldMutation({
        actorId: input.actorId,
        targetKey,
        effectiveCut,
        resistance,
        laborWeight: tool.mass * sharpness,
      });
    } catch (err) {
      console.warn('[sculpting] bus emit failed', err);
    }
  }

  return { cut, resistance, effectiveCut, newSharpness };
}

// ────────────────────────────────────────────────────────────────────────
//  Cell-carved event bus (consumed by future renderer / persistence).
// ────────────────────────────────────────────────────────────────────────

export interface CellCarvedEvent {
  cellKey: string;
  shellId: string;
  swing: ImpactResult;
}

type Listener = (evt: CellCarvedEvent) => void;
const listeners = new Set<Listener>();

export function subscribeCellCarved(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function emitCellCarved(evt: CellCarvedEvent): void {
  for (const fn of listeners) {
    try { fn(evt); } catch (err) { console.warn('[sculpting] listener error', err); }
  }
}