import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { COMPOUND_TABLE } from '@/lib/virtualHub/compoundCatalog';
import { getBuilderBlockEngine } from '@/lib/brain/builderBlockEngine';
import { BuilderBlockView } from '@/components/brain/builder/BuilderBlockView';

/**
 * Module-scope tracker consumed by the `?debug=physics` HUD
 * (BrainUniverseScene). Holds the most recent radial measurement so the
 * visible "floor vs feet" gap can be inspected at a glance.
 */
export const apartmentTrackerState: {
  apartmentRadius: number;
  feetRadius: number;
  gapM: number;
  worldPos: [number, number, number] | null;
  tickedAt: number;
  shellOffset: number;
} = {
  apartmentRadius: 0,
  feetRadius: 0,
  gapM: 0,
  worldPos: null,
  tickedAt: 0,
  shellOffset: 0,
};

/**
 * REFERENCE STRUCTURE — SurfaceApartment
 * ──────────────────────────────────────
 * Status: **Mostly stable**. No drift; locked to a UQRC physics body and
 * the shared Earth-local site frame. Render is a read-only consumer of
 * physics state — this is the canonical contract every future
 * builder-placed item should follow.
 *
 * Known bugs (intentionally open, do not silently "fix" without a plan):
 *   1. Scale/sizing is not calibrated to avatar metrics. Walls, doors,
 *      and rooms read roughly correct but were not derived from
 *      BODY_CENTER_HEIGHT or any humanoid scale constant.
 *   2. No collider. Earth's orbit/spin "breathes" the visible ground
 *      shell up and down through the static floor slab. The apartment
 *      itself is locked to the feet shell, so the artifact is the
 *      ground passing through the floor — not the floor moving.
 *
 * Usage as a template for future builder items:
 *   - Register a `'piece'` body with the UQRC physics engine on mount,
 *     pin a small curvature basin via `physics.pinPiece`, unregister on
 *     unmount.
 *   - Build pose from the SHARED `getEarthLocalSiteFrame(anchorPeerId)`
 *     so all viewers see it in the same world-space spot.
 *   - In `useFrame`, READ the body pose from physics (`getBody`) only.
 *   - Derive orientation from the live radial up + the spawn tangent
 *     frame, re-orthonormalized — never from a stored Euler.
 *
 * Layout (top-down, X = right, Z = forward in the surface tangent plane):
 *
 *      +---------- 8m ---------+
 *      |  bedroom  | living    |  6m  (Z forward)
 *      |           | room      |
 *      +-----------+-----------+
 *           ^ entrance (oak door, front wall)
 */
