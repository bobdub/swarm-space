/**
 * VirtualHub — Per-project Brain universe (members only).
 *
 * The legacy grass disc + post-billboard hub has been replaced by a
 * per-project instance of the shared `BrainUniverseScene` (hollow Earth +
 * UQRC street + voice/chat/avatars). Access is gated by project membership;
 * non-members are redirected back to the project page with a toast.
 */
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getProject, isProjectMember } from "@/lib/projects";
import { getCurrentUser } from "@/lib/auth";
import type { Project } from "@/types";
import BrainUniverseScene from "@/components/brain/BrainUniverseScene";

export default function VirtualHub() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!projectId) {
        navigate("/explore");
        return;
      }
      try {
        const [p, user] = await Promise.all([getProject(projectId), getCurrentUser()]);
        if (cancelled) return;
        if (!p) {
          navigate("/explore");
          return;
        }
        if (!user || !isProjectMember(p, user.id)) {
          toast.error("Only members can enter this universe.");
          navigate(`/projects/${projectId}`);
          return;
        }
        setProject(p);
        setAllowed(true);
      } catch (err) {
        console.error("[VirtualHub] load error", err);
        navigate(`/projects/${projectId ?? ""}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, navigate]);

  if (loading || !allowed || !project) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <BrainUniverseScene
      roomId={`brain-project-${project.id}`}
      universeKey={`project-${project.id}`}
      title={project.name}
      leaveLabel="Leave Universe"
      onLeave={() => navigate(`/projects/${project.id}`)}
    />
  );
}

// Shared movement input — keyboard writes here, joystick writes here too.
const moveInput = { fwd: 0, right: 0 };
// Shared look input from touch drag (radians delta, consumed each frame).
const lookInput = { yaw: 0, pitch: 0 };

function TouchLookController() {
  const { camera } = useThree();
  useFrame(() => {
    if (lookInput.yaw === 0 && lookInput.pitch === 0) return;
    camera.rotation.order = "YXZ";
    camera.rotation.y -= lookInput.yaw;
    camera.rotation.x -= lookInput.pitch;
    const lim = (Math.PI / 180) * 60;
    if (camera.rotation.x > lim) camera.rotation.x = lim;
    if (camera.rotation.x < -lim) camera.rotation.x = -lim;
    lookInput.yaw = 0;
    lookInput.pitch = 0;
  });
  return null;
}

function PlayerController({ avatarId, frozen = false }: { avatarId: string; frozen?: boolean }) {
  const { camera } = useThree();
  const keys = useRef<Record<string, boolean>>({});
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
    if (frozen) {
      camera.position.y = 1.6;
      return;
    }
    const speed = 4;
    const kFwd = (keys.current["KeyW"] ? 1 : 0) - (keys.current["KeyS"] ? 1 : 0);
    const kRight = (keys.current["KeyD"] ? 1 : 0) - (keys.current["KeyA"] ? 1 : 0);
    const fwd = kFwd + moveInput.fwd;
    const rt = kRight + moveInput.right;

    if (fwd !== 0 || rt !== 0) {
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      const rightVec = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
      const move = new THREE.Vector3()
        .addScaledVector(forward, fwd)
        .addScaledVector(rightVec, rt);
      if (move.lengthSq() > 0) {
        move.normalize().multiplyScalar(speed * delta);
        camera.position.add(move);
      }
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

function PostWall({ posts, castShadow = true }: { posts: Post[]; castShadow?: boolean }) {
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
        <PostPanel
          key={post.id}
          post={post}
          position={position}
          rotationY={rotationY}
          castShadow={castShadow}
        />
      ))}
    </>
  );
}

function HubScene({
  posts,
  avatarId,
  isMobile,
  controller,
  cameraRef,
}: {
  posts: Post[];
  avatarId: string;
  isMobile: boolean;
  controller: ReturnType<typeof useBuildController>;
  cameraRef: React.MutableRefObject<{ x: number; z: number; fx: number; fz: number }>;
}) {
  const buildMode = controller.mode === "build";
  return (
    <>
      <Sky sunPosition={[10, 8, 5]} />
      <ambientLight intensity={0.6} />
      <directionalLight
        position={[10, 12, 6]}
        intensity={0.9}
        castShadow
        shadow-mapSize={isMobile ? [512, 512] : [1024, 1024]}
      />

      {/* Grass ground disc */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <circleGeometry args={[20, 64]} />
        <meshStandardMaterial color="#3a7d3a" roughness={1} />
      </mesh>
      {/* Darker grass ring for depth */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, 0]} receiveShadow>
        <ringGeometry args={[10, 11, 64]} />
        <meshStandardMaterial color="#2f6a2f" roughness={1} />
      </mesh>
      {/* Outer ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <ringGeometry args={[19.6, 20, 64]} />
        <meshStandardMaterial color="#2dd4bf" emissive="#2dd4bf" emissiveIntensity={0.3} />
      </mesh>

      <BuildersBox tools={[]} />
      <PostWall posts={posts} castShadow={!isMobile} />
      <HubBuildLayer controller={controller} cameraRef={cameraRef} />

      {!isMobile && !buildMode && <PointerLockControls />}
      {isMobile && !buildMode && <TouchLookController />}
      <PlayerController avatarId={avatarId} frozen={buildMode} />
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
  const isMobile = useIsMobile();
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const joystickRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const currentUser = useMemo(() => getCurrentUser(), []);
  const canEdit = !!(project && currentUser && isProjectMember(project, currentUser.id));
  const cameraRef = useRef({ x: 0, z: 0, fx: 0, fz: -1 });
  const controller = useBuildController({
    project,
    currentUserId: currentUser?.id ?? null,
    canEdit,
    onProjectChange: setProject,
  });
  const buildMode = controller.mode === "build";

  // Spawn position for newly placed pieces: 2 m in front of the camera.
  const getSpawn = () => ({
    x: cameraRef.current.x + cameraRef.current.fx * 2,
    z: cameraRef.current.z + cameraRef.current.fz * 2,
  });

  // Touch-look should also pause while building.
  const touchLookEnabled = isMobile && !buildMode;

  // Touch look (single-finger drag on canvas wrapper, ignoring joystick area)
  useEffect(() => {
    if (!touchLookEnabled) return;
    const el = canvasWrapRef.current;
    if (!el) return;
    let activeId: number | null = null;
    let lastX = 0;
    let lastY = 0;
    const sensitivity = 0.005;
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest("[data-hub-ui]")) return;
      activeId = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onMove = (e: PointerEvent) => {
      if (activeId !== e.pointerId) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      lookInput.yaw += dx * sensitivity;
      lookInput.pitch += dy * sensitivity;
    };
    const onUp = (e: PointerEvent) => {
      if (activeId === e.pointerId) activeId = null;
    };
    el.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [touchLookEnabled]);

  // Virtual joystick
  useEffect(() => {
    if (!isMobile || buildMode) return;
    const stick = joystickRef.current;
    const knob = knobRef.current;
    if (!stick || !knob) return;
    let activeId: number | null = null;
    let cx = 0;
    let cy = 0;
    const radius = 50;
    const reset = () => {
      knob.style.transform = "translate(0px, 0px)";
      moveInput.fwd = 0;
      moveInput.right = 0;
    };
    const onDown = (e: PointerEvent) => {
      e.preventDefault();
      const rect = stick.getBoundingClientRect();
      cx = rect.left + rect.width / 2;
      cy = rect.top + rect.height / 2;
      activeId = e.pointerId;
    };
    const onMove = (e: PointerEvent) => {
      if (activeId !== e.pointerId) return;
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy);
      if (dist > radius) {
        dx = (dx / dist) * radius;
        dy = (dy / dist) * radius;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      moveInput.right = dx / radius;
      moveInput.fwd = -dy / radius;
    };
    const onUp = (e: PointerEvent) => {
      if (activeId !== e.pointerId) return;
      activeId = null;
      reset();
    };
    stick.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      stick.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      reset();
    };
  }, [isMobile, buildMode]);

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
    <div className="fixed inset-0 bg-black touch-none" ref={canvasWrapRef}>
      <Canvas
        shadows
        camera={{ position: [0, 1.6, 0], fov: 70 }}
        dpr={isMobile ? [1, 1.25] : [1, 1.5]}
      >
        <HubScene
          posts={posts}
          avatarId={prefs.avatarId}
          isMobile={isMobile}
          controller={controller}
          cameraRef={cameraRef}
        />
      </Canvas>

      {/* HUD */}
      <div
        data-hub-ui
        className="absolute top-4 left-4 flex flex-col sm:flex-row items-start sm:items-center gap-2"
      >
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
        {canEdit && !buildMode && (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={controller.enterBuild}
            className="gap-2 bg-background/70 backdrop-blur"
          >
            <Hammer className="h-4 w-4" /> Build
          </Button>
        )}
      </div>

      {hintVisible && !buildMode && (
        <div
          data-hub-ui
          className={`absolute ${isMobile ? "bottom-32" : "bottom-6"} left-1/2 -translate-x-1/2 rounded-md bg-background/70 backdrop-blur px-4 py-2 text-xs text-foreground/80 max-w-[90vw] text-center`}
        >
          {isMobile ? "Drag to look · Joystick to move · " : "Click to look around · WASD to move · "}
          <button
            type="button"
            className="underline"
            onClick={() => setHintVisible(false)}
          >
            dismiss
          </button>
        </div>
      )}

      {isMobile && !buildMode && (
        <div
          data-hub-ui
          ref={joystickRef}
          className="absolute bottom-6 left-6 h-32 w-32 rounded-full bg-background/40 backdrop-blur border border-border/50 touch-none select-none"
          style={{ touchAction: "none" }}
        >
          <div
            ref={knobRef}
            className="absolute top-1/2 left-1/2 h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/70 border border-primary shadow-lg pointer-events-none"
          />
        </div>
      )}
      {isMobile && !buildMode && (
        <div
          data-hub-ui
          className="absolute bottom-6 right-6 rounded-md bg-background/40 backdrop-blur px-3 py-2 text-[10px] text-foreground/70 pointer-events-none"
        >
          Drag here to look
        </div>
      )}

      {buildMode && (
        <BuilderBar controller={controller} getSpawn={getSpawn} />
      )}
    </div>
  );
}