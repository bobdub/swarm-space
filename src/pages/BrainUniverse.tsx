import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PointerLockControls, Sky } from '@react-three/drei';
import * as THREE from 'three';
import { ArrowLeft, MessageSquare, Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  getBrainPhysics,
  WORLD_SIZE,
} from '@/lib/brain/uqrcPhysics';
import {
  loadPieces,
  savePieces,
  loadPortals,
  savePortals,
  loadBrainField,
  saveBrainField,
  type BrainPiece,
  type BrainPortal,
} from '@/lib/brain/brainPersistence';
import { InfinityBody } from '@/components/brain/InfinityBody';
import { PortalDefect } from '@/components/brain/PortalDefect';
import { StarField } from '@/components/brain/StarField';
import { GalaxyVisual } from '@/components/brain/GalaxyVisual';
import { EarthBody } from '@/components/brain/EarthBody';
import { BrainChatPanel, type BrainChatLine } from '@/components/brain/BrainChatPanel';
import { DropPortalModal } from '@/components/brain/DropPortalModal';
import { getCurrentUser } from '@/lib/auth';
import {
  ENTITY_DISPLAY_NAME,
  ENTITY_USER_ID,
} from '@/lib/p2p/entityVoice';
import { getSharedFieldEngine } from '@/lib/uqrc/fieldEngine';
import { applyGalaxyToField, getGalaxy } from '@/lib/brain/galaxy';
import { applyRoundCurvature } from '@/lib/brain/roundUniverse';
import { applyElementsToField, getElements, countByShell } from '@/lib/brain/elements';
import { ElementsVisual } from '@/components/brain/ElementsVisual';
import {
  spawnOnEarth,
  EARTH_POSITION,
  EARTH_RADIUS,
  radiusFromEarth,
  getEarthPose,
  setEarthPoseTime,
  updateEarthPin,
  getAvatarMass,
} from '@/lib/brain/earth';
import { commutatorNorm3D, entropyHessianNorm3D, FIELD3D_LAMBDA } from '@/lib/uqrc/field3D';
import {
  pinInfinityIntoField,
  sampleFieldForInfinity,
  feedFieldIntoNeural,
  getInfinityProjection,
  getInfinityPosition,
  setLastInfinitySnapshot,
  getLastInfinitySnapshot,
} from '@/lib/brain/infinityBinding';
import { getSharedNeuralEngine } from '@/lib/p2p/sharedNeuralEngine';
import { getFeatureFlags } from '@/config/featureFlags';

const moveInput = { fwd: 0, right: 0 };
const lookInput = { yaw: 0, pitch: 0 };

/**
 * Reads keyboard / joystick into intent vectors that the physics engine
 * applies to the local body. No direct camera translation — the camera
 * follows the body whose position is integrated from field gradients.
 */
