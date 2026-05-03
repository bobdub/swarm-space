/**
 * Scaffold Bus — typed event contracts.
 *
 * Phase Two unification scaffolding. Every event is a small, plain-data
 * envelope; the bus does the field translation. Keep these types stable
 * so subsystems stay decoupled.
 *
 * See docs/UQRC_SCAFFOLD_WIRING.md and .lovable/plan.md.
 */

export type ScaffoldDomain =
  | 'world'   // sculpting / earth shells / placement
  | 'npc'     // body, drives, social
  | 'coin'    // weighted coins, profile token
  | 'lab'     // remix / molecule mixing
  | 'media'   // memory / media coin custody
  | 'health'; // aggregated health signals

/** Successful (or attempted) world mutation by a User or NPC. */
export interface WorldMutationEvent {
  domain: 'world';
  type: 'mutation';
  /** Stable id of the actor (user peerId or npc id). */
  actorId: string;
  /** Identifier of what was hit (cellKey or blockId). */
  targetKey: string;
  /** Effective cut depth this swing. */
  effectiveCut: number;
  /** Resistance scalar that opposed the cut. */
  resistance: number;
  /** mass · sharpness — used to credit "labor" weight. */
  laborWeight: number;
}

export interface NpcDecisionEvent {
  domain: 'npc';
  type: 'decision';
  npcId: string;
  verb: string;
  /** Min-curvature score that selected this verb. */
  qDelta: number;
}

export interface CoinFillEvent {
  domain: 'coin';
  type: 'fill';
  coinId: string;
  ownerId: string;
  delta: number;
}

export interface LabRecipeEvent {
  domain: 'lab';
  type: 'recipe';
  recipeId: string;
  formula: string;
  /** True if the mix produced a valid molecule. */
  ok: boolean;
}

export interface MediaCustodyEvent {
  domain: 'media';
  type: 'custody';
  coinId: string;
  pieceHash: string;
  ownerId: string;
}

export type ScaffoldEvent =
  | WorldMutationEvent
  | NpcDecisionEvent
  | CoinFillEvent
  | LabRecipeEvent
  | MediaCustodyEvent;

export type ScaffoldHandler<E extends ScaffoldEvent = ScaffoldEvent> = (evt: E) => void;