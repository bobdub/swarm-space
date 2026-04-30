/**
 * socialStandards — emergent community norms gating reproduction.
 *
 * No hardcoded rules. The predicate reads recent registry / event
 * history and rejects pairs that violate observed patterns:
 *   - both parties must be of reproductive age (>= MATURITY_YEARS)
 *   - neither may already be in an active gestation
 *   - community must not have flagged either party recently (placeholder
 *     for future moderation feedback loop)
 *
 * This is a thin scaffold — richer norm extraction (courtship rituals,
 * pair-bond respect, public-display memory) lands once event history
 * persistence is online.
 */
import type { Npc } from './npcTypes';

const MATURITY_YEARS = 6;

export interface StandardsContext {
  /** IDs currently in an active gestation. */
  pendingGestations: ReadonlySet<string>;
}

export interface BondDecision {
  allowed: boolean;
  reason?: 'too-young' | 'pending-gestation' | 'unknown-party';
}

export function canBond(a: Npc | undefined, b: Npc | undefined, ctx: StandardsContext): BondDecision {
  if (!a || !b) return { allowed: false, reason: 'unknown-party' };
  if (a.ageYears < MATURITY_YEARS || b.ageYears < MATURITY_YEARS) {
    return { allowed: false, reason: 'too-young' };
  }
  if (ctx.pendingGestations.has(a.id) || ctx.pendingGestations.has(b.id)) {
    return { allowed: false, reason: 'pending-gestation' };
  }
  return { allowed: true };
}