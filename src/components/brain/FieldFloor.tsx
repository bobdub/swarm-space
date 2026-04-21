import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { curvatureSliceY } from '@/lib/uqrc/field3D';
import type { UqrcPhysics } from '@/lib/brain/uqrcPhysics';
import { WORLD_SIZE } from '@/lib/brain/uqrcPhysics';

const RES = 32;

interface Props {
  physics: UqrcPhysics;
}

/**
 * 32×32 plane whose vertex Y and emissive intensity are sampled live
 * from ‖F_{μν}‖ on the brain field. Updated every ~6 frames.
 */
export function FieldFloor({ physics }: Props) {
  const meshRef = useRef<THREE.Mesh>(null);
  const tick = useRef(0);

  const { geometry, material } = useMemo(() => {
    const g = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, RES - 1, RES - 1);
    g.rotateX(-Math.PI / 2);
    const colors = new Float32Array(RES * RES * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const m = new THREE.MeshStandardMaterial({
      vertexColors: true,
      emissive: new THREE.Color('hsl(265, 80%, 25%)'),
      emissiveIntensity: 0.6,
      roughness: 0.7,
      metalness: 0.1,
      wireframe: false,
    });
    return { geometry: g, material: m };
  }, []);

  useFrame(() => {
    tick.current = (tick.current + 1) % 6;
    if (tick.current !== 0) return;
    // Sample Y=middle slice of the field
    const slice = curvatureSliceY(physics.getField(), 12, RES);
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const col = geometry.attributes.color as THREE.BufferAttribute;
    for (let i = 0; i < RES * RES; i++) {
      const c = Math.min(1.5, slice[i]);
      pos.setY(i, c * 0.4);
      // teal → magenta tint based on curvature
      const r = 0.05 + c * 0.4;
      const g = 0.4 + c * 0.3;
      const b = 0.7 - c * 0.2;
      col.setXYZ(i, r, g, b);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    geometry.computeVertexNormals();
  });

  return (
    <mesh ref={meshRef} geometry={geometry} material={material} receiveShadow />
  );
}