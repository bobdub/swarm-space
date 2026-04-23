/**
 * ═══════════════════════════════════════════════════════════════════════
 * VOLCANO SEED — proxy for the unified Volcano Organ
 * ═══════════════════════════════════════════════════════════════════════
 *
 * The volcano is now part of the Earth organism: terrain displacement in
 * `EarthBody`, collision in `uqrcPhysics`, mantle vent in `lavaMantle`,
 * and crater overlay in `NatureLayer` all read the SAME descriptor from
 * `volcanoOrgan.ts`. We no longer place separate BuilderBlockEngine props
 * (those were stacked cones that intersected the visible ground).
 *
 * This file is kept so the existing `seedVolcanoes(anchorPeerId)` call
 * site in `NatureLayer` still resolves; it simply ensures the descriptor
 * is materialised for the village anchor.
 */
import { getVolcanoOrgan } from '@/lib/brain/volcanoOrgan';

export interface SeededVolcanoes {
  anchorPeerId: string;
  blockIds: string[];
}

export function seedVolcanoes(anchorPeerId: string): SeededVolcanoes {
  // Materialise the shared organ (cached after first call). No engine
  // blocks are placed — the volcano lives in Earth geometry now.
  getVolcanoOrgan(anchorPeerId);
  return { anchorPeerId, blockIds: [] };
}