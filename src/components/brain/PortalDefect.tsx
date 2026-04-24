import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Text } from '@react-three/drei';

interface Props {
  position: [number, number, number];
  label: string;
}

export function PortalDefect({ position, label }: Props) {
  const ringRef = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ringRef.current) return;
    ringRef.current.rotation.z = clock.elapsedTime * 0.5;
  });
  return (
    <group position={position}>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.2, 0.1, 8, 32]} />
        <meshStandardMaterial
          color="hsl(180, 90%, 60%)"
          emissive="hsl(180, 90%, 60%)"
          emissiveIntensity={1.5}
        />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.0, 32]} />
        <meshBasicMaterial color="hsl(265, 90%, 30%)" transparent opacity={0.4} />
      </mesh>
      <pointLight color="hsl(180, 100%, 60%)" intensity={1.5} distance={6} />
      <Text
        position={[0, 1.8, 0]}
        fontSize={0.35}
        color="hsl(180, 90%, 80%)"
        anchorX="center"
        anchorY="middle"
      >
        {label}
      </Text>
    </group>
  );
}