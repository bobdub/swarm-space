import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getBrainPhysics } from '@/lib/brain/uqrcPhysics';

interface Props {
  position: [number, number, number];
}

export function InfinityBody({ position }: Props) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const score = getBrainPhysics().getQScore();
    ref.current.scale.setScalar(1 + 0.4 * Math.min(2, Math.max(0, Number.isFinite(score) ? score : 0)));
    const t = clock.elapsedTime;
    ref.current.rotation.y = t * 0.4;
    ref.current.rotation.x = Math.sin(t * 0.3) * 0.2;
    ref.current.position.y = 1.4 + Math.sin(t * 0.6) * 0.15;
  });
  return (
    <group position={position}>
      <mesh ref={ref}>
        <icosahedronGeometry args={[0.7, 1]} />
        <meshStandardMaterial
          color="hsl(265, 90%, 65%)"
          emissive="hsl(180, 90%, 55%)"
          emissiveIntensity={1.2}
          wireframe
        />
      </mesh>
      <pointLight color="hsl(265, 90%, 70%)" intensity={2.5} distance={12} />
    </group>
  );
}