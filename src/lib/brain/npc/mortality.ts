/**
 * mortality — pure logistic decay for NPC lifespan.
 *
 * UQRC-style smooth curve: probability of dying THIS brain-second rises
 * sigmoidally around `MORTALITY_MU = NPC_LIFESPAN_YEARS`. Used by the
 * NPC tick scheduler as the epsilon fed into `selectByMinCurvature`,
 * so the decision is deterministic — no Math.random.
 */
import { MORTALITY_K, MORTALITY_MU } from './npcTypes';

/** p_death(age) ∈ [0, 1]. */
export function mortalityProbability(ageYears: number): number {
  const x = -MORTALITY_K * (ageYears - MORTALITY_MU);
  return 1 / (1 + Math.exp(x));
}
