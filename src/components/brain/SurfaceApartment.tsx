import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  STRUCTURE_SHELL_RADIUS,
  BODY_SHELL_RADIUS,
  getEarthPose,
  anchorOnEarth,
} from '@/lib/brain/earth';
import { COMPOUND_TABLE } from '@/lib/virtualHub/compoundCatalog';

/**
 * Module-scope tracker shared with anyone listening on the
 * `brain:apartment-track` window event. Holds the most recent radial
 * measurement so the visible "floor vs feet" gap can be inspected from
 * the console or a HUD overlay.
 */
export const apartmentTrackerState: {
  apartmentRadius: number;
  feetRadius: number;
  gapM: number;
  worldPos: [number, number, number] | null;
  tickedAt: number;
  lastLog?: number;
} = {
  apartmentRadius: 0,
  feetRadius: 0,
  gapM: 0,
  worldPos: null,
  tickedAt: 0,
};

/**
 * A walkable Sims-style apartment built from real chemical compounds drawn
 * from the COMPOUND_TABLE shared with the Virtual Hub builder. Anchored on
 * the planet surface ~10 m in front of the player's spawn, oriented to the
 * local tangent frame so it stands upright wherever the player lands.
 *
 * Layout (top-down, X = right, Z = forward in the surface tangent plane):
 *
 *      +---------- 8m ---------+
 *      |  bedroom  | living    |  6m  (Z forward)
 *      |           | room      |
 *      +-----------+-----------+
 *           ^ entrance (oak door, front wall)
 *
 * Pure presentation: no physics colliders. Walls/floor/roof are static
 * meshes coloured by their constituent elements via blendColor().
 */
export function SurfaceApartment({ anchorPeerId }: { anchorPeerId: string }) {
  const groupRef = useRef<THREE.Group>(null);
  // Apartment sits 25 m "forward" of the village anchor, in the Earth-local
  // tangent plane. anchorOnEarth gives us the live world-space transform
  // that co-rotates with the planet, so the building stays glued to the
  // soil regardless of Earth's spin or orbit phase.
  const FORWARD_OFFSET = 25;
  const initial = useMemo(() => {
    const { worldPos, up, forward, right } = anchorOnEarth(
      anchorPeerId,
      0,
      FORWARD_OFFSET,
      STRUCTURE_SHELL_RADIUS,
    );
    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(right[0], right[1], right[2]),
      new THREE.Vector3(up[0], up[1], up[2]),
      new THREE.Vector3(forward[0], forward[1], forward[2]),
    );
    const euler = new THREE.Euler().setFromRotationMatrix(m);
    return { worldPos, euler };
  }, [anchorPeerId]);

  useFrame(() => {
    if (!groupRef.current) return;
    const pose = getEarthPose();
    const { worldPos, up, forward, right } = anchorOnEarth(
      anchorPeerId,
      0,
      FORWARD_OFFSET,
      STRUCTURE_SHELL_RADIUS,
      pose,
    );
    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(right[0], right[1], right[2]),
      new THREE.Vector3(up[0], up[1], up[2]),
      new THREE.Vector3(forward[0], forward[1], forward[2]),
    );
    groupRef.current.position.set(worldPos[0], worldPos[1], worldPos[2]);
    groupRef.current.setRotationFromMatrix(m);

    // ── Position tracking ────────────────────────────────────────────
    // Measure the radial gap between the apartment floor (the slab base
    // sits 0.05 m above the group origin → ground contact at the group
    // origin itself) and the local avatar's feet. Both should be at
    // exactly STRUCTURE_SHELL_RADIUS from the live Earth centre, so any
    // non-zero `gapM` here is the visible "floating / sinking" amount.
    const cx = pose.center[0];
    const cy = pose.center[1];
    const cz = pose.center[2];
    const apartmentRadius = Math.hypot(
      worldPos[0] - cx,
      worldPos[1] - cy,
      worldPos[2] - cz,
    );
    const expectedFeetRadius = BODY_SHELL_RADIUS - (BODY_SHELL_RADIUS - STRUCTURE_SHELL_RADIUS);
    const gapM = apartmentRadius - expectedFeetRadius;
    apartmentTrackerState.apartmentRadius = apartmentRadius;
    apartmentTrackerState.feetRadius = expectedFeetRadius;
    apartmentTrackerState.gapM = gapM;
    apartmentTrackerState.worldPos = [worldPos[0], worldPos[1], worldPos[2]];
    apartmentTrackerState.tickedAt = performance.now();
    if (typeof window !== 'undefined') {
      // Throttled console log — every ~1 s — so the user can read the
      // exact offset reported by the renderer.
      const now = performance.now();
      if (now - (apartmentTrackerState.lastLog ?? 0) > 1000) {
        apartmentTrackerState.lastLog = now;
        // eslint-disable-next-line no-console
        console.log('[Apartment.track]', {
          gapM: Number(gapM.toFixed(4)),
          apartmentRadius: Number(apartmentRadius.toFixed(3)),
          feetRadius: Number(expectedFeetRadius.toFixed(3)),
          structureShell: Number(STRUCTURE_SHELL_RADIUS.toFixed(3)),
          bodyShell: Number(BODY_SHELL_RADIUS.toFixed(3)),
        });
        window.dispatchEvent(
          new CustomEvent('brain:apartment-track', {
            detail: { ...apartmentTrackerState },
          }),
        );
      }
    }
  });

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
    <group ref={groupRef} position={initial.worldPos} rotation={[initial.euler.x, initial.euler.y, initial.euler.z]}>
      {/* Floor — concrete slab */}
      <mesh position={[0, 0.05, 0]} receiveShadow>
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