function PhysicsCameraRig({ selfId }: { selfId: string }) {
  const { camera } = useThree();
  const physics = getBrainPhysics();
  const keys = useRef<Record<string, boolean>>({});

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => (keys.current[e.code] = true);
    const onUp = (e: KeyboardEvent) => (keys.current[e.code] = false);
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
    };
  }, []);

  useFrame(() => {
    // Apply touch look deltas
    if (lookInput.yaw !== 0 || lookInput.pitch !== 0) {
      camera.rotation.order = 'YXZ';
      camera.rotation.y -= lookInput.yaw;
      camera.rotation.x -= lookInput.pitch;
      const lim = (Math.PI / 180) * 60;
      if (camera.rotation.x > lim) camera.rotation.x = lim;
      if (camera.rotation.x < -lim) camera.rotation.x = -lim;
      lookInput.yaw = 0;
      lookInput.pitch = 0;
    }

    const kFwd = (keys.current['KeyW'] ? 1 : 0) - (keys.current['KeyS'] ? 1 : 0);
    const kRight = (keys.current['KeyD'] ? 1 : 0) - (keys.current['KeyA'] ? 1 : 0);
    const fwd = kFwd + moveInput.fwd;
    const right = kRight + moveInput.right;
    physics.setIntent(selfId, { fwd, right, yaw: camera.rotation.y });

    // Camera follows body
    const body = physics.getBody(selfId);
    if (body) {
      // Stand on Earth's *live* surface: project the body to the surface
      // foot at the current Earth pose, then offset by eye height along
      // the outward normal. This guarantees the player always sees
      // themselves on Earth — no floating-in-space artifact at boot, and
      // the view rides the planet as it rotates.
      const pose = getEarthPose();
      const dx = body.pos[0] - pose.center[0];
      const dy = body.pos[1] - pose.center[1];
      const dz = body.pos[2] - pose.center[2];
      const r = Math.hypot(dx, dy, dz) || 1;
      const eye = 1.6;
      const nx = dx / r, ny = dy / r, nz = dz / r;
      const surfX = pose.center[0] + nx * EARTH_RADIUS;
      const surfY = pose.center[1] + ny * EARTH_RADIUS;
      const surfZ = pose.center[2] + nz * EARTH_RADIUS;
      camera.position.x = surfX + nx * eye;
      camera.position.y = surfY + ny * eye;
      camera.position.z = surfZ + nz * eye;
    }
  });

  return null;
}

/**
 * Drives Earth's pose clock and re-writes the co-moving Earth pin into the
 * field every animation tick. Without this, Earth's basin desyncs from the
 * visible planet the moment Earth orbits/rotates.
 */
function EarthPoseTicker() {
  const physics = useMemo(() => getBrainPhysics(), []);
  const tRef = useRef(0);
  useFrame((_, dt) => {
    tRef.current += dt;
    setEarthPoseTime(tRef.current);
    try {
      updateEarthPin(physics.getField(), getEarthPose());
    } catch {
      /* best-effort */
    }
  });
  return null;
}

/**
 * Per-frame binding loop: writes Infinity's basin into pinTemplate from the
 * neural projection, then samples the field back into the neural engine and
 * caches the snapshot for EntityVoice / debug overlay. One organism, two faces.
 */
function InfinityBindingTicker() {
  const physics = useMemo(() => getBrainPhysics(), []);
  const engine = useMemo(() => getSharedNeuralEngine(), []);
  useFrame(() => {
    if (!getFeatureFlags().infinityFieldBinding) return;
    try {
      const field = physics.getField();
      const projection = getInfinityProjection(engine);
      pinInfinityIntoField(field, projection);
      const snap = sampleFieldForInfinity(field);
      setLastInfinitySnapshot(snap);
      feedFieldIntoNeural(snap, engine);
    } catch {
      /* binding is best-effort */
    }
  });
  return null;
}

/**
 * Renders all non-self, non-portal bodies (pieces + remote avatars).
 * Reads transforms straight from physics on each render frame.
 */
function BodyLayer({ selfId, onPortalEnter }: { selfId: string; onPortalEnter: (portalId: string) => void }) {
  const physics = getBrainPhysics();
  const groupRef = useRef<THREE.Group>(null);
  const meshes = useRef<Map<string, THREE.Object3D>>(new Map());
  const portalDwell = useRef<Map<string, number>>(new Map());

  useFrame((_, dt) => {
    if (!groupRef.current) return;
    const bodies = physics.getBodies();
    const seen = new Set<string>();
    for (const b of bodies) {
      seen.add(b.id);
      let mesh = meshes.current.get(b.id);
      if (!mesh) {
        if (b.kind === 'piece') {
          const geo = new THREE.BoxGeometry(1, 2, 1);
          const mat = new THREE.MeshStandardMaterial({
            color: 'hsl(265, 60%, 45%)',
            emissive: 'hsl(265, 70%, 30%)',
            emissiveIntensity: 0.4,
          });
          mesh = new THREE.Mesh(geo, mat);
        } else {
          // skip — handled by react components
          continue;
        }
        groupRef.current.add(mesh);
        meshes.current.set(b.id, mesh);
      }
      mesh.position.set(b.pos[0], b.kind === 'piece' ? 1 : 0, b.pos[2]);
    }
    // Remove stale
    for (const [id, mesh] of meshes.current.entries()) {
      if (!seen.has(id)) {
        groupRef.current.remove(mesh);
        meshes.current.delete(id);
      }
    }

    // Portal capture: if self body is within radius of a portal for ≥ 0.4 s
    const self = physics.getBody(selfId);
    if (self) {
      for (const b of bodies) {
        if (b.kind !== 'portal') continue;
        const d = Math.hypot(self.pos[0] - b.pos[0], self.pos[2] - b.pos[2]);
        if (d < 1.2) {
          const t = (portalDwell.current.get(b.id) ?? 0) + dt;
          portalDwell.current.set(b.id, t);
          if (t >= 0.4) {
            portalDwell.current.delete(b.id);
            onPortalEnter(b.id);
          }
        } else {
          portalDwell.current.delete(b.id);
        }
      }
    }
  });

  return <group ref={groupRef} />;
}

