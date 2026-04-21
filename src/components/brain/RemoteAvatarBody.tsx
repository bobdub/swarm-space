import { useMemo } from 'react';

interface Props {
  position: [number, number, number];
  trust: number;
  label?: string;
}

export function RemoteAvatarBody({ position, trust, label }: Props) {
  const color = useMemo(() => `hsl(${(trust * 200) % 360}, 70%, 60%)`, [trust]);
  return (
    <group position={position}>
      <mesh castShadow position={[0, 0.6, 0]}>
        <capsuleGeometry args={[0.3, 0.8, 4, 8]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.3} />
      </mesh>
      {label && (
        <mesh position={[0, 1.5, 0]}>
          <planeGeometry args={[1.5, 0.3]} />
          <meshBasicMaterial color="hsl(245, 70%, 12%)" transparent opacity={0.6} />
        </mesh>
      )}
    </group>
  );
}