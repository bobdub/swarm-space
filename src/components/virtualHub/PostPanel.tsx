import { Html } from "@react-three/drei";
import type { Post } from "@/types";

interface PostPanelProps {
  post: Post;
  position: [number, number, number];
  rotationY: number;
  castShadow?: boolean;
}

function relTime(ts?: number): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function PostPanel({ post, position, rotationY, castShadow = true }: PostPanelProps) {
  const content = post.content || "(no content)";
  const thumb =
    (post as unknown as { mediaThumbnail?: string }).mediaThumbnail ||
    (post as unknown as { thumbnailUrl?: string }).thumbnailUrl ||
    null;
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* Panel back */}
      <mesh castShadow={castShadow} receiveShadow>
        <boxGeometry args={[2.6, 1.9, 0.08]} />
        <meshStandardMaterial color="#1a1d2e" roughness={0.7} />
      </mesh>
      {/* Frame trim */}
      <mesh position={[0, 0, 0.045]}>
        <boxGeometry args={[2.4, 1.7, 0.01]} />
        <meshStandardMaterial color="#2dd4bf" emissive="#2dd4bf" emissiveIntensity={0.15} />
      </mesh>
      <Html
        position={[0, 0, 0.06]}
        center
        distanceFactor={4}
        transform
        occlude
        style={{ width: 280, pointerEvents: "auto" }}
      >
        <div
          style={{
            background: "hsl(245 70% 8% / 0.92)",
            color: "hsl(0 0% 95%)",
            padding: "12px 14px",
            borderRadius: 10,
            fontSize: 11,
            lineHeight: 1.45,
            border: "1px solid hsl(174 59% 56% / 0.35)",
            fontFamily: "system-ui, sans-serif",
            maxHeight: 360,
            overflowY: "auto",
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontWeight: 600,
              fontSize: 10,
              opacity: 0.7,
              marginBottom: 6,
              gap: 8,
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {post.author?.slice(0, 24) || "anon"}
            </span>
            <span style={{ opacity: 0.6 }}>{relTime(post.timestamp)}</span>
          </div>
          {thumb && (
            <img
              src={thumb}
              alt=""
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
              style={{
                width: "100%",
                maxHeight: 120,
                objectFit: "cover",
                borderRadius: 6,
                marginBottom: 8,
              }}
            />
          )}
          <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{content}</div>
        </div>
      </Html>
    </group>
  );
}