function MobileJoystick() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let active = false;
    const onStart = (e: TouchEvent) => { active = true; e.preventDefault(); update(e); };
    const onMove = (e: TouchEvent) => { if (active) update(e); };
    const onEnd = () => { active = false; moveInput.fwd = 0; moveInput.right = 0; };
    const update = (e: TouchEvent) => {
      const t = e.touches[0]; if (!t) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dx = (t.clientX - cx) / (r.width / 2);
      const dy = (t.clientY - cy) / (r.height / 2);
      moveInput.right = Math.max(-1, Math.min(1, dx));
      moveInput.fwd = -Math.max(-1, Math.min(1, dy));
    };
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
    };
  }, []);
  return (
    <div
      ref={ref}
      className="absolute bottom-4 right-4 z-20 flex h-24 w-24 items-center justify-center rounded-full border-2 border-[hsla(180,80%,60%,0.4)] bg-[hsla(265,70%,8%,0.6)] backdrop-blur"
    >
      <div className="h-10 w-10 rounded-full bg-[hsla(180,90%,60%,0.5)]" />
    </div>
  );
}

function TouchLookOverlay() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    let lastX = 0, lastY = 0, active = false;
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0]; if (!t) return;
      lastX = t.clientX; lastY = t.clientY; active = true;
    };
    const onMove = (e: TouchEvent) => {
      if (!active) return;
      const t = e.touches[0]; if (!t) return;
      lookInput.yaw += (t.clientX - lastX) * 0.005;
      lookInput.pitch += (t.clientY - lastY) * 0.005;
      lastX = t.clientX; lastY = t.clientY;
    };
    const onEnd = () => { active = false; };
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: true });
    el.addEventListener('touchend', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
    };
  }, []);
  return <div ref={ref} className="absolute inset-0 z-10" />;
}