export function SurfaceApartment({ anchorPeerId }: { anchorPeerId: string }) {
  const bodyId = useMemo(() => `apartment:${anchorPeerId}`, [anchorPeerId]);
  // ─── Engine ownership ───────────────────────────────────────────
  // The apartment is now a first-class BuilderBlock. The engine owns
  // its Earth-local anchor + tangent offsets, recomputes its world
  // transform every physics tick, and stamps a volumetric support
  // basin into the field at that live world position. There is no
  // direct addBody / pinPiece here, and no per-frame shell projection.
  useEffect(() => {
    const engine = getBuilderBlockEngine();
    engine.placeBlock({
      id: anchorPeerId,
      kind: 'apartment',
      anchorPeerId,
      forwardOffset: 25,
      rightOffset: 0,
      mass: 50,
      basin: 6.0,
      meta: { species: 'apartment' },
    });
    return () => { engine.removeBlock(anchorPeerId, 'apartment'); };
  }, [anchorPeerId]);

  // Pull real compound colors from the shared catalog.
  const C = COMPOUND_TABLE;
  const concrete = C.floor_4.color;
  const limestone = C.wall_long.color;
  const adobe = C.wall_short.color;
  const gypsum = C.wall_half.color;
  const oak = C.door_single.color;
  const steel = C.door_double.color;
  const sodaGlass = C.window_square.color;
  const boroGlass = C.window_wide.color;
  const terracotta = C.roof_gable.color;

  // Apartment dimensions (metres).
  const W = 8;       // east-west span
  const D = 6;       // north-south span
  const H = 2.6;     // wall height
  const T = 0.18;    // wall thickness

  return (
    <BuilderBlockView bodyId={`apartment:${anchorPeerId}`}>
      {() => (
        <group>
      {/* Floor — concrete slab. Top face sits at local y=0 so it is
          coplanar with the avatar's feet shell. */}
      <mesh position={[0, -0.05, 0]} receiveShadow>
        <boxGeometry args={[W, 0.1, D]} />
        <meshStandardMaterial color={concrete} roughness={0.92} />
      </mesh>

      {/* Back wall (north, +Z) — limestone, solid */}
      <mesh position={[0, H / 2, D / 2]} castShadow receiveShadow>
        <boxGeometry args={[W, H, T]} />
        <meshStandardMaterial color={limestone} roughness={0.85} />
      </mesh>

      {/* Front wall (south, -Z) — limestone with a doorway and two window cutouts.
          Build it as four segments so the player can walk in. */}
      {/* Left of door */}
      <mesh position={[-2.5, H / 2, -D / 2]} castShadow receiveShadow>
        <boxGeometry args={[3, H, T]} />
        <meshStandardMaterial color={limestone} roughness={0.85} />
      </mesh>
      {/* Right of door (with window opening above + below split) */}
      <mesh position={[2.5, H / 2, -D / 2]} castShadow receiveShadow>
        <boxGeometry args={[3, H, T]} />
        <meshStandardMaterial color={limestone} roughness={0.85} />
      </mesh>
      {/* Lintel above door */}
      <mesh position={[0, H - 0.3, -D / 2]} castShadow receiveShadow>
        <boxGeometry args={[2, 0.6, T]} />
        <meshStandardMaterial color={limestone} roughness={0.85} />
      </mesh>

      {/* East wall (right, +X) — limestone with a wide window slot */}
      <mesh position={[W / 2, 0.6, -1.5]} castShadow receiveShadow>
        <boxGeometry args={[T, 1.2, 3]} />
        <meshStandardMaterial color={limestone} roughness={0.85} />
      </mesh>
      <mesh position={[W / 2, 2.2, -1.5]} castShadow receiveShadow>
        <boxGeometry args={[T, 0.8, 3]} />
        <meshStandardMaterial color={limestone} roughness={0.85} />
      </mesh>
      <mesh position={[W / 2, H / 2, 1.5]} castShadow receiveShadow>
        <boxGeometry args={[T, H, 3]} />
        <meshStandardMaterial color={limestone} roughness={0.85} />
      </mesh>
      {/* Soda-lime window in the east wall slot */}
      <mesh position={[W / 2, 1.4, -1.5]}>
        <boxGeometry args={[T * 0.4, 0.8, 3]} />
        <meshStandardMaterial
          color={sodaGlass}
          roughness={0.1}
          metalness={0.2}
          transparent
          opacity={0.45}
          emissive={sodaGlass}
          emissiveIntensity={0.15}
        />
      </mesh>

      {/* West wall (left, -X) — limestone, solid */}
      <mesh position={[-W / 2, H / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[T, H, D]} />
        <meshStandardMaterial color={limestone} roughness={0.85} />
      </mesh>

      {/* Interior partition (adobe) splitting the room into bedroom + living */}
      <mesh position={[0, H / 2, -1.2]} castShadow receiveShadow>
        <boxGeometry args={[T, H, 3.6]} />
        <meshStandardMaterial color={adobe} roughness={0.95} />
      </mesh>
      {/* Steel interior door frame stub (the "door" itself is just a slab) */}
      <mesh position={[0, 1.0, 1.2]} castShadow>
        <boxGeometry args={[0.9, 2.0, T * 0.6]} />
        <meshStandardMaterial color={steel} roughness={0.4} metalness={0.7} />
      </mesh>

      {/* Oak entrance door — slightly ajar so the entrance reads as an opening */}
      <group position={[0.6, 1.05, -D / 2 + T * 0.6]} rotation={[0, -0.35, 0]}>
        <mesh castShadow>
          <boxGeometry args={[1.4, 2.1, 0.06]} />
          <meshStandardMaterial color={oak} roughness={0.6} />
        </mesh>
        {/* steel handle */}
        <mesh position={[0.55, 0, 0.05]}>
          <sphereGeometry args={[0.06, 12, 12]} />
          <meshStandardMaterial color={steel} metalness={0.9} roughness={0.2} />
        </mesh>
      </group>

      {/* Roof — flat ceiling slab + gable terracotta peak */}
      <mesh position={[0, H + 0.05, 0]} castShadow receiveShadow>
        <boxGeometry args={[W + 0.4, 0.1, D + 0.4]} />
        <meshStandardMaterial color={gypsum} roughness={0.9} />
      </mesh>
      {/* Gable roof — two angled boxes meeting at the ridge */}
      <mesh position={[0, H + 0.9, -1.5]} rotation={[0.55, 0, 0]} castShadow>
        <boxGeometry args={[W + 0.4, 0.15, 4]} />
        <meshStandardMaterial color={terracotta} roughness={0.8} />
      </mesh>
      <mesh position={[0, H + 0.9, 1.5]} rotation={[-0.55, 0, 0]} castShadow>
        <boxGeometry args={[W + 0.4, 0.15, 4]} />
        <meshStandardMaterial color={terracotta} roughness={0.8} />
      </mesh>

      {/* ── Furniture (real elements) ── */}

      {/* Bedroom (left half, x < 0): gypsum bed platform + oak headboard */}
      <mesh position={[-2.4, 0.35, 1.4]} castShadow receiveShadow>
        <boxGeometry args={[2.0, 0.5, 1.4]} />
        <meshStandardMaterial color={gypsum} roughness={0.9} />
      </mesh>
      <mesh position={[-2.4, 0.95, 2.05]} castShadow>
        <boxGeometry args={[2.0, 1.2, 0.1]} />
        <meshStandardMaterial color={oak} roughness={0.55} />
      </mesh>
      {/* Bedside steel lamp */}
      <mesh position={[-1.1, 0.7, 1.6]} castShadow>
        <cylinderGeometry args={[0.08, 0.12, 1.4, 12]} />
        <meshStandardMaterial color={steel} metalness={0.85} roughness={0.25} />
      </mesh>
      <mesh position={[-1.1, 1.5, 1.6]}>
        <sphereGeometry args={[0.18, 16, 16]} />
        <meshStandardMaterial
          color={boroGlass}
          emissive={boroGlass}
          emissiveIntensity={1.5}
          transparent
          opacity={0.85}
        />
      </mesh>
      <pointLight position={[-1.1, 1.5, 1.6]} intensity={6} distance={6} color={boroGlass} />

      {/* Living room (right half, x > 0): oak coffee table + gypsum sofa block */}
      <mesh position={[2.2, 0.4, -0.6]} castShadow receiveShadow>
        <boxGeometry args={[2.4, 0.8, 0.9]} />
        <meshStandardMaterial color={gypsum} roughness={0.9} />
      </mesh>
      <mesh position={[2.2, 0.9, -0.18]} castShadow>
        <boxGeometry args={[2.4, 0.6, 0.2]} />
        <meshStandardMaterial color={gypsum} roughness={0.9} />
      </mesh>
      {/* Oak coffee table */}
      <mesh position={[2.2, 0.45, 0.9]} castShadow receiveShadow>
        <boxGeometry args={[1.2, 0.08, 0.7]} />
        <meshStandardMaterial color={oak} roughness={0.5} />
      </mesh>
      {[
        [-0.55, -0.32], [0.55, -0.32], [-0.55, 0.32], [0.55, 0.32],
      ].map(([dx, dz], i) => (
        <mesh key={i} position={[2.2 + dx, 0.21, 0.9 + dz]}>
          <cylinderGeometry args={[0.04, 0.04, 0.42, 8]} />
          <meshStandardMaterial color={oak} roughness={0.55} />
        </mesh>
      ))}

      {/* Borosilicate skylight on the gable peak */}
      <mesh position={[0, H + 1.5, 0]}>
        <boxGeometry args={[1.6, 0.08, 1.6]} />
        <meshStandardMaterial
          color={boroGlass}
          transparent
          opacity={0.55}
          emissive={boroGlass}
          emissiveIntensity={0.4}
        />
      </mesh>

      {/* Welcome marker — a glowing borosilicate lantern at the doorstep */}
      <mesh position={[0, 0.4, -D / 2 - 1.2]} castShadow>
        <cylinderGeometry args={[0.12, 0.18, 0.8, 12]} />
        <meshStandardMaterial color={steel} metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.95, -D / 2 - 1.2]}>
        <sphereGeometry args={[0.22, 16, 16]} />
        <meshStandardMaterial
          color={boroGlass}
          emissive={boroGlass}
          emissiveIntensity={2.0}
          transparent
          opacity={0.85}
        />
      </mesh>
      <pointLight position={[0, 1.0, -D / 2 - 1.2]} intensity={8} distance={8} color={boroGlass} />
    </group>
  );
}
