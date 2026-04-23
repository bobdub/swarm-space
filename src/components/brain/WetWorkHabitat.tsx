import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { BuilderBlockView } from '@/components/brain/builder/BuilderBlockView';
import { COMPOUND_TABLE, blendColor } from '@/lib/virtualHub/compoundCatalog';
import {
  growWetWorkHabitat,
  removeWetWorkHabitat,
  listHabitatBlocks,
} from '@/lib/brain/wetWorkGrowth';
import { getBuilderBlockEngine, type BuilderBlock } from '@/lib/brain/builderBlockEngine';

/**
 * WetWorkHabitat — renders one mesh per grown builder block. The engine
 * owns placement; this component only subscribes to the block list and
 * draws the appropriate organic geometry per node kind. Each block sits
 * at its own world position (computed by the engine), so the habitat is a
 * field of bodies rather than a single decorative mesh.
 */
function nodeMesh(block: BuilderBlock) {
  const kind = String(block.meta?.nodeKind ?? '');
  const scale = Number(block.meta?.scale ?? 1);
  const sap = COMPOUND_TABLE.door_single.color;
  const bone = COMPOUND_TABLE.wall_half.color;
  const glass = COMPOUND_TABLE.window_wide.color;
  const membrane = blendColor([
    { symbol: 'C', count: 12 }, { symbol: 'H', count: 24 },
    { symbol: 'O', count: 10 }, { symbol: 'N', count: 3 },
  ]);

  if (kind === 'trunk') {
    return (
      <group>
        <mesh position={[0, 1.4 * scale, 0]} castShadow>
          <cylinderGeometry args={[0.7 * scale, 1.0 * scale, 2.8 * scale, 14]} />
          <meshStandardMaterial color={sap} roughness={0.85} />
        </mesh>
        <mesh position={[0, 3.0 * scale, 0]}>
          <sphereGeometry args={[1.2 * scale, 18, 18]} />
          <meshStandardMaterial color={membrane} roughness={0.7} emissive={membrane} emissiveIntensity={0.18} />
        </mesh>
        <pointLight intensity={6} distance={10} color={glass} position={[0, 2.6 * scale, 0]} />
      </group>
    );
  }
  if (kind === 'root') {
    return (
      <mesh position={[0, 0.2 * scale, 0]} rotation={[0, 0, 0.4]} castShadow>
        <capsuleGeometry args={[0.25 * scale, 1.6 * scale, 5, 10]} />
        <meshStandardMaterial color={sap} roughness={0.92} />
      </mesh>
    );
  }
  if (kind === 'rib') {
    return (
      <mesh position={[0, 1.2 * scale, 0]} rotation={[0, 0, 0.2]} castShadow>
        <capsuleGeometry args={[0.15 * scale, 2.2 * scale, 5, 10]} />
        <meshStandardMaterial color={bone} roughness={0.85} />
      </mesh>
    );
  }
  if (kind === 'chamber') {
    return (
      <group>
        <mesh position={[0, 1.0 * scale, 0]} castShadow receiveShadow>
          <sphereGeometry args={[1.4 * scale, 22, 18]} />
          <meshPhysicalMaterial
            color={membrane}
            roughness={0.4}
            transmission={0.15}
            thickness={0.6}
            transparent
            opacity={0.72}
            side={THREE.DoubleSide}
          />
        </mesh>
        <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <ringGeometry args={[0.4, 1.5 * scale, 24]} />
          <meshStandardMaterial color={sap} roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
      </group>
    );
  }
  // corridor — open tube marker (low geometry footprint)
  return (
    <mesh position={[0, 0.8, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[0.5, 0.12, 10, 18]} />
      <meshStandardMaterial color={bone} roughness={0.7} transparent opacity={0.6} />
    </mesh>
  );
}

export function WetWorkHabitat({ anchorPeerId }: { anchorPeerId: string }) {
  const habitatId = useMemo(() => `wet-work:${anchorPeerId}`, [anchorPeerId]);
  const [blocks, setBlocks] = useState<BuilderBlock[]>([]);

  useEffect(() => {
    growWetWorkHabitat({ habitatId, anchorPeerId });
    setBlocks(listHabitatBlocks(habitatId));
    const engine = getBuilderBlockEngine();
    const unsub = engine.subscribe(() => {
      setBlocks(listHabitatBlocks(habitatId));
    });
    return () => {
      unsub();
      removeWetWorkHabitat(habitatId);
    };
  }, [habitatId, anchorPeerId]);

  return (
    <>
      {blocks.map((block) => (
        <BuilderBlockView key={block.bodyId} bodyId={block.bodyId}>
          {(b) => nodeMesh(b)}
        </BuilderBlockView>
      ))}
    </>
  );
}
