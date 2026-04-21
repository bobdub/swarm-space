import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PointerLockControls, Sky } from "@react-three/drei";
import * as THREE from "three";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Mic, MicOff, Loader2 } from "lucide-react";
import { getProject } from "@/lib/projects";
import { getAll } from "@/lib/store";
import type { Post, Project } from "@/types";
import { PostPanel } from "@/components/virtualHub/PostPanel";
import { BuildersBox } from "@/components/virtualHub/BuildersBox";
import { getAvatarById, loadHubPrefs } from "@/lib/virtualHub/avatars";

function PlayerController({ avatarId }: { avatarId: string }) {
  const { camera } = useThree();
  const keys = useRef<Record<string, boolean>>({});
  const velocity = useRef(new THREE.Vector3());
  const direction = useRef(new THREE.Vector3());
  const avatar = getAvatarById(avatarId);

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => (keys.current[e.code] = true);
    const onUp = (e: KeyboardEvent) => (keys.current[e.code] = false);
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
    };
  }, []);

  useEffect(() => {
    camera.position.set(0, 1.6, 0);
  }, [camera]);

  useFrame((_, delta) => {
    const speed = 4;
    const fwd = (keys.current["KeyW"] ? 1 : 0) - (keys.current["KeyS"] ? 1 : 0);
    const right = (keys.current["KeyD"] ? 1 : 0) - (keys.current["KeyA"] ? 1 : 0);

    direction.current.set(right, 0, -fwd).normalize();
    velocity.current.set(0, 0, 0);

    if (direction.current.lengthSq() > 0) {
      const yaw = camera.rotation.y;
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      velocity.current.x = direction.current.x * cos + direction.current.z * sin;
      velocity.current.z = direction.current.z * cos - direction.current.x * sin;
      velocity.current.multiplyScalar(speed * delta);
      camera.position.add(velocity.current);
    }

    // Clamp inside the world circle
    const maxR = 18;
    const r = Math.hypot(camera.position.x, camera.position.z);
    if (r > maxR) {
      camera.position.x *= maxR / r;
      camera.position.z *= maxR / r;
    }
    camera.position.y = 1.6;
  });

  // Render avatar at camera xz, slightly behind
  const groupRef = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!groupRef.current) return;
    groupRef.current.position.set(camera.position.x, 0, camera.position.z);
    groupRef.current.rotation.y = camera.rotation.y + Math.PI;
  });

  return <group ref={groupRef}>{avatar.render({ scale: 0.6 })}</group>;
}

function PostWall({ posts }: { posts: Post[] }) {
  const layout = useMemo(() => {
    if (posts.length === 0) return [];
    const radius = Math.max(6, 3 + posts.length * 0.4);
    return posts.map((post, i) => {
      const angle = (i / posts.length) * Math.PI * 2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      // Face inward (toward origin)
      const rotationY = -angle + Math.PI / 2;
      return { post, position: [x, 1.2, z] as [number, number, number], rotationY };
    });
  }, [posts]);

  return (
    <>
      {layout.map(({ post, position, rotationY }) => (
        <PostPanel key={post.id} post={post} position={position} rotationY={rotationY} />
      ))}
    </>
  );
}

function HubScene({ posts, avatarId }: { posts: Post[]; avatarId: string }) {
  return (
    <>
      <Sky sunPosition={[10, 8, 5]} />
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[10, 12, 6]}
        intensity={0.9}
        castShadow
        shadow-mapSize={[1024, 1024]}
      />

      {/* Ground disc */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <circleGeometry args={[20, 64]} />
        <meshStandardMaterial color="#1a1d2e" roughness={0.9} />
      </mesh>
      {/* Outer ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <ringGeometry args={[19.6, 20, 64]} />
        <meshStandardMaterial color="#2dd4bf" emissive="#2dd4bf" emissiveIntensity={0.3} />
      </mesh>

      <BuildersBox tools={[]} />
      <PostWall posts={posts} />

      <PointerLockControls />
      <PlayerController avatarId={avatarId} />
    </>
  );
}

export default function VirtualHub() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [muted, setMuted] = useState(false);
  const [hintVisible, setHintVisible] = useState(true);
  const prefs = useMemo(() => loadHubPrefs(), []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!projectId) return;
      try {
        const p = await getProject(projectId);
        if (cancelled) return;
        if (!p) {
          navigate("/explore");
          return;
        }
        setProject(p);
        const all = (await getAll("posts")) as Post[];
        const projectPosts = all.filter((post) => p.feedIndex.includes(post.id));
        if (!cancelled) setPosts(projectPosts);
      } catch (e) {
        console.error("[VirtualHub] load error", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, navigate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black">
      <Canvas shadows camera={{ position: [0, 1.6, 0], fov: 70 }} dpr={[1, 1.5]}>
        <HubScene posts={posts} avatarId={prefs.avatarId} />
      </Canvas>

      {/* HUD */}
      <div className="absolute top-4 left-4 flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => navigate(`/projects/${projectId}`)}
          className="gap-2 bg-background/70 backdrop-blur"
        >
          <ArrowLeft className="h-4 w-4" /> Leave Hub
        </Button>
        <div className="rounded-md bg-background/70 backdrop-blur px-3 py-1.5 text-xs text-foreground">
          {project?.name ?? "Hub"}
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setMuted((m) => !m)}
          className="gap-2 bg-background/70 backdrop-blur"
        >
          {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          {muted ? "Muted" : "Mic on"}
        </Button>
      </div>

      {hintVisible && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-md bg-background/70 backdrop-blur px-4 py-2 text-xs text-foreground/80">
          Click to look around · WASD to move ·{" "}
          <button
            type="button"
            className="underline"
            onClick={() => setHintVisible(false)}
          >
            dismiss
          </button>
        </div>
      )}
    </div>
  );
}