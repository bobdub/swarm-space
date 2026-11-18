import type { JSX } from "react";
import type { AvatarRenderProps, AvatarDefinition } from "../avatars";

/**
 * Tail spine in the cat's local space (y up, z forward). The first point
 * sits inside the rump so the tail grows out of the body, and every
 * segment starts exactly where the previous one ended, so the capsules'
 * rounded caps overlap at each joint and leave no gaps.
 */
const TAIL_POINTS: [number, number, number][] = [
  [0, 0.34, -0.26],
  [0, 0.36, -0.46],
  [0, 0.52, -0.6],
  [0, 0.76, -0.62],
  [0, 0.95, -0.53],
];
const TAIL_RADII = [0.06, 0.056, 0.052, 0.05];

/**
 * A capsule is built along +Y. Rotating it by `tilt` about X points it
 * along (0, cos tilt, sin tilt), so tilt = atan2(dz, dy) aims it from
 * one spine point to the next.
 */
const TAIL_SEGMENTS = TAIL_POINTS.slice(0, -1).map((a, i) => {
  const b = TAIL_POINTS[i + 1];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  return {
    position: [0, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2] as [number, number, number],
    tilt: Math.atan2(dz, dy),
    length: Math.hypot(dy, dz),
    radius: TAIL_RADII[i],
  };
});
const TAIL_TIP = TAIL_POINTS[TAIL_POINTS.length - 1];

function CatMesh({ scale = 1, color = "#6b7280" }: AvatarRenderProps): JSX.Element {
  const inner = "#f3b8c4";
  const dark = "#2f3440";
  return (
    <group scale={scale}>
      {/* Body */}
      <mesh position={[0, 0.5, -0.05]} rotation={[0.08, 0, 0]} castShadow>
        <capsuleGeometry args={[0.3, 0.42, 12, 32]} />
        <meshPhysicalMaterial color={color} roughness={0.45} sheen={0.25} sheenColor={color} sheenRoughness={0.7} />
      </mesh>
      {/* Chest blaze */}
      <mesh position={[0, 0.52, 0.24]} castShadow>
        <sphereGeometry args={[0.15, 24, 20]} />
        <meshStandardMaterial color="#e8e6e1" roughness={0.55} />
      </mesh>
      {/* Head */}
      <mesh position={[0, 1.02, 0.08]} castShadow>
        <sphereGeometry args={[0.28, 32, 24]} />
        <meshPhysicalMaterial color={color} roughness={0.45} sheen={0.25} sheenColor={color} sheenRoughness={0.7} />
      </mesh>
      {/* Muzzle */}
      <mesh position={[0, 0.95, 0.3]} castShadow>
        <sphereGeometry args={[0.13, 24, 20]} />
        <meshStandardMaterial color="#e8e6e1" roughness={0.55} />
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
      {/* Layer the eyes in front of the head, not inside its surface. */}
      {[-0.11, 0.11].map((x) => (
        <group key={x} position={[x, 1.1, 0.343]}>
          <mesh scale={[1, 1.15, 0.38]}>
            <sphereGeometry args={[0.06, 24, 20]} />
            <meshStandardMaterial color="#8ee6a0" emissive="#34d399" emissiveIntensity={0.15} roughness={0.25} />
          </mesh>
          <mesh position={[0, 0, 0.022]} scale={[0.45, 1.45, 0.3]}>
            <sphereGeometry args={[0.028, 20, 16]} />
            <meshStandardMaterial color={dark} roughness={0.25} />
          </mesh>
          <mesh position={[-0.014, 0.023, 0.03]}>
            <sphereGeometry args={[0.009, 12, 10]} />
            <meshBasicMaterial color="#e8e6e1" />
          </mesh>
        </group>
      ))}
      {/* Front paws */}
      <mesh position={[-0.13, 0.12, 0.2]} castShadow>
        <sphereGeometry args={[0.09, 20, 16]} />
        <meshStandardMaterial color="#e8e6e1" roughness={0.8} />
      </mesh>
      <mesh position={[0.13, 0.12, 0.2]} castShadow>
        <sphereGeometry args={[0.09, 20, 16]} />
        <meshStandardMaterial color="#e8e6e1" roughness={0.8} />
      </mesh>
      {/* Hind paws */}
      <mesh position={[-0.15, 0.11, -0.2]} castShadow>
        <sphereGeometry args={[0.1, 20, 16]} />
        <meshStandardMaterial color={color} roughness={0.5} />
      </mesh>
      <mesh position={[0.15, 0.11, -0.2]} castShadow>
        <sphereGeometry args={[0.1, 20, 16]} />
        <meshStandardMaterial color={color} roughness={0.5} />
      </mesh>
      {/* Tail — a joined chain sweeping back from the rump, then curling up. */}
      {TAIL_SEGMENTS.map((seg, i) => (
        <mesh key={i} position={seg.position} rotation={[seg.tilt, 0, 0]} castShadow>
          <capsuleGeometry args={[seg.radius, seg.length, 8, 16]} />
          <meshStandardMaterial color={color} roughness={0.45} />
        </mesh>
      ))}
      <mesh position={TAIL_TIP} castShadow>
        <sphereGeometry args={[0.052, 20, 16]} />
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
