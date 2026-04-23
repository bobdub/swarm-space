import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { getBuilderBlockEngine } from '@/lib/brain/builderBlockEngine';
import { BuilderBlockView } from '@/components/brain/builder/BuilderBlockView';
import { COMPOUND_TABLE, blendColor } from '@/lib/virtualHub/compoundCatalog';
import type { BuilderBlock } from '@/lib/brain/builderBlockEngine';

const WIDTH = 16;
const DEPTH = 12;
const HEIGHT = 3.2;
const FORWARD_OFFSET = 45;
const RIGHT_OFFSET = 30;

function WetWorkApartment({ block }: { block: BuilderBlock }) {
  void block;
  const membrane = useMemo(
    () => blendColor([{ symbol: 'C', count: 12 }, { symbol: 'H', count: 24 }, { symbol: 'O', count: 10 }, { symbol: 'N', count: 3 }]),
    [],
  );
  const sap = COMPOUND_TABLE.door_single.color;
  const bone = COMPOUND_TABLE.wall_half.color;
  const glass = COMPOUND_TABLE.window_wide.color;
  const water = COMPOUND_TABLE.window_square.color;
  const fruit = blendColor([{ symbol: 'K', count: 1 }, { symbol: 'Ca', count: 2 }, { symbol: 'O', count: 8 }, { symbol: 'C', count: 4 }]);
  // No per-frame deformation. The wet-work apartment is a *building*; any
  // visible scaling/tilting it did was being read as floor shake. Render
  // is now a pure read-only consumer of the BuilderBlockView transform.

  const chambers = [
    { key: 'living', pos: [-4.2, 0, -3.3], scale: [3.3, 2.2, 2.7] as [number, number, number] },
    { key: 'kitchen', pos: [4.2, 0, -3.3], scale: [3.1, 2.1, 2.5] as [number, number, number] },
    { key: 'bedroom', pos: [-4.2, 0, 3.3], scale: [3.2, 2.3, 2.8] as [number, number, number] },
    { key: 'bath', pos: [4.2, 0, 3.3], scale: [2.9, 2.0, 2.3] as [number, number, number] },
  ];
  const hallwayRibs = Array.from({ length: 8 }, (_, i) => -WIDTH / 2 + 1.5 + i * 1.9);

  return (
    <group>
      <mesh position={[0, -0.06, 0]} receiveShadow>
        <cylinderGeometry args={[9.4, 8.8, 0.18, 48]} />
        <meshStandardMaterial color={sap} roughness={0.95} />
      </mesh>

      <mesh position={[0, HEIGHT * 0.55, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.85, 1.25, HEIGHT * 1.2, 12]} />
        <meshStandardMaterial color={sap} roughness={0.88} />
      </mesh>
      <mesh position={[0, HEIGHT + 0.55, 0]} castShadow>
        <sphereGeometry args={[1.35, 20, 20]} />
        <meshStandardMaterial color={membrane} roughness={0.72} emissive={membrane} emissiveIntensity={0.18} />
      </mesh>

      {hallwayRibs.map((x, i) => (
        <group key={`rib-${i}`} position={[x, 0, 0]}>
          <mesh position={[0, HEIGHT * 0.55, -1.15]} rotation={[0, 0, -0.5]} castShadow>
            <capsuleGeometry args={[0.14, HEIGHT * 1.45, 5, 10]} />
            <meshStandardMaterial color={bone} roughness={0.86} />
          </mesh>
          <mesh position={[0, HEIGHT * 0.55, 1.15]} rotation={[0, 0, 0.5]} castShadow>
            <capsuleGeometry args={[0.14, HEIGHT * 1.45, 5, 10]} />
            <meshStandardMaterial color={bone} roughness={0.86} />
          </mesh>
          <mesh position={[0, HEIGHT * 1.15, 0]} scale={[1.4, 0.35, 1.1]} castShadow>
            <sphereGeometry args={[0.95, 18, 18]} />
            <meshStandardMaterial color={membrane} roughness={0.75} transparent opacity={0.72} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}

      {chambers.map((chamber) => (
        <group key={chamber.key} position={chamber.pos as [number, number, number]}>
          <mesh position={[0, 0.12, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
            <ringGeometry args={[1.8, Math.max(chamber.scale[0], chamber.scale[2]) + 0.3, 32]} />
            <meshStandardMaterial color={sap} roughness={0.92} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, chamber.scale[1] * 0.58 + 0.45, 0]} scale={chamber.scale} castShadow>
            <sphereGeometry args={[1, 26, 22, 0.55, Math.PI * 0.9, 0.1, Math.PI * 0.82]} />
            <meshPhysicalMaterial color={membrane} roughness={0.38} transmission={0.12} thickness={0.8} transparent opacity={0.7} side={THREE.DoubleSide} />
          </mesh>
          {[-1, 1].map((side) => (
            <mesh key={`${chamber.key}-root-${side}`} position={[side * (chamber.scale[0] - 0.5), chamber.scale[1] * 0.5, 0]} rotation={[0, 0, side * 0.45]} castShadow>
              <capsuleGeometry args={[0.18, HEIGHT * 1.2, 5, 10]} />
              <meshStandardMaterial color={bone} roughness={0.87} />
            </mesh>
          ))}
        </group>
      ))}

      <mesh position={[-4.1, 0.42, -3.2]} castShadow receiveShadow>
        <boxGeometry args={[2.8, 0.34, 1.8]} />
        <meshStandardMaterial color={bone} roughness={0.82} />
      </mesh>
      <mesh position={[4.2, 0.62, -3.4]} castShadow receiveShadow>
        <boxGeometry args={[3.4, 0.55, 1.2]} />
        <meshStandardMaterial color={sap} roughness={0.78} />
      </mesh>
      <mesh position={[4.15, 0.9, 2.95]} castShadow receiveShadow>
        <cylinderGeometry args={[1.15, 1.35, 0.65, 22]} />
        <meshStandardMaterial color={water} roughness={0.3} transparent opacity={0.72} emissive={water} emissiveIntensity={0.18} />
      </mesh>
      <mesh position={[-4.15, 0.4, 3.3]} castShadow receiveShadow>
        <boxGeometry args={[3.0, 0.26, 2.05]} />
        <meshStandardMaterial color={bone} roughness={0.7} />
      </mesh>

      {[[-6.5, 1.9, -5.1], [6.5, 2.0, -5.0], [-6.4, 2.0, 5.0], [6.3, 1.9, 5.1], [0, 2.8, 0]].map((pos, i) => (
        <group key={`lantern-${i}`} position={pos as [number, number, number]}>
          <mesh>
            <sphereGeometry args={[0.22, 18, 18]} />
            <meshStandardMaterial color={glass} emissive={glass} emissiveIntensity={1.8} transparent opacity={0.88} />
          </mesh>
          <pointLight intensity={i === 4 ? 9 : 5} distance={i === 4 ? 12 : 8} color={glass} />
        </group>
      ))}

      {[[-1.8, 0.75, -3.35], [1.7, 0.75, -3.35], [-1.6, 0.75, 3.35], [1.6, 0.75, 3.35]].map((pos, i) => (
        <mesh key={`fruit-${i}`} position={pos as [number, number, number]} castShadow>
          <sphereGeometry args={[0.22, 14, 14]} />
          <meshStandardMaterial color={fruit} roughness={0.48} emissive={fruit} emissiveIntensity={0.1} />
        </mesh>
      ))}
    </group>
  );
}

export function SurfaceApartmentV2({ anchorPeerId }: { anchorPeerId: string }) {
  const blockId = useMemo(() => `apartment-v2:${anchorPeerId}`, [anchorPeerId]);
  const bodyId = useMemo(() => `wetwork-apartment:${blockId}`, [blockId]);

  useEffect(() => {
    const engine = getBuilderBlockEngine();
    engine.placeBlock({
      id: blockId,
      kind: 'wetwork-apartment',
      anchorPeerId,
      rightOffset: RIGHT_OFFSET,
      forwardOffset: FORWARD_OFFSET,
      mass: 140,
      basin: 1.1,
      meta: {
        species: 'wet-work-apartment',
        width: WIDTH,
        depth: DEPTH,
        height: HEIGHT,
      },
    });
    return () => {
      engine.removeBlock(blockId, 'wetwork-apartment');
    };
  }, [anchorPeerId, blockId]);

  return (
    <BuilderBlockView bodyId={bodyId}>
      {(block) => <WetWorkApartment block={block} />}
    </BuilderBlockView>
  );
}
