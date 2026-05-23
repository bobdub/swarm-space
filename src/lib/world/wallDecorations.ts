/**
 * wallDecorations — thin helper to pin/unpin a Post on a placed wall.
 *
 * The decoration lives on the PlacementRecord (`decoration.postId`) so it
 * persists + gossips through the existing worldPlacementsStore pipeline.
 * Posts themselves remain canonical in the `posts` IndexedDB store; this
 * module never duplicates post content.
 */
import {
  listPlacements,
  patchLocalPlacementMeta,
  type PlacementRecord,
} from '@/lib/world/worldPlacementsStore';

export async function decorateWall(
  placementId: string,
  postId: string,
): Promise<PlacementRecord | null> {
  return patchLocalPlacementMeta(placementId, {
    decoration: { postId, updatedAt: Date.now() },
  });
}

export async function clearWallDecoration(
  placementId: string,
): Promise<PlacementRecord | null> {
  return patchLocalPlacementMeta(placementId, { decoration: undefined });
}

export function getDecorationPostId(rec: PlacementRecord): string | null {
  return rec.decoration?.postId ?? null;
}