/**
 * pubAnchors — runtime registry of interactable pub furniture.
 *
 * The bar prefab registers each interactable piece by the BuilderBlock
 * bodyId it already owns; the proximity hook resolves live world
 * positions through `blockWorldPos` so anchors move with the Earth like
 * everything else. Tag strings are the contract with
 * `src/lib/world/barInteractions.ts`.
 */

import { getBuilderBlockEngine, blockWorldPos } from '@/lib/brain/builderBlockEngine';
import { findBarInteractionByTag, INTERACT_RADIUS_M, type BarInteraction } from './barInteractions';

export interface PubAnchor {
  /** Unique key for this anchor instance. */
  key: string;
  /** Anchor tag from BAR_INTERACTIONS. */
  tag: string;
  /** BuilderBlock bodyId whose live world position this anchor tracks. */
  bodyId: string;
  /** Table this anchor opens, when the interaction is a game. */
  tableId?: string;
}

const anchors = new Map<string, PubAnchor>();

export function registerPubAnchor(anchor: PubAnchor): () => void {
  anchors.set(anchor.key, anchor);
  return () => { anchors.delete(anchor.key); };
}

export function listPubAnchors(): PubAnchor[] {
  return [...anchors.values()];
}

export interface NearbyAnchor {
  anchor: PubAnchor;
  interaction: BarInteraction;
  distance: number;
}

/**
 * Closest anchor to `pos` that is inside its own activation radius and
 * whose interaction has graduated from `planned`.
 */
export function findNearbyAnchor(pos: [number, number, number] | null): NearbyAnchor | null {
  if (!pos) return null;
  const engine = getBuilderBlockEngine();
  const pose = getEarthPose();
  // Local "up" so a wall-mounted dartboard is judged by how close you
  // stand to the wall, not by the 1.7 m it hangs above your feet.
  const ux = pos[0] - pose.center[0];
  const uy = pos[1] - pose.center[1];
  const uz = pos[2] - pose.center[2];
  const ulen = Math.hypot(ux, uy, uz) || 1;
  let best: NearbyAnchor | null = null;
  for (const anchor of anchors.values()) {
    const interaction = findBarInteractionByTag(anchor.tag);
    if (!interaction || interaction.status === 'planned') continue;
    const block = engine.getBlock(anchor.bodyId);
    if (!block) continue;
    const wp = blockWorldPos(block);
    const dx = wp[0] - pos[0];
    const dy = wp[1] - pos[1];
    const dz = wp[2] - pos[2];
    const vert = (dx * ux + dy * uy + dz * uz) / ulen;
    const horiz = Math.max(0, Math.hypot(dx, dy, dz) ** 2 - vert * vert) ** 0.5;
    const radius = interaction.radiusM || INTERACT_RADIUS_M;
    if (horiz > radius || Math.abs(vert) > 3) continue;
    if (!best || horiz < best.distance) best = { anchor, interaction, distance: horiz };
  }
  return best;
}

