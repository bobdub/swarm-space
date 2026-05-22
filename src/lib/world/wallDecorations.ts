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
  updateLocalPlacement,
  type PlacementRecord,
} from '@/lib/world/worldPlacementsStore';

export async function decorateWall(
  placementId: string,
  postId: string,
): Promise<PlacementRecord | null> {
  const rec = listPlacements().find((r) => r.placementId === placementId);
  if (!rec) return null;
  const next: PlacementRecord = {
    ...rec,
    decoration: { postId, updatedAt: Date.now() },
  };
  return updateLocalPlacement(next);
}

export async function clearWallDecoration(
  placementId: string,
): Promise<PlacementRecord | null> {
  const rec = listPlacements().find((r) => r.placementId === placementId);
  if (!rec) return null;
  const { decoration: _drop, ...rest } = rec;
  void _drop;
  return updateLocalPlacement(rest as PlacementRecord);
}

export function getDecorationPostId(rec: PlacementRecord): string | null {
  return rec.decoration?.postId ?? null;
}