/**
 * wallColliders — avatar-scale AABB registry for pedestrian collision.
 *
 * The UQRC field is 24³ cells over ~12.75 km, so wall-scale basins all
 * collapse into a single cell and provide no pedestrian barrier. This
 * registry lives entirely outside the field: wall boxes are stored in
 * village-local coords (the same `rightOffset` / `forwardOffset` /
 * `upOffset` frame every BuilderBlock already uses) and consumed by a
 * post-integration correction step on the local avatar body.
 *
 * No physics coupling, no field writes.
 */

export type WallColliderId = string;

export interface WallColliderSpec {
  id: WallColliderId;
  anchorPeerId: string;
  /** Center of the box in village-local coords. */
  rightOffset: number;
  forwardOffset: number;
  upOffset: number;
  /** Half-extents along local right / up / forward axes. */
  halfRight: number;
  halfUp: number;
  halfForward: number;
}

const registry = new Map<WallColliderId, WallColliderSpec>();

export function addWallCollider(spec: WallColliderSpec): void {
  registry.set(spec.id, spec);
}

export function removeWallCollider(id: WallColliderId): void {
  registry.delete(id);
}

export function listWallColliders(): readonly WallColliderSpec[] {
  return Array.from(registry.values());
}