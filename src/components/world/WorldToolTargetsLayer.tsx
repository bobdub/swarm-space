import { useEffect, useMemo, useState } from 'react';
import { BuilderBlockView } from '@/components/brain/builder/BuilderBlockView';
import { getBuilderBlockEngine, type BuilderBlock } from '@/lib/brain/builderBlockEngine';
import { getHeldTool, subscribeHeldTool } from '@/lib/world/heldToolStore';
import { getToolTarget, setToolTarget, subscribeToolTarget } from '@/lib/world/toolTargetStore';
import type { ToolTarget } from '@/lib/world/toolTargets';
import { sampleSurfaceClass } from '@/lib/brain/surfaceClass';
import { getEarthPose, quatRotate, type Vec3 } from '@/lib/brain/earth';

function colliderFor(kind: string): [number, number, number] {
  switch (kind) {
    case 'tree':
      return [2.4, 5.8, 2.4];
    case 'water':
      return [3.6, 0.9, 3.6];
    case 'flower':
    case 'grass':
      return [1.2, 1.2, 1.2];
    case 'fish':
      return [1.1, 0.8, 1.1];
    case 'mountain':
      return [8, 14, 8];
    default:
      return [1.8, 1.8, 1.8];
  }
}

function labelFor(kind: string): string {
  return kind.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

export function WorldToolTargetsLayer() {
  const engine = useMemo(() => getBuilderBlockEngine(), []);
  const [version, force] = useState(0);
  const [held, setHeld] = useState(() => getHeldTool());
  const [target, setTarget] = useState<ToolTarget | null>(() => getToolTarget());

  useEffect(() => subscribeHeldTool(setHeld), []);
  useEffect(() => subscribeToolTarget(setTarget), []);
  useEffect(() => engine.subscribe(() => force((n) => (n + 1) & 0xfff)), [engine]);

  const blocks = useMemo(
    () => engine.listBlocks((block) => !String(block.id).startsWith('place:')),
    [engine, version],
  );

  if (!held) return null;

  return (
    <>
      {blocks.map((block) => (
        <NatureTarget key={block.bodyId} block={block} selected={target?.kind === 'nature' && target.blockId === block.bodyId} />
      ))}
      <SurfaceTarget selected={target?.kind === 'surface' ? target : null} />
    </>
  );
}

function NatureTarget({ block, selected }: { block: BuilderBlock; selected: boolean }) {
  const [w, h, d] = colliderFor(block.kind);
  const label = labelFor(block.kind);
  return (
    <BuilderBlockView bodyId={block.bodyId}>
      {() => (
        <group>
          <mesh
            position={[0, h / 2, 0]}
            onClick={(e) => {
              e.stopPropagation();
              setToolTarget(selected ? null : {
                kind: 'nature',
                id: block.bodyId,
                label,
                natureKind: block.kind,
                blockId: block.bodyId,
              });
            }}
          >
            <boxGeometry args={[w, h, d]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
          {selected && (
            <mesh position={[0, h / 2, 0]}>
              <boxGeometry args={[w + 0.08, h + 0.08, d + 0.08]} />
              <meshBasicMaterial color="white" wireframe transparent opacity={0.45} depthWrite={false} />
            </mesh>
          )}
        </group>
      )}
    </BuilderBlockView>
  );
}

function SurfaceTarget({ selected }: { selected: Extract<ToolTarget, { kind: 'surface' }> | null }) {
  const pose = getEarthPose();
  const radius = 150.05;

  return (
    <mesh
      position={[pose.center[0], pose.center[1], pose.center[2]]}
      onClick={(e) => {
        e.stopPropagation();
        const hit: Vec3 = [e.point.x, e.point.y, e.point.z];
        const dx = hit[0] - pose.center[0];
        const dy = hit[1] - pose.center[1];
        const dz = hit[2] - pose.center[2];
        const r = Math.hypot(dx, dy, dz) || 1;
        const local = quatRotate(pose.invSpinQuat, [dx / r, dy / r, dz / r]);
        const surfaceClass = sampleSurfaceClass(local);
        const surfaceKind = surfaceClass === 'ocean' || surfaceClass === 'shore' ? 'water' : 'ground';
        setToolTarget({
          kind: 'surface',
          id: `surface:${surfaceKind}:${hit.map((v) => v.toFixed(2)).join(':')}`,
          label: surfaceKind === 'water' ? 'Water surface' : 'Ground',
          surfaceKind,
          point: hit,
        });
      }}
    >
      <sphereGeometry args={[radius, 48, 32]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

export default WorldToolTargetsLayer;