import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';
import { BuilderBlockView } from '@/components/brain/builder/BuilderBlockView';
import { getBuilderBlockEngine, type BuilderBlock } from '@/lib/brain/builderBlockEngine';
import { getHeldTool, subscribeHeldTool } from '@/lib/world/heldToolStore';
import { getToolTarget, setToolTarget, subscribeToolTarget } from '@/lib/world/toolTargetStore';
import type { ToolTarget } from '@/lib/world/toolTargets';
import { sampleSurfaceClass } from '@/lib/brain/surfaceClass';
import { EARTH_RADIUS, getEarthPose, quatRotate, type Vec3 } from '@/lib/brain/earth';
import {
  digCellKeyFor,
  getCarvedDepth,
  hydrateCarvedCells,
  shellAtDepth,
} from '@/lib/world/carvedCellsStore';


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
      <SurfaceTarget selected={target?.kind === 'surface' || target?.kind === 'shell' ? target : null} />
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

function SurfaceTarget({ selected }: { selected: Extract<ToolTarget, { kind: 'surface' | 'shell' }> | null }) {
  const pose = getEarthPose();
  // The pick shell must sit ON the planet. It used to be a hard-coded
  // 150 m sphere — a pre-WORLD_SCALE leftover buried 1 550 m inside the
  // Earth, so ground clicks never resolved and digging was unreachable.
  const radius = EARTH_RADIUS + 0.05;

  return (
    <group>
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
          const isWater = surfaceClass === 'ocean' || surfaceClass === 'shore';
          if (isWater) {
            setToolTarget({
              kind: 'surface',
              id: `surface:water:${hit.map((v) => v.toFixed(2)).join(':')}`,
              label: 'Water surface',
              surfaceKind: 'water',
              point: hit,
            });
            return;
          }
          // Bare ground resolves all the way down to an Earth shell so the
          // sculpting predicate can answer "what am I digging through?".
          hydrateCarvedCells();
          const cellKey = digCellKeyFor(local);
          const depth = getCarvedDepth(cellKey);
          const shell = shellAtDepth(depth);
          setToolTarget({
            kind: 'shell',
            id: `shell:${cellKey}`,
            label: shell
              ? `${shell.label} (n=${shell.n}) · ${depth.toFixed(1)} m`
              : `Ground · ${depth.toFixed(1)} m`,
            point: hit,
            localNormal: local,
            cellKey,
            depth,
            shellId: shell?.id ?? 'grass',
          });
        }}
      >
        <sphereGeometry args={[radius, 96, 64]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.BackSide} />
      </mesh>
      {selected && (
        <group position={selected.point}>
          <mesh>
            <sphereGeometry args={[selected.kind === 'surface' ? 0.42 : 0.35, 18, 18]} />
            <meshBasicMaterial color="white" wireframe transparent opacity={0.55} depthWrite={false} />
          </mesh>
          <Html center distanceFactor={18} zIndexRange={[3, 0]}>
            <div className="pointer-events-none whitespace-nowrap rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-medium text-foreground shadow">
              {selected.label}
            </div>
          </Html>
        </group>
      )}
    </group>
  );
}



export default WorldToolTargetsLayer;