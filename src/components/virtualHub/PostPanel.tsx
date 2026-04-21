import { Html } from "@react-three/drei";
import type { Post } from "@/types";

interface PostPanelProps {
  post: Post;
  position: [number, number, number];
  rotationY: number;
}

export function PostPanel({ post, position, rotationY }: PostPanelProps) {
  const text = (post.content || "").slice(0, 140);
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* Panel back */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[2.2, 1.5, 0.08]} />
        <meshStandardMaterial color="#1a1d2e" roughness={0.7} />
      </mesh>
      {/* Frame trim */}
      <mesh position={[0, 0, 0.045]}>
        <boxGeometry args={[2.0, 1.3, 0.01]} />
        <meshStandardMaterial color="#2dd4bf" emissive="#2dd4bf" emissiveIntensity={0.15} />
      </mesh>
      <Html
        position={[0, 0, 0.06]}
        center
        distanceFactor={4}
        transform
        occlude
        style={{ width: 220, pointerEvents: "none" }}
      >
        <div
          style={{
            background: "hsl(245 70% 8% / 0.9)",
            color: "hsl(0 0% 95%)",
            padding: "10px 12px",
            borderRadius: 8,
            fontSize: 11,
            lineHeight: 1.4,
            border: "1px solid hsl(174 59% 56% / 0.3)",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 10, opacity: 0.7, marginBottom: 4 }}>
            {post.author?.slice(0, 24) || "anon"}
          </div>
          <div>{text || "(no content)"}</div>
        </div>
      </Html>
    </group>
  );
}