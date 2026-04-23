import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { BuilderBlockView } from '@/components/brain/builder/BuilderBlockView';
import { getBuilderBlockEngine, type BuilderBlock } from '@/lib/brain/builderBlockEngine';
import { seedDefaultBiome } from '@/lib/brain/nature/natureSeed';
import { seedMountains } from '@/lib/brain/nature/mountainSeed';
import { seedVolcanoes } from '@/lib/brain/nature/volcanoSeed';
import { NATURE_CATALOG, type NatureKind } from '@/lib/brain/nature/natureCatalog';
import {
  getVolcanoOrgan,
  SHARED_VOLCANO_ANCHOR_ID,
} from '@/lib/brain/volcanoOrgan';
import { EARTH_RADIUS, getEarthPose, quatRotate } from '@/lib/brain/earth';

/**
 * Phase 2 — NatureLayer
 *
 * Mounts on `/brain`, calls `seedDefaultBiome` once, then renders every
 * biome block through the BuilderBlockView contract. No behavior here:
 * pieces are static. Phase 3 (BiologyEngine) will animate / breed them.
 */
export function NatureLayer({ anchorPeerId }: { anchorPeerId: string }) {
  const engine = useMemo(() => getBuilderBlockEngine(), []);
  const [, force] = useState(0);

  useEffect(() => {
    seedDefaultBiome(anchorPeerId);
    // Phase 3 — Mountains: uplift at convergent plate seams near the
    // village anchor. Idempotent; safe to call alongside the biome seed.
    seedMountains(anchorPeerId);
    // Phase 4 — Volcanoes: deterministic vents at convergent seam
    // midpoints. They render the pressure the mantle releases instead of
    // letting that release leak into ground tremor.
    seedVolcanoes(anchorPeerId);
    // Re-render when blocks are added/removed/upgraded by anyone.
    const unsub = engine.subscribe(() => force((n) => (n + 1) & 0xfff));
    return unsub;
  }, [anchorPeerId, engine]);

  // Only render biome-tagged blocks — leaves room for one-off pieces
  // (SurfaceApartment, SurfaceTree) to keep their own renderers.
  const blocks = engine.listBlocks((b) => b.meta?.biome === 'nature.biome.v1');

  return (
    <>
      {blocks.map((b) => (
        <BuilderBlockView key={b.bodyId} bodyId={b.bodyId}>
          {(block) => <NaturePiece block={block} />}
        </BuilderBlockView>
      ))}
      {/* Single shared volcano overlay — crater glow, plume, and a soft
          point light. The CONE itself is Earth geometry now (vertex
          displacement in EarthBody). This overlay only adds the bits
          that belong above the crater. */}
      <VolcanoOverlay anchorPeerId={anchorPeerId} />
    </>
  );
}

/** Dispatch by kind. Geometry is intentionally minimal in Phase 2. */
function NaturePiece({ block }: { block: BuilderBlock }) {
  const kind = block.kind as NatureKind;
  const spec = NATURE_CATALOG[kind];
  const color = spec?.color ?? '#888';
  switch (kind) {
    case 'water': return <Water color={color} />;
    case 'grass': return <Grass color={color} />;
    case 'flower': return <Flower color={color} />;
    case 'tree': return <Tree color={color} />;
    case 'fish': return <Fish color={color} sex={(block.meta?.sex as string) ?? 'female'} />;
    case 'hive': return <Hive color={color} />;
    case 'queen_bee': return <Bee color={color} queen />;
    case 'bee': return <Bee color={color} />;
    case 'mountain': return <Mountain color={color} height={(block.meta?.height as number) ?? 12} />;
    default: return null;
  }
}

function Water({ color }: { color: string }) {
  return (
    <mesh position={[0, 0.02, 0]} receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[1.6, 18]} />
      <meshStandardMaterial color={color} roughness={0.2} metalness={0.1} transparent opacity={0.85} />
    </mesh>
  );
}

function Grass({ color }: { color: string }) {
  return (
    <mesh position={[0, 0.18, 0]} castShadow>
      <coneGeometry args={[0.08, 0.36, 5]} />
      <meshStandardMaterial color={color} roughness={0.9} />
    </mesh>
  );
}

function Flower({ color }: { color: string }) {
  return (
    <group>
      <mesh position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.4, 6]} />
        <meshStandardMaterial color="#3a8a3a" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.45, 0]} castShadow>
        <sphereGeometry args={[0.14, 10, 10]} />
        <meshStandardMaterial color={color} roughness={0.6} emissive={color} emissiveIntensity={0.2} />
      </mesh>
    </group>
  );
}

function Tree({ color }: { color: string }) {
  // Smaller, varied tree silhouette so the catalog tree reads as part of
  // a forest rather than competing with SurfaceTree's hero piece.
  const TR = 0.28, TH = 3.0;
  return (
    <group>
      <mesh position={[0, TH / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[TR * 0.8, TR, TH, 10]} />
        <meshStandardMaterial color="#6b4f2a" roughness={0.92} />
      </mesh>
      <mesh position={[0, TH + 0.8, 0]} castShadow>
        <coneGeometry args={[1.6, 2.2, 12]} />
        <meshStandardMaterial color={color} roughness={0.8} />
      </mesh>
      <mesh position={[0, TH + 2.0, 0]} castShadow>
        <coneGeometry args={[1.1, 1.6, 12]} />
        <meshStandardMaterial color={color} roughness={0.8} />
      </mesh>
    </group>
  );
}

function Fish({ color, sex }: { color: string; sex: string }) {
  const accent = sex === 'male' ? '#3b82f6' : '#f472b6';
  return (
    <group position={[0, 0.18, 0]} rotation={[0, 0, 0]}>
      <mesh castShadow>
        <sphereGeometry args={[0.18, 10, 8]} />
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.25} />
      </mesh>
      {/* tail */}
      <mesh position={[-0.22, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
        <coneGeometry args={[0.1, 0.18, 6]} />
        <meshStandardMaterial color={accent} roughness={0.5} />
      </mesh>
    </group>
  );
}

function Hive({ color }: { color: string }) {
  return (
    <group>
      <mesh position={[0, 0.4, 0]} castShadow>
        <cylinderGeometry args={[0.55, 0.7, 0.8, 12]} />
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.85, 0]} castShadow>
        <cylinderGeometry args={[0.4, 0.55, 0.3, 12]} />
        <meshStandardMaterial color={color} roughness={0.85} />
      </mesh>
      <mesh position={[0, 1.05, 0]} castShadow>
        <coneGeometry args={[0.4, 0.35, 12]} />
        <meshStandardMaterial color="#6b4f2a" roughness={0.9} />
      </mesh>
    </group>
  );
}

function Bee({ color, queen = false }: { color: string; queen?: boolean }) {
  const r = queen ? 0.14 : 0.09;
  return (
    <group position={[0, queen ? 0.5 : 0.3, 0]}>
      <mesh castShadow>
        <sphereGeometry args={[r, 8, 8]} />
        <meshStandardMaterial color={color} roughness={0.6} emissive={queen ? '#ffae00' : '#000'} emissiveIntensity={queen ? 0.25 : 0} />
      </mesh>
      {/* stripe */}
      <mesh position={[0, 0, 0]}>
        <torusGeometry args={[r * 0.95, r * 0.18, 6, 12]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.9} />
      </mesh>
    </group>
  );
}
function Mountain({ color, height }: { color: string; height: number }) {
  // Cone of rock with a snowy cap. Base radius scales with height so
  // tall mountains read as massive, not pencil-thin.
  const baseR = Math.max(2.5, height * 0.55);
  const capH = Math.max(1.0, height * 0.18);
  const capR = baseR * 0.35;
  const capY = height - capH * 0.5;
  return (
    <group>
      {/* main rock cone */}
      <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
        <coneGeometry args={[baseR, height, 14]} />
        <meshStandardMaterial color={color} roughness={0.95} />
      </mesh>
      {/* snow cap */}
      <mesh position={[0, capY, 0]} castShadow>
        <coneGeometry args={[capR, capH, 14]} />
        <meshStandardMaterial color="hsl(0, 0%, 92%)" roughness={0.6} />
      </mesh>
    </group>
  );
}

/**
 * Overlay anchored to the unified Volcano Organ. The cone itself is
 * Earth geometry (vertex displacement in `EarthBody`); this only renders
 * the bits that belong above the crater: a glowing vent, an ash plume,
 * and a warm point light. Position is recomputed per-frame from the live
 * Earth pose so the overlay rotates with the planet.
 */
function VolcanoOverlay({ anchorPeerId: _anchorPeerId }: { anchorPeerId: string }) {
  const groupRef = useRef<THREE.Group>(null);
  const organ = useMemo(() => getVolcanoOrgan(SHARED_VOLCANO_ANCHOR_ID), []);
  // Compute the local "up" tangent so the overlay points outward.
  useFrame(() => {
    if (!groupRef.current) return;
    const pose = getEarthPose();
    // Rotate Earth-local centre normal into world space.
    const worldN = quatRotate(pose.spinQuat, organ.centerNormal);
    // Peak of the displaced cone: visible ground + height.
    const peakR = EARTH_RADIUS + organ.height - organ.craterDepth * 0.5;
    const x = pose.center[0] + worldN[0] * peakR;
    const y = pose.center[1] + worldN[1] * peakR;
    const z = pose.center[2] + worldN[2] * peakR;
    groupRef.current.position.set(x, y, z);
    // Orient local +Y to align with the outward world normal.
    const up = new THREE.Vector3(worldN[0], worldN[1], worldN[2]);
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      up,
    );
    groupRef.current.quaternion.copy(q);
  });
  const craterR = organ.craterRadius;
  return (
    <group ref={groupRef}>
      {/* Glowing vent — sits inside the crater bowl. */}
      <mesh position={[0, 0.4, 0]}>
        <sphereGeometry args={[craterR * 0.55, 16, 12]} />
        <meshStandardMaterial
          color="hsl(18, 95%, 55%)"
          emissive="hsl(18, 95%, 55%)"
          emissiveIntensity={1.4}
        />
      </mesh>
      <pointLight position={[0, 1.2, 0]} intensity={8} distance={organ.baseRadius * 3} color="hsl(18, 95%, 55%)" />
      {/* Lazy ash plume — translucent cone stack. */}
      {[0, 1, 2].map((i) => (
        <mesh key={`plume-${i}`} position={[0, 2.5 + i * 2.4, 0]}>
          <coneGeometry args={[craterR * (1.1 + i * 0.5), 3.0, 12]} />
          <meshStandardMaterial
            color="hsl(0, 0%, 32%)"
            roughness={1}
            transparent
            opacity={0.32 - i * 0.08}
          />
        </mesh>
      ))}
    </group>
  );
}
