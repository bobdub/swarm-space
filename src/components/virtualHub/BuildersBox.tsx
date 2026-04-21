import type { JSX } from "react";

export interface BuilderTool {
  id: string;
  render: () => JSX.Element;
}

interface BuildersBoxProps {
  tools?: BuilderTool[];
}

/**
 * Central placeholder structure inside the Virtual Hub.
 * Future builder tools register themselves via the `tools` prop and
 * render inside this group — no scene changes needed.
 */
export function BuildersBox({ tools = [] }: BuildersBoxProps) {
  return (
    <group position={[0, 0, 0]}>
      {/* Plinth */}
      <mesh position={[0, 0.25, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.6, 0.5, 1.6]} />
        <meshStandardMaterial color="#252947" roughness={0.6} />
      </mesh>
      {/* Glowing top */}
      <mesh position={[0, 0.51, 0]}>
        <boxGeometry args={[1.5, 0.02, 1.5]} />
        <meshStandardMaterial
          color="#2dd4bf"
          emissive="#2dd4bf"
          emissiveIntensity={0.4}
        />
      </mesh>
      {/* Floating crown — future tools go here */}
      <mesh position={[0, 1.1, 0]} castShadow>
        <octahedronGeometry args={[0.35, 0]} />
        <meshStandardMaterial
          color="#ec4899"
          emissive="#ec4899"
          emissiveIntensity={0.3}
          roughness={0.3}
        />
      </mesh>
      {/* Render registered tools */}
      <group position={[0, 0.6, 0]}>
        {tools.map((tool) => (
          <group key={tool.id}>{tool.render()}</group>
        ))}
      </group>
    </group>
  );
}