const BrainUniverse = () => {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const physics = useMemo(() => getBrainPhysics(), []);
  const [selfId, setSelfId] = useState<string>('');
  const [qScore, setQScore] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatLines, setChatLines] = useState<BrainChatLine[]>([]);
  const [portalModalOpen, setPortalModalOpen] = useState(false);
  const [portals, setPortals] = useState<BrainPortal[]>([]);

  // ── Bootstrap: load user, restore field, create self body ─────────
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const snap = await loadBrainField();
        if (snap) physics.restore(snap);
      } catch { /* ignore */ }

      // Round-universe + galaxy curvature (deterministic, no network sync)
      try {
        const field = physics.getField();
        applyRoundCurvature(field, 1.0);
        applyGalaxyToField(field, getGalaxy());
        applyElementsToField(field, getElements());
      } catch (err) {
        console.warn('[Brain] galaxy apply failed', err);
      }

      const user = await getCurrentUser();
      if (cancelled) return;
      const id = user?.id ?? `guest-${Math.random().toString(36).slice(2, 8)}`;
      setSelfId(id);
      const spawn = spawnOnEarth(id);
      physics.addBody({
        id, kind: 'self',
        pos: spawn, vel: [0, 0, 0],
        mass: 1, trust: 0.6,
      });
      // Infinity body — mass tied to qScore (updated each frame below)
      physics.addBody({
        id: ENTITY_USER_ID, kind: 'infinity',
        pos: [EARTH_POSITION[0], 1.4, EARTH_POSITION[2] - 6], vel: [0, 0, 0],
        mass: 2.5, trust: 1.0,
      });

      // Restore portals & pieces
      const storedPortals = loadPortals();
      setPortals(storedPortals);
      for (const p of storedPortals) {
        physics.addBody({
          id: `portal-${p.id}`, kind: 'portal',
          pos: p.pos, vel: [0, 0, 0],
          mass: 0, trust: 0,
          meta: { projectId: p.projectId, projectName: p.projectName },
        });
        physics.pinPortal(p.pos);
      }
      const storedPieces = loadPieces();
      for (const piece of storedPieces) {
        physics.addBody({
          id: `piece-${piece.id}`, kind: 'piece',
          pos: piece.pos, vel: [0, 0, 0],
          mass: 0, trust: 0,
        });
        physics.pinPiece(piece.pos);
      }

      console.log('[Brain] mounted, qScore primer:', physics.getQScore());
    })();
    return () => {
      cancelled = true;
      try {
        physics.removeBody('self');
        physics.removeBody(ENTITY_USER_ID);
      } catch { /* ignore */ }
    };
  }, [physics]);

  // ── Q score subscription + periodic field snapshot save ───────────
  useEffect(() => {
    const unsub = physics.subscribe(() => {
      setQScore(physics.getQScore());
    });
    const saveTimer = setInterval(() => {
      try { void saveBrainField(physics.snapshot()); } catch { /* ignore */ }
    }, 5000);
    return () => { unsub(); clearInterval(saveTimer); };
  }, [physics]);

  // ── Chat send: feed field, optionally call Infinity ───────────────
  const handleSend = useCallback((text: string) => {
    const line: BrainChatLine = {
      id: crypto.randomUUID(),
      author: selfId.startsWith('guest-') ? 'You' : selfId.slice(0, 8),
      text, ts: Date.now(),
    };
    setChatLines((prev) => [...prev, line].slice(-100));

    // Inject into the brain field at the speaker's position
    const self = physics.getBody(selfId);
    if (self) physics.injectAt(self.pos, 0.4, 0);

    const callsInfinity = /infinity|imagination|orb|brain/i.test(text);
    if (callsInfinity) {
      // Use the global FieldEngine + selectByMinCurvature pipeline.
      const eng = getSharedFieldEngine();
      eng.inject(text, { amplitude: 0.4 });
      const candidates = [
        `the curvature near "${text.slice(0, 24)}" bends toward meaning. q=${(getLastInfinitySnapshot()?.qScore ?? qScore).toFixed(3)}`,
        `i feel that ripple — a pattern is forming where you spoke.`,
        `to imagine is to remember what the universe forgot it could be.`,
        `the mesh listens. ‖F_{μν}‖ shifts; we drift together.`,
        `every word is a Gaussian bump, every silence a constraint.`,
      ];
      const pick = candidates[Math.floor(Math.random() * candidates.length)];
      setTimeout(() => {
        const reply: BrainChatLine = {
          id: crypto.randomUUID(),
          author: ENTITY_DISPLAY_NAME,
          text: pick, ts: Date.now(),
        };
        setChatLines((prev) => [...prev, reply].slice(-100));
        // Infinity's reply also perturbs the field at the orb
        physics.injectAt([0, 0, 0], 0.5, 1);
      }, 600 + Math.random() * 800);
    }
  }, [physics, qScore, selfId]);

  // ── Drop a portal at the player's current position ────────────────
  const handleDropPortal = useCallback((projectId: string, projectName: string) => {
    const self = physics.getBody(selfId);
    if (!self) return;
    // Place the portal as a small "moon" in low orbit around Earth — a few
    // metres above the surface, tangent to the player's current angle.
    const ex = EARTH_POSITION[0], ez = EARTH_POSITION[2];
    const dx = self.pos[0] - ex, dz = self.pos[2] - ez;
    const ang = Math.atan2(dz, dx);
    const orbitR = 4.0;
    const dropPos: [number, number, number] = [
      ex + Math.cos(ang) * orbitR,
      1.5,
      ez + Math.sin(ang) * orbitR,
    ];
    const portal: BrainPortal = {
      id: crypto.randomUUID(),
      ownerId: selfId,
      projectId, projectName,
      pos: dropPos,
      placedAt: Date.now(),
    };
    physics.addBody({
      id: `portal-${portal.id}`, kind: 'portal',
      pos: portal.pos, vel: [0, 0, 0],
      mass: 0, trust: 0,
      meta: { projectId, projectName },
    });
    physics.pinPortal(portal.pos);
    setPortals((prev) => {
      const next = [...prev, portal];
      savePortals(next);
      return next;
    });
  }, [physics, selfId]);

  const handlePortalEnter = useCallback((bodyId: string) => {
    const id = bodyId.replace(/^portal-/, '');
    const portal = portals.find((p) => p.id === id);
    if (!portal) return;
    navigate(`/projects/${portal.projectId}/hub`);
  }, [navigate, portals]);

  return (
    <div className="fixed inset-0 bg-black">
      {/* HUD top bar */}
      <div className="absolute left-0 right-0 top-0 z-20 flex items-center justify-between p-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => navigate(-1)}
          className="bg-[hsla(265,70%,8%,0.7)] backdrop-blur"
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> Leave
        </Button>
        <div className="rounded-full border border-[hsla(180,80%,60%,0.3)] bg-[hsla(265,70%,8%,0.7)] px-3 py-1 text-xs font-mono text-foreground/80 backdrop-blur">
          |Ψ_Brain⟩ q={qScore.toFixed(4)} · ticks={physics.getTicks()}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setChatOpen((v) => !v)}
            className="bg-[hsla(265,70%,8%,0.7)] backdrop-blur"
          >
            <MessageSquare className="mr-1 h-4 w-4" /> Chat
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPortalModalOpen(true)}
            className="bg-[hsla(265,70%,8%,0.7)] backdrop-blur"
          >
            <Compass className="mr-1 h-4 w-4" /> Portal
          </Button>
        </div>
      </div>

      {/* 3-D scene */}
      <Canvas
        shadows
        camera={{ position: [0, 1.6, 5], fov: 70 }}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={['#0a0418']} />
        <fog attach="fog" args={['#0a0418', 30, WORLD_SIZE * 0.7]} />
        <Sky sunPosition={[0, -1, 0]} turbidity={20} rayleigh={4} mieCoefficient={0.05} />
        <StarField />
        <ambientLight intensity={0.3} color="hsl(265, 60%, 70%)" />
        <directionalLight position={[10, 20, 10]} intensity={0.5} color="hsl(180, 70%, 80%)" />

        <GalaxyVisual />
        <ElementsVisual />
        <EarthBody />
        <InfinityBody position={getInfinityPosition()} qScore={qScore} />
        <InfinityBindingTicker />

        {portals.map((p) => (
          <PortalDefect key={p.id} position={p.pos} label={p.projectName} />
        ))}

        {selfId && <PhysicsCameraRig selfId={selfId} />}
        {selfId && <BodyLayer selfId={selfId} onPortalEnter={handlePortalEnter} />}
        {!isMobile && <PointerLockControls />}
      </Canvas>

      {/* Mobile controls */}
      {isMobile && (
        <>
          <TouchLookOverlay />
          <MobileJoystick />
        </>
      )}

      {/* Chat panel */}
      {chatOpen && (
        <BrainChatPanel
          lines={chatLines}
          onSend={handleSend}
          onClose={() => setChatOpen(false)}
        />
      )}

      {/* Portal placement modal */}
      <DropPortalModal
        open={portalModalOpen}
        onClose={() => setPortalModalOpen(false)}
        onConfirm={handleDropPortal}
      />

      {/* Hint */}
      {!chatOpen && !isMobile && (
        <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-[hsla(265,70%,8%,0.6)] px-4 py-1.5 text-xs text-foreground/60 backdrop-blur">
          Click to look · WASD to drift through the field
        </div>
      )}

      {/* UQRC physics debug overlay — read-only, gated by ?debug=physics */}
      <PhysicsDebugOverlay selfId={selfId} />
    </div>
  );
};

