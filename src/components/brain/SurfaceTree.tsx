import { useEffect, useMemo } from 'react';
import { COMPOUND_TABLE, blendColor } from '@/lib/virtualHub/compoundCatalog';
import { getBuilderBlockEngine } from '@/lib/brain/builderBlockEngine';
import { BuilderBlockView } from '@/components/brain/builder/BuilderBlockView';

/**
 * SurfaceTree — first Building-Blocks-Engine test piece.
 *
 * A simple UQRC tree placed beside the SurfaceApartment to validate the
 * gameBuilder bridge end-to-end:
 *   - Pose stored in Earth-local lat/lon-ish coords (anchor + tangent
 *     offset), so it co-rotates with the planet.
 *   - Registers a real `'piece'` body in UqrcPhysics + pins a small
 *     curvature basin via `physics.pinPiece` (basin scaled by mass).
 *   - Render reads body pose every frame and reprojects onto the feet
 *     shell (mirrors SurfaceApartment contract verbatim).
 *
 * Trunk = cellulose (oak/door_single compound, real C₆H₁₀O₅).
 * Leaves = live blend of C+H+O+N from the shared element palette, so the
 * canopy color is derived from real periodic-table data, not a magic hex.
 *
 * Phase-1 form: this component is now a thin wrapper that places the
 * block via the BuilderBlockEngine on mount and lets `BuilderBlockView`
 * own the per-frame pose work. All world mutation goes through the
 * engine — this file no longer touches physics directly.
 *
 * Inherits the SurfaceApartment known bugs (no collider; uncalibrated
 * scale) — fix once globally in earth.ts when ready.
 */
export function SurfaceTree({
  anchorPeerId,
  // Tangent-plane offset from the village anchor, in metres. Defaults
 // place the tree ~12 m to the player's right and 18 m forward, so it
 // sits next to the apartment (which is at +25 m forward, 0 right).
  rightOffset = 12,
  forwardOffset = 18,
  id = 'tree-01',
}: {
  anchorPeerId: string;
  rightOffset?: number;
  forwardOffset?: number;
  id?: string;
}) {
  const blockId = useMemo(() => `${id}:${anchorPeerId}`, [id, anchorPeerId]);
  const bodyId = useMemo(() => `tree:${blockId}`, [blockId]);

  // Trunk compound: oak / cellulose (already in catalog).
  const trunkColor = COMPOUND_TABLE.door_single.color;
  // Leaf "compound": chlorophyll-ish blend from real periodic-table elements.
  const leafColor = useMemo(
    () =>
      blendColor([
        { symbol: 'C', count: 55 },
        { symbol: 'H', count: 72 },
        { symbol: 'O', count: 5 },
        { symbol: 'N', count: 4 },
      ]),
    [],
  );

  // Place the block once via the BuilderBlockEngine. The engine owns
  // body registration, pinning, and cleanup. Render is delegated to
  // BuilderBlockView, which subscribes by bodyId.
  useEffect(() => {
    const engine = getBuilderBlockEngine();
    engine.placeBlock({
      id: blockId,
      kind: 'tree',
      anchorPeerId,
      rightOffset,
      forwardOffset,
      mass: 8,
      basin: 0.25,
      meta: { species: 'pine' },
    });
    return () => {
      engine.removeBlock(blockId, 'tree');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockId]);

  // Geometry — local frame: +Y is "up" (radial), -Z is forward.
  // Trunk: 0.4 m radius, 4 m tall. Canopy: stacked cones for a simple
  // pine-like silhouette so the test piece is unmistakable on Earth.
  const TRUNK_R = 0.4;
  const TRUNK_H = 4.0;
  return (
    <BuilderBlockView bodyId={bodyId}>
      {() => (
        <>
          {/* Trunk — cellulose (oak) */}
          <mesh position={[0, TRUNK_H / 2, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[TRUNK_R * 0.85, TRUNK_R, TRUNK_H, 12]} />
            <meshStandardMaterial color={trunkColor} roughness={0.92} />
          </mesh>
          {/* Canopy — three stacked cones, leaf-blend color */}
          <mesh position={[0, TRUNK_H + 0.6, 0]} castShadow>
            <coneGeometry args={[2.4, 2.4, 14]} />
            <meshStandardMaterial color={leafColor} roughness={0.8} />
          </mesh>
          <mesh position={[0, TRUNK_H + 1.9, 0]} castShadow>
            <coneGeometry args={[1.9, 2.0, 14]} />
            <meshStandardMaterial color={leafColor} roughness={0.8} />
          </mesh>
          <mesh position={[0, TRUNK_H + 3.0, 0]} castShadow>
            <coneGeometry args={[1.3, 1.6, 14]} />
            <meshStandardMaterial color={leafColor} roughness={0.8} />
          </mesh>
        </>
      )}
    </BuilderBlockView>
  );
}