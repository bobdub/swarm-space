import type { JSX } from "react";
import type { AvatarRenderProps, AvatarDefinition } from "../avatars";

function RabbitMesh({ scale = 1, color = "#f5f0e6" }: AvatarRenderProps): JSX.Element {
  return (
    <group scale={scale}>
      {/* Body */}
      <mesh position={[0, 0.45, 0]} castShadow>
        <sphereGeometry args={[0.45, 24, 24]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      {/* Head */}
      <mesh position={[0, 1.05, 0.05]} castShadow>
        <sphereGeometry args={[0.32, 24, 24]} />
        <meshStandardMaterial color={color} roughness={0.55} />
      </mesh>
      {/* Left ear */}
      <mesh position={[-0.14, 1.55, 0]} rotation={[0, 0, -0.08]} castShadow>
        <boxGeometry args={[0.08, 0.55, 0.06]} />
        <meshStandardMaterial color={color} roughness={0.55} />
      </mesh>
      {/* Right ear */}
      <mesh position={[0.14, 1.55, 0]} rotation={[0, 0, 0.08]} castShadow>
        <boxGeometry args={[0.08, 0.55, 0.06]} />
        <meshStandardMaterial color={color} roughness={0.55} />
      </mesh>
      {/* Tail */}
      <mesh position={[0, 0.5, -0.45]} castShadow>
        <sphereGeometry args={[0.1, 12, 12]} />
        <meshStandardMaterial color="#ffffff" roughness={0.4} />
      </mesh>
      {/* Eyes */}
      <mesh position={[-0.1, 1.1, 0.3]}>
        <sphereGeometry args={[0.04, 12, 12]} />
        <meshStandardMaterial color="#222" />
      </mesh>
      <mesh position={[0.1, 1.1, 0.3]}>
        <sphereGeometry args={[0.04, 12, 12]} />
        <meshStandardMaterial color="#222" />
      </mesh>
    </group>
  );
}

export const rabbitAvatar: AvatarDefinition = {
  id: "rabbit",
  name: "Rabbit",
  description: "A nimble paper rabbit. Quick on its feet, gentle in spirit.",
  unlocked: true,
  mass: 1.0,
  render: (props) => <RabbitMesh {...props} />,
  preview: (props) => <RabbitMesh {...props} />,
};