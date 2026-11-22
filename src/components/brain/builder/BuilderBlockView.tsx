import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getBuilderBlockEngine, type BuilderBlock } from '@/lib/brain/builderBlockEngine';
import { blockWorldBasis } from '@/lib/brain/blockFrame';


/**
 * BuilderBlockView — display-only renderer over a BuilderBlock.
 *
 * Contract:
 *   - The BuilderBlockEngine owns the block's world transform, derived
 *     each physics tick from its Earth-local anchor + offsets.
 *   - The engine writes a volumetric support basin into the UQRC field
 *     at that live world position. The basin (a co-moving region of
 *     local geometry) is what holds the block on the surface — there is
 *     no single-cell pin and no shell projection here.
 *   - This view subscribes by `bodyId`, recomputes the block's world
 *     transform each FRAME with `blockWorldPos` (same function the tick
 *     uses, evaluated at the frame-pinned Earth pose), and only derives
 *     an orthonormal basis for orientation. It must

 *     never mutate `field.axes`, `body.pos`, or pin templates.
 */
export function BuilderBlockView({
  bodyId,
  children,
}: {
  bodyId: string;
  children: (block: BuilderBlock) => ReactNode;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const engine = useMemo(() => getBuilderBlockEngine(), []);
  const [block, setBlock] = useState(() => engine.getBlock(bodyId) ?? null);
  // The engine upgrades blocks in place, so the event carries the same
  // object; bump a version so this view re-renders on its own block's
  // upgrades instead of relying on a parent re-render.
  const [, setVersion] = useState(0);

  useEffect(() => {
    setBlock(engine.getBlock(bodyId) ?? null);
    const unsub = engine.subscribe((evt) => {
      if (evt.block.bodyId !== bodyId) return;
      if (evt.type === 'remove') { setBlock(null); return; }
      setBlock(evt.block);
      setVersion((v) => (v + 1) & 0xfff);
    });
    return unsub;
  }, [engine, bodyId]);

  useFrame(() => {
    if (!groupRef.current || !block) return;
    // Render is read-only, and it reads the pose of THIS FRAME. The
    // engine's per-tick stamp of `body.pos` still owns the support basin
    // and every gameplay query; drawing from that stamp instead left the
    // block one frame behind the ground (~4 cm of orbital translation),
    // which read as objects jittering side to side.
    const { worldPos, m } = blockWorldBasis(block);
    groupRef.current.position.set(worldPos[0], worldPos[1], worldPos[2]);
    groupRef.current.setRotationFromMatrix(m);
  });

  if (!block) return null;
  return <group ref={groupRef}>{children(block)}</group>;
}