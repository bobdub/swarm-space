import type { JSX } from "react";
import type { AvatarRenderProps, AvatarDefinition } from "../avatars";

function DragonMesh({ scale = 1, color = "#7c2d12" }: AvatarRenderProps): JSX.Element {
  const wing = "#4a1a0a";
  return (
    <group scale={scale * 1.4}>
      {/* Body */}
      <mesh position={[0, 0.55, 0]} castShadow>
        <capsuleGeometry args={[0.42, 0.7, 8, 16]} />
        <meshStandardMaterial color={color} roughness={0.45} />
      </mesh>
      {/* Head */}
      <mesh position={[0, 1.25, 0.25]} castShadow>
        <sphereGeometry args={[0.32, 20, 20]} />
        <meshStandardMaterial color={color} roughness={0.4} />
      </mesh>
      {/* Snout */}
      <mesh position={[0, 1.18, 0.55]} castShadow>
        <boxGeometry args={[0.22, 0.18, 0.28]} />
        <meshStandardMaterial color={color} roughness={0.5} />
      </mesh>
      {/* Horns */}
      <mesh position={[-0.14, 1.5, 0.18]} rotation={[0.2, 0, -0.3]}>
        <coneGeometry args={[0.05, 0.25, 8]} />
        <meshStandardMaterial color="#1a0a05" roughness={0.6} />
      </mesh>
      <mesh position={[0.14, 1.5, 0.18]} rotation={[0.2, 0, 0.3]}>
        <coneGeometry args={[0.05, 0.25, 8]} />
        <meshStandardMaterial color="#1a0a05" roughness={0.6} />
      </mesh>
      {/* Eyes */}
      <mesh position={[-0.12, 1.28, 0.5]}>
        <sphereGeometry args={[0.045, 12, 12]} />
        <meshStandardMaterial color="#fbbf24" emissive="#f59e0b" emissiveIntensity={0.8} />
      </mesh>
      <mesh position={[0.12, 1.28, 0.5]}>
        <sphereGeometry args={[0.045, 12, 12]} />
        <meshStandardMaterial color="#fbbf24" emissive="#f59e0b" emissiveIntensity={0.8} />
      </mesh>
      {/* Left wing */}
      <mesh position={[-0.55, 0.85, -0.05]} rotation={[0, 0.2, 0.6]} castShadow>
        <boxGeometry args={[0.7, 0.02, 0.55]} />
        <meshStandardMaterial color={wing} roughness={0.7} />
      </mesh>
      {/* Right wing */}
      <mesh position={[0.55, 0.85, -0.05]} rotation={[0, -0.2, -0.6]} castShadow>
        <boxGeometry args={[0.7, 0.02, 0.55]} />
        <meshStandardMaterial color={wing} roughness={0.7} />
      </mesh>
      {/* Tail */}
      <mesh position={[0, 0.45, -0.6]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <coneGeometry args={[0.16, 0.85, 12]} />
        <meshStandardMaterial color={color} roughness={0.5} />
      </mesh>
    </group>
  );
}

export const dragonAvatar: AvatarDefinition = {
  id: "dragon",
  name: "Dragon",
  description: "A heavier, deliberate dragon. More mass, more presence.",
  unlocked: true,
  mass: 2.6,
  render: (props) => <DragonMesh {...props} />,
  preview: (props) => <DragonMesh {...props} />,
};