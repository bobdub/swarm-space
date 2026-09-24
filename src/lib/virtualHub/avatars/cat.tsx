import type { JSX } from "react";
import type { AvatarRenderProps, AvatarDefinition } from "../avatars";

function CatMesh({ scale = 1, color = "#6b7280" }: AvatarRenderProps): JSX.Element {
  const inner = "#f3b8c4";
  const dark = "#2f3440";
  return (
    <group scale={scale}>
      {/* Body */}
      <mesh position={[0, 0.5, -0.05]} rotation={[0.08, 0, 0]} castShadow>
        <capsuleGeometry args={[0.3, 0.42, 8, 18]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
      {/* Chest blaze */}
      <mesh position={[0, 0.52, 0.24]} castShadow>
        <sphereGeometry args={[0.15, 16, 16]} />
        <meshStandardMaterial color="#e8e6e1" roughness={0.75} />
      </mesh>
      {/* Head */}
      <mesh position={[0, 1.02, 0.08]} castShadow>
        <sphereGeometry args={[0.28, 22, 22]} />
        <meshStandardMaterial color={color} roughness={0.65} />
      </mesh>
      {/* Muzzle */}
      <mesh position={[0, 0.95, 0.3]} castShadow>
        <sphereGeometry args={[0.13, 16, 16]} />
        <meshStandardMaterial color="#e8e6e1" roughness={0.7} />
      </mesh>
      {/* Nose */}
      <mesh position={[0, 0.99, 0.41]}>
        <coneGeometry args={[0.035, 0.05, 8]} />
        <meshStandardMaterial color={inner} roughness={0.5} />
      </mesh>
      {/* Left ear */}
      <mesh position={[-0.15, 1.27, 0.04]} rotation={[0.1, 0, -0.18]} castShadow>
        <coneGeometry args={[0.1, 0.24, 4]} />
        <meshStandardMaterial color={color} roughness={0.65} flatShading />
      </mesh>
      <mesh position={[-0.15, 1.26, 0.07]} rotation={[0.1, 0, -0.18]}>
        <coneGeometry args={[0.055, 0.16, 4]} />
        <meshStandardMaterial color={inner} roughness={0.6} flatShading />
      </mesh>
      {/* Right ear */}
      <mesh position={[0.15, 1.27, 0.04]} rotation={[0.1, 0, 0.18]} castShadow>
        <coneGeometry args={[0.1, 0.24, 4]} />
        <meshStandardMaterial color={color} roughness={0.65} flatShading />
      </mesh>
      <mesh position={[0.15, 1.26, 0.07]} rotation={[0.1, 0, 0.18]}>
        <coneGeometry args={[0.055, 0.16, 4]} />
        <meshStandardMaterial color={inner} roughness={0.6} flatShading />
      </mesh>
      {/* Eyes — almond feline glow */}
      <mesh position={[-0.11, 1.07, 0.26]} scale={[1, 1.35, 1]}>
        <sphereGeometry args={[0.045, 14, 14]} />
        <meshStandardMaterial color="#8ee6a0" emissive="#34d399" emissiveIntensity={0.6} />
      </mesh>
      <mesh position={[0.11, 1.07, 0.26]} scale={[1, 1.35, 1]}>
        <sphereGeometry args={[0.045, 14, 14]} />
        <meshStandardMaterial color="#8ee6a0" emissive="#34d399" emissiveIntensity={0.6} />
      </mesh>
      {/* Pupils */}
      <mesh position={[-0.11, 1.07, 0.3]} scale={[0.5, 1.5, 0.5]}>
        <sphereGeometry args={[0.022, 10, 10]} />
        <meshStandardMaterial color={dark} />
      </mesh>
      <mesh position={[0.11, 1.07, 0.3]} scale={[0.5, 1.5, 0.5]}>
        <sphereGeometry args={[0.022, 10, 10]} />
        <meshStandardMaterial color={dark} />
      </mesh>
      {/* Front paws */}
      <mesh position={[-0.13, 0.12, 0.2]} castShadow>
        <sphereGeometry args={[0.09, 12, 12]} />
        <meshStandardMaterial color="#e8e6e1" roughness={0.8} />
      </mesh>
      <mesh position={[0.13, 0.12, 0.2]} castShadow>
        <sphereGeometry args={[0.09, 12, 12]} />
        <meshStandardMaterial color="#e8e6e1" roughness={0.8} />
      </mesh>
      {/* Hind paws */}
      <mesh position={[-0.15, 0.11, -0.2]} castShadow>
        <sphereGeometry args={[0.1, 12, 12]} />
        <meshStandardMaterial color={color} roughness={0.8} />
      </mesh>
      <mesh position={[0.15, 0.11, -0.2]} castShadow>
        <sphereGeometry args={[0.1, 12, 12]} />
        <meshStandardMaterial color={color} roughness={0.8} />
      </mesh>
      {/* Tail — curling upward */}
      <mesh position={[0, 0.48, -0.36]} rotation={[0.9, 0, 0]} castShadow>
        <capsuleGeometry args={[0.055, 0.34, 6, 12]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.82, -0.52]} rotation={[0.25, 0, 0]} castShadow>
        <capsuleGeometry args={[0.05, 0.3, 6, 12]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
      <mesh position={[0, 1.02, -0.47]} castShadow>
        <sphereGeometry args={[0.055, 12, 12]} />
        <meshStandardMaterial color="#e8e6e1" roughness={0.7} />
      </mesh>
    </group>
  );
}

export const catAvatar: AvatarDefinition = {
  id: "cat",
  name: "Cat",
  description: "An agile, curious feline. Swift footing and a sleek sense of balance.",
  unlocked: true,
  mass: 1.2,
  render: (props) => <CatMesh {...props} />,
  preview: (props) => <CatMesh {...props} />,
};