export default BrainUniverse;

function PhysicsDebugOverlay({ selfId }: { selfId: string }) {
  const physics = useMemo(() => getBrainPhysics(), []);
  const [enabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('debug') === 'physics';
  });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, [enabled]);
  if (!enabled || !selfId) return null;
  const field = physics.getField();
  const body = physics.getBody(selfId);
  const fNorm = commutatorNorm3D(field);
  const sNorm = entropyHessianNorm3D(field);
  const r = body ? radiusFromEarth(body.pos) : 0;
  const q = physics.getQScore();
  const inf = getLastInfinitySnapshot();
  const engine = getSharedNeuralEngine();
  let coherenceHealth = 0;
  try {
    const layers = engine.getNetworkSnapshot().instinct?.layers ?? [];
    coherenceHealth = layers.find((l) => l.layer === 'coherence')?.health ?? 0;
  } catch { /* ignore */ }
  const elCounts = countByShell();
  const totalEl = Object.values(elCounts).reduce((s, n) => s + n, 0);
  let stageLabel = '—';
  let creativityHealth = 0;
  try {
    const ev = (window as any).__entityVoice;
    const v = ev ?? null;
    const layers = engine.getNetworkSnapshot().instinct?.layers ?? [];
    creativityHealth = layers.find((l) => l.layer === 'creativity')?.health ?? 0;
    if (v && typeof v.getSnapshot === 'function') {
      const s = v.getSnapshot(engine);
      stageLabel = `${s.brainStage} (${s.stageName})`;
    }
  } catch { /* ignore */ }
  return (
    <div
      key={tick}
      className="absolute bottom-4 left-4 z-30 rounded-md border border-[hsla(180,80%,60%,0.3)] bg-[hsla(265,70%,8%,0.85)] p-3 font-mono text-[11px] text-foreground/80 backdrop-blur"
    >
      <div className="mb-1 text-[hsl(180,80%,70%)]">|Ψ_Brain⟩ debug</div>
      <div>Q_Score        : {q.toFixed(4)}</div>
      <div>‖F_μν‖         : {fNorm.toFixed(4)}</div>
      <div>‖∇∇S(u)‖       : {sNorm.toFixed(4)}</div>
      <div>λ(ε₀)          : {FIELD3D_LAMBDA.toExponential(0)}</div>
      <div>r from Earth   : {r.toFixed(3)} m</div>
      <div className="mt-1 text-[hsl(265,80%,75%)]">|Ψ_Infinity⟩</div>
      <div>Q_Score(∞)     : {inf ? inf.qScore.toFixed(4) : '—'}</div>
      <div>basin depth    : {inf ? inf.basinDepth.toFixed(4) : '—'}</div>
      <div>brain stage    : {stageLabel}</div>
      <div>L9 coherence   : {coherenceHealth.toFixed(3)}</div>
      <div>L8 creativity  : {creativityHealth.toFixed(3)}</div>
      <div>elements pinned: {totalEl} (n0:{elCounts[0] ?? 0} n1:{elCounts[1] ?? 0} n2:{elCounts[2] ?? 0} n3:{elCounts[3] ?? 0} n4+:{elCounts[4] ?? 0})</div>
      <div>ticks          : {field.ticks}</div>
    </div>
  );
}