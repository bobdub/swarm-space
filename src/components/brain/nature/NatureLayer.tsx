import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { BuilderBlockView } from '@/components/brain/builder/BuilderBlockView';
import { getBuilderBlockEngine, type BuilderBlock } from '@/lib/brain/builderBlockEngine';
import { seedDefaultBiome } from '@/lib/brain/nature/natureSeed';
import { seedMountains } from '@/lib/brain/nature/mountainSeed';
import { seedVolcanoes } from '@/lib/brain/nature/volcanoSeed';
import { NATURE_CATALOG, type NatureKind } from '@/lib/brain/nature/natureCatalog';

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
    case 'volcano': return <Volcano color={color} height={(block.meta?.height as number) ?? 18} />;
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

function Volcano({ color, height }: { color: string; height: number }) {
  // Real volcano: a magma shaft anchored deep in the mantle (negative
  // local Y, below the visible ground), rising as a glowing column up
  // through a basalt cone above the surface. The block is anchored at
  // the visible ground so local +Y points outward (sky) and -Y points
  // inward (mantle). The shaft makes the pressure release spatially
  // coherent with the mantle vent the field already writes.
  const baseR = Math.max(4.0, height * 0.75);
  const craterR = baseR * 0.34;
  const ventY = height * 0.96;
  const SHAFT_DEPTH = 12; // metres below visible ground
  return (
    <group>
      {/* Magma shaft — deep, narrow, emissive. Roots the cone in the
          mantle visually so the volcano reads as terrain, not a prop. */}
      <mesh position={[0, -SHAFT_DEPTH / 2, 0]}>
        <cylinderGeometry args={[craterR * 0.55, craterR * 0.85, SHAFT_DEPTH, 12]} />
        <meshStandardMaterial
          color="hsl(14, 95%, 45%)"
          emissive="hsl(14, 95%, 45%)"
          emissiveIntensity={0.9}
          roughness={0.7}
        />
      </mesh>
      {/* Shaft mouth at ground level — dark basalt rim around the magma. */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[craterR * 0.6, baseR * 0.55, 18]} />
        <meshStandardMaterial color="hsl(20, 25%, 12%)" roughness={1} side={THREE.DoubleSide} />
      </mesh>
      {/* main basalt cone */}
      <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
        <coneGeometry args={[baseR, height, 16]} />
        <meshStandardMaterial color={color} roughness={0.95} />
      </mesh>
      {/* crater rim — thin disc just below the vent glow */}
      <mesh position={[0, ventY, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[craterR * 0.6, craterR, 18]} />
        <meshStandardMaterial color="hsl(20, 70%, 18%)" roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      {/* glowing vent */}
      <mesh position={[0, ventY, 0]}>
        <sphereGeometry args={[craterR * 0.55, 16, 12]} />
        <meshStandardMaterial
          color="hsl(18, 95%, 55%)"
          emissive="hsl(18, 95%, 55%)"
          emissiveIntensity={1.4}
        />
      </mesh>
      <pointLight position={[0, ventY + 0.5, 0]} intensity={6} distance={baseR * 4} color="hsl(18, 95%, 55%)" />
      {/* lazy ash plume — translucent stack of cones, no animation */}
      {[0, 1, 2].map((i) => (
        <mesh key={`plume-${i}`} position={[0, ventY + 1.2 + i * 1.6, 0]}>
          <coneGeometry args={[craterR * (1.1 + i * 0.4), 2.0, 12]} />
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
