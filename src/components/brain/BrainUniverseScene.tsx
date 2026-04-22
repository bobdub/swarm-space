import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ArrowLeft, MessageSquare, Compass } from 'lucide-react';
import { Mic, MicOff, Volume2, VolumeX, Video, VideoOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';
import { getWebRTCManager } from '@/lib/webrtc/manager';
import { useAuth } from '@/hooks/useAuth';
import { BrainVideoGrid } from '@/components/brain/BrainVideoGrid';
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
import {
  recordTurn,
  getPrevTurn,
  attractToPrev,
  selectBridgingReply,
} from '@/lib/uqrc/conversationAttraction';
import { applyGalaxyToField, getGalaxy } from '@/lib/brain/galaxy';
import { applyRoundCurvature } from '@/lib/brain/roundUniverse';
import { applyElementsToField, getElements, countByShell } from '@/lib/brain/elements';
import { ElementsVisual } from '@/components/brain/ElementsVisual';
import {
  spawnOnEarth,
  EARTH_POSITION,
  EARTH_RADIUS,
  HUMAN_HEIGHT,
  radiusFromEarth,
  getEarthPose,
  setEarthPoseTime,
  updateEarthPin,
  getAvatarMass,
  getSurfaceFrame,
  SUN_POSITION,
} from '@/lib/brain/earth';
import { RemoteAvatarBody } from '@/components/brain/RemoteAvatarBody';
import {
  loadHubPrefs,
  saveHubPrefs,
  getAvatarMassFromId,
} from '@/lib/virtualHub/avatars';
import { BrainEntryModal } from '@/components/brain/BrainEntryModal';
import { useBrainVoice } from '@/hooks/useBrainVoice';
import type { BrainVariant } from '@/lib/brain/variants';
import { PersistentAudioLayer } from '@/components/streaming/PersistentAudioLayer';
import {
  speakInfinity,
  cancelInfinity,
  primeInfinityVoice,
} from '@/lib/brain/infinityVoice';
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

function projectToEarthSurface(
  pos: [number, number, number],
  pose = getEarthPose(),
  altitude = 0.05,
): [number, number, number] {
  const dx = pos[0] - pose.center[0];
  const dy = pos[1] - pose.center[1];
  const dz = pos[2] - pose.center[2];
  const r = Math.hypot(dx, dy, dz) || 1;
  const nx = dx / r;
  const ny = dy / r;
  const nz = dz / r;
  return [
    pose.center[0] + nx * (EARTH_RADIUS + altitude),
    pose.center[1] + ny * (EARTH_RADIUS + altitude),
    pose.center[2] + nz * (EARTH_RADIUS + altitude),
  ];
}

/**
 * Reads keyboard / joystick into intent vectors that the physics engine
 * applies to the local body. No direct camera translation — the camera
 * follows the body whose position is integrated from field gradients.
 */
function PhysicsCameraRig({ selfId, fallbackId }: { selfId: string; fallbackId: string }) {
  const { camera } = useThree();
  const physics = getBrainPhysics();
  const keys = useRef<Record<string, boolean>>({});
  // Persistent look state — accumulated drag deltas live here, not on the
  // camera, so the next frame doesn't wipe them with lookAt().
  const yawRef = useRef(0);
  const pitchRef = useRef(0);
  // Smoothed basis "up" — re-derived from the body each frame but lerped
  // toward the live up so micro jitter doesn't roll the horizon.
  const smoothUp = useRef<[number, number, number] | null>(null);
  const smoothFwd = useRef<[number, number, number] | null>(null);

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
    // 1. Drain drag deltas into persistent yaw/pitch state.
    if (lookInput.yaw !== 0 || lookInput.pitch !== 0) {
      yawRef.current -= lookInput.yaw;
      pitchRef.current -= lookInput.pitch;
      const lim = (Math.PI / 180) * 70;
      if (pitchRef.current > lim) pitchRef.current = lim;
      if (pitchRef.current < -lim) pitchRef.current = -lim;
      lookInput.yaw = 0;
      lookInput.pitch = 0;
    }

    // 2. Compute the local surface basis (smoothed) for the body.
    const pose = getEarthPose();
    const body = physics.getBody(selfId);
    const source = body?.pos ?? spawnOnEarth(fallbackId, pose);
    const frame = getSurfaceFrame(source, pose);

    // Lerp the basis toward the live frame (slow) so micro jitter in the
    // body position doesn't snap the horizon. On the very first frame,
    // seed straight from the live frame so the camera starts level.
    const lerp = 0.15;
    if (!smoothUp.current) smoothUp.current = [frame.up[0], frame.up[1], frame.up[2]];
    if (!smoothFwd.current) smoothFwd.current = [frame.forward[0], frame.forward[1], frame.forward[2]];
    for (let k = 0; k < 3; k++) {
      smoothUp.current[k] += (frame.up[k] - smoothUp.current[k]) * lerp;
      smoothFwd.current[k] += (frame.forward[k] - smoothFwd.current[k]) * lerp;
    }
    // Re-orthonormalize the smoothed basis.
    const upN = (() => {
      const v = smoothUp.current!;
      const n = Math.hypot(v[0], v[1], v[2]) || 1;
      return [v[0] / n, v[1] / n, v[2] / n] as [number, number, number];
    })();
    // forward = (smoothFwd projected to plane ⟂ upN), then normalized.
    const fRaw = smoothFwd.current!;
    const dot = fRaw[0] * upN[0] + fRaw[1] * upN[1] + fRaw[2] * upN[2];
    let fwdN: [number, number, number] = [
      fRaw[0] - upN[0] * dot,
      fRaw[1] - upN[1] * dot,
      fRaw[2] - upN[2] * dot,
    ];
    const fn = Math.hypot(fwdN[0], fwdN[1], fwdN[2]) || 1;
    fwdN = [fwdN[0] / fn, fwdN[1] / fn, fwdN[2] / fn];
    // right = up × forward
    const rightN: [number, number, number] = [
      upN[1] * fwdN[2] - upN[2] * fwdN[1],
      upN[2] * fwdN[0] - upN[0] * fwdN[2],
      upN[0] * fwdN[1] - upN[1] * fwdN[0],
    ];

    // 3. Build the camera quaternion = basis × yaw × pitch (no lookAt).
    // Basis matrix columns: right, up, -forward (THREE looks down -Z).
    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(rightN[0], rightN[1], rightN[2]),
      new THREE.Vector3(upN[0], upN[1], upN[2]),
      new THREE.Vector3(-fwdN[0], -fwdN[1], -fwdN[2]),
    );
    const basisQuat = new THREE.Quaternion().setFromRotationMatrix(m);
    const viewEuler = new THREE.Euler(pitchRef.current, yawRef.current, 0, 'YXZ');
    const viewQuat = new THREE.Quaternion().setFromEuler(viewEuler);
    camera.quaternion.copy(basisQuat).multiply(viewQuat);

    // 4. Position camera at eye height above the body.
    // Eye sits ~human eye-height above feet. With EARTH_RADIUS=2 (sim
    // units), 0.85 reads as a person standing — not a giant looking down,
    // not a bug crawling. The camera looks tangentially along the surface
    // so you see ground extending to the horizon, not the planet as a ball.
    const eyeLift = 0.85;
    camera.position.set(
      source[0] + upN[0] * eyeLift,
      source[1] + upN[1] * eyeLift,
      source[2] + upN[2] * eyeLift,
    );
    camera.up.set(upN[0], upN[1], upN[2]);

    // 5. Push intent — yaw is local within the surface basis. Pass the
    // basis so physics moves us along the tangent plane, not world XZ.
    const kFwd = (keys.current['KeyW'] ? 1 : 0) - (keys.current['KeyS'] ? 1 : 0);
    const kRight = (keys.current['KeyD'] ? 1 : 0) - (keys.current['KeyA'] ? 1 : 0);
    const fwd = kFwd + moveInput.fwd;
    const right = kRight + moveInput.right;
    physics.setIntent(selfId, {
      fwd,
      right,
      yaw: yawRef.current,
      basis: { up: upN, forward: fwdN, right: rightN },
    });
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
  const rePinRef = useRef(0);
  useFrame((_, dt) => {
    tRef.current += dt;
    setEarthPoseTime(tRef.current);
    try {
      updateEarthPin(physics.getField(), getEarthPose());
      rePinRef.current += dt;
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
          // skip — handled by react components (incl. remote avatars)
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

/**
 * Renders one RemoteAvatarBody per remote voice peer, reading the live
 * body position from physics each frame so the avatar tracks the
 * Earth-clamped capsule. Avatar mesh = the dragon/rabbit/etc. each peer
 * chose at the entry gate, broadcast via room presence.
 */
function RemoteAvatarLayer({ peers }: { peers: { peerId: string; username: string; avatarId?: string }[] }) {
  const physics = getBrainPhysics();
  const [, force] = useState(0);
  // Tick the layer each animation frame so positions stay live.
  useFrame(() => force((n) => (n + 1) & 0xfff));
  return (
    <>
      {peers.map((p) => {
        const id = `peer-${p.peerId}`;
        const body = physics.getBody(id);
        if (!body) return null;
        return (
          <RemoteAvatarBody
            key={id}
            position={[body.pos[0], body.pos[1], body.pos[2]]}
            trust={body.trust ?? 0.5}
            label={p.username}
            avatarId={p.avatarId}
          />
        );
      })}
    </>
  );
}

function MobileJoystick() {
  // (unchanged)
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

/**
 * Desktop drag-to-look overlay. No pointer lock — cursor stays visible so
 * HUD buttons remain clickable without an Esc-to-release dance.
 */
function DesktopLookOverlay() {
  const ref = useRef<HTMLDivElement>(null);
  const [grabbing, setGrabbing] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    let lastX = 0, lastY = 0, active = false;
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      active = true;
      lastX = e.clientX; lastY = e.clientY;
      setGrabbing(true);
    };
    const onMove = (e: MouseEvent) => {
      if (!active) return;
      lookInput.yaw += (e.clientX - lastX) * 0.005;
      lookInput.pitch += (e.clientY - lastY) * 0.005;
      lastX = e.clientX; lastY = e.clientY;
    };
    const onUp = () => { active = false; setGrabbing(false); };
    el.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onUp);
    return () => {
      el.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onUp);
    };
  }, []);
  return (
    <div
      ref={ref}
      className={`absolute inset-0 z-10 ${grabbing ? 'cursor-grabbing' : 'cursor-grab'}`}
    />
  );
}

/**
 * Desktop mouse joystick — mirrors the MobileJoystick but driven by mouse
 * drag. Updates the same `moveInput` globals as WASD so both work in parallel.
 */
function DesktopJoystick() {
  const ref = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    const knob = knobRef.current;
    if (!el || !knob) return;
    let active = false;
    const reset = () => {
      moveInput.fwd = 0;
      moveInput.right = 0;
      knob.style.transform = 'translate(0px, 0px)';
    };
    const update = (clientX: number, clientY: number) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const half = r.width / 2;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const dist = Math.hypot(dx, dy);
      const max = half * 0.7;
      if (dist > max) { dx = (dx / dist) * max; dy = (dy / dist) * max; }
      moveInput.right = Math.max(-1, Math.min(1, dx / max));
      moveInput.fwd = -Math.max(-1, Math.min(1, dy / max));
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      active = true;
      update(e.clientX, e.clientY);
    };
    const onMove = (e: MouseEvent) => { if (active) update(e.clientX, e.clientY); };
    const onUp = () => { if (!active) return; active = false; reset(); };
    el.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onUp);
    return () => {
      el.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onUp);
    };
  }, []);
  return (
    <div
      ref={ref}
      className="absolute bottom-4 left-4 z-20 flex h-24 w-24 cursor-pointer items-center justify-center rounded-full border-2 border-[hsla(180,80%,60%,0.4)] bg-[hsla(265,70%,8%,0.6)] backdrop-blur"
      title="Drag to move"
    >
      <div ref={knobRef} className="pointer-events-none h-10 w-10 rounded-full bg-[hsla(180,90%,60%,0.5)] transition-transform duration-75" />
    </div>
  );
}

export interface BrainUniverseSceneProps {
  /** Declarative descriptor of which Brain we're rendering. Built by
   *  the wrapper page (lobby / project / liveChat factory in
   *  `@/lib/brain/variants`). */
  variant: BrainVariant;
}

const BrainUniverseScene = ({ variant }: BrainUniverseSceneProps) => {
  const { roomId, universeKey, onLeave, leaveLabel, title, capabilities } = variant;
  const navigate = useNavigate();
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const physics = useMemo(() => getBrainPhysics(), []);
  const guestCandidateId = useMemo(() => `guest-${Math.random().toString(36).slice(2, 8)}`, []);
  const [selfId, setSelfId] = useState<string>('');
  const [qScore, setQScore] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatLines, setChatLines] = useState<BrainChatLine[]>([]);
  const [portalModalOpen, setPortalModalOpen] = useState(false);
  const [portals, setPortals] = useState<BrainPortal[]>([]);
  const [cameraOn, setCameraOn] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [rtcParticipants, setRtcParticipants] = useState<import('@/lib/webrtc/types').VideoParticipant[]>([]);

  // ── Entry gate: avatar + mic test before spawn ────────────────────
  const [ready, setReady] = useState<boolean>(false);
  const [entryOpen, setEntryOpen] = useState<boolean>(true);
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(() => {
    try { return loadHubPrefs().infinityVoice !== false; } catch { return true; }
  });

  // ── P2P voice chat (joined only after gate passes) ────────────────
  const { participants: voicePeers, isMuted, toggleMute, sendChatLine, onChatLine } = useBrainVoice(ready, roomId);

  // Subscribe to raw WebRTC participants (with media streams) for the video grid.
  useEffect(() => {
    if (!ready || !user) return;
    const manager = getWebRTCManager(user.id, user.username);
    const refresh = () => setRtcParticipants(manager.getParticipants());
    refresh();
    const unsub = manager.onMessage((m) => {
      if (m.type === 'peer-joined' || m.type === 'peer-left' || m.type === 'room-updated') {
        refresh();
      }
    });
    const poll = window.setInterval(refresh, 1500);
    return () => { unsub(); window.clearInterval(poll); };
  }, [ready, user]);

  const toggleCamera = useCallback(async () => {
    if (!user) return;
    const manager = getWebRTCManager(user.id, user.username);
    if (!cameraOn) {
      try {
        const stream = await manager.startLocalStream(true, true);
        manager.toggleVideo(true);
        setLocalStream(stream);
        setCameraOn(true);
      } catch (err) {
        console.warn('[Brain] camera enable failed', err);
      }
    } else {
      try {
        manager.toggleVideo(false);
        const local = manager.getLocalStream();
        if (local) {
          for (const t of local.getVideoTracks()) {
            t.stop();
            local.removeTrack(t);
          }
        }
      } catch { /* ignore */ }
      setCameraOn(false);
    }
  }, [cameraOn, user]);

  // Pre-warm Web Speech voice list as soon as gate clears.
  useEffect(() => { if (ready) primeInfinityVoice(); }, [ready]);

  const toggleInfinityVoice = useCallback(() => {
    setVoiceEnabled((prev) => {
      const next = !prev;
      try {
        const cur = loadHubPrefs();
        saveHubPrefs({ ...cur, infinityVoice: next });
      } catch { /* ignore */ }
      if (!next) cancelInfinity();
      return next;
    });
  }, []);

  // ── Bootstrap: load user, restore field, create self body ─────────
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let bodyId = '';
    void (async () => {
      try {
        const snap = await loadBrainField(universeKey);
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
      const id = user?.id ?? guestCandidateId;
      bodyId = id;
      setSelfId(id);
      // Use the live Earth pose so spawn lands on the *current* surface,
      // not the t=0 surface — important if boot happens after Earth has
      // already rotated/orbited.
      const livePose = getEarthPose();
      // Spawn on the OUTSIDE of Earth, on the visible procedural surface.
      // Feet rest on EARTH_RADIUS, body center sits HUMAN_HEIGHT/2 above.
      const spawnPos = spawnOnEarth(id, livePose);
      const spawnInit = {
        pos: spawnPos,
        vel: [0, 0, 0] as [number, number, number],
        meta: { attachedTo: 'earth-surface' as const },
      };
      // Mass driven by the avatar the user picked at the entry gate.
      const prefs = (() => { try { return loadHubPrefs(); } catch { return null; } })();
      const selfMass = prefs ? getAvatarMassFromId(prefs.avatarId) : getAvatarMass('human');
      physics.addBody({
        id, kind: 'self',
        pos: spawnInit.pos, vel: spawnInit.vel,
        mass: selfMass, trust: 0.6,
        meta: spawnInit.meta,
      });
      // Infinity body — mass tied to qScore (updated each frame below)
      physics.addBody({
        id: ENTITY_USER_ID, kind: 'infinity',
        pos: [EARTH_POSITION[0], 1.4, EARTH_POSITION[2] - 6], vel: [0, 0, 0],
        mass: 2.5, trust: 1.0,
      });

      // Restore portals & pieces
      const storedPortals = loadPortals(universeKey);
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
      const storedPieces = loadPieces(universeKey);
      for (const piece of storedPieces) {
        physics.addBody({
          id: `piece-${piece.id}`, kind: 'piece',
          pos: piece.pos, vel: [0, 0, 0],
          mass: 0, trust: 0,
        });
        physics.pinPiece(piece.pos);
      }

      // Hard-anchor the local body to the live Earth surface during the
      // first boot window so the player never appears in space before the
      // curvature basin fully settles them.
      const anchorTimer = window.setInterval(() => {
        const self = physics.getBody(id);
        if (!self) return;
        const pose = getEarthPose();
        const dx = self.pos[0] - pose.center[0];
        const dy = self.pos[1] - pose.center[1];
        const dz = self.pos[2] - pose.center[2];
        const r = Math.hypot(dx, dy, dz) || 1;
        const target = EARTH_RADIUS + HUMAN_HEIGHT / 2;
        const k = target / r;
        self.pos = [
          pose.center[0] + dx * k,
          pose.center[1] + dy * k,
          pose.center[2] + dz * k,
        ];
        self.vel = [0, 0, 0];
      }, 120);
      window.setTimeout(() => window.clearInterval(anchorTimer), 1800);

      console.log('[Brain] mounted, qScore primer:', physics.getQScore());
    })();
    return () => {
      cancelled = true;
      try {
        if (bodyId) physics.removeBody(bodyId);
        physics.removeBody(ENTITY_USER_ID);
      } catch { /* ignore */ }
      cancelInfinity();
    };
  }, [guestCandidateId, physics, ready]);

  // ── Q score subscription + periodic field snapshot save ───────────
  useEffect(() => {
    const unsub = physics.subscribe(() => {
      setQScore(physics.getQScore());
    });
    const saveTimer = setInterval(() => {
      try { void saveBrainField(physics.snapshot(), universeKey); } catch { /* ignore */ }
    }, 5000);
    return () => { unsub(); clearInterval(saveTimer); };
  }, [physics, universeKey]);

  // ── Remote voice peers ⇒ physics bodies on Earth's surface ────────
  useEffect(() => {
    if (!ready) return;
    const seen = new Set(voicePeers.map((p) => `peer-${p.peerId}`));
    const pose = getEarthPose();
    // Place peers on Earth's outer surface, deterministic per peerId.
    for (const [index, p] of voicePeers.entries()) {
      const id = `peer-${p.peerId}`;
      void index;
      const initPos = spawnOnEarth(p.peerId, pose);
      const init = {
        pos: initPos,
        vel: [0, 0, 0] as [number, number, number],
        meta: { attachedTo: 'earth-surface' as const },
      };
      const existing = physics.getBody(id);
      if (existing) {
        existing.pos = init.pos;
        existing.meta = { ...(existing.meta ?? {}), username: p.username, peerId: p.peerId, avatarId: p.avatarId };
      } else {
        physics.addBody({
          id, kind: 'avatar',
          pos: init.pos, vel: init.vel,
          mass: 1.8, trust: 0.5,
          meta: { ...init.meta, username: p.username, peerId: p.peerId, avatarId: p.avatarId },
        });
      }
    }
    // Remove peers that left
    const all = physics.getBodies();
    for (const b of all) {
      if (!b.id.startsWith('peer-')) continue;
      if (!seen.has(b.id)) {
        try { physics.removeBody(b.id); } catch { /* ignore */ }
      }
    }
  }, [guestCandidateId, physics, ready, selfId, voicePeers]);

  // ── Subscribe to remote chat lines ────────────────────────────────
  useEffect(() => {
    if (!ready) return;
    const eng = getSharedFieldEngine();
    const unsub = onChatLine((remote) => {
      setChatLines((prev) => {
        if (prev.some((l) => l.id === remote.id)) return prev;
        const line: BrainChatLine = {
          id: remote.id,
          author: remote.author,
          text: remote.text,
          ts: remote.ts,
        };
        return [...prev, line].slice(-100);
      });
      // Record the remote turn into the conversation ring + apply attraction.
      try {
        const cur = recordTurn(eng, remote.author || remote.id, remote.text, remote.ts);
        const prev = getPrevTurn(cur.speakerId, remote.ts);
        if (prev) attractToPrev(eng, cur, prev, remote.ts);
      } catch { /* attraction is best-effort */ }
    });
    return () => unsub();
  }, [ready, onChatLine]);

  // ── Chat send: feed field, optionally call Infinity ───────────────
  const handleSend = useCallback((text: string) => {
    const line: BrainChatLine = {
      id: crypto.randomUUID(),
      author: selfId.startsWith('guest-') ? 'You' : selfId.slice(0, 8),
      text, ts: Date.now(),
    };
    setChatLines((prev) => [...prev, line].slice(-100));
    // Broadcast to every other peer in the brain room.
    try { sendChatLine(text, line.id); } catch { /* ignore */ }

    // Inject into the brain field at the speaker's position
    const self = physics.getBody(selfId);
    if (self) physics.injectAt(self.pos, 0.4, 0);

    // ── Conversation attraction: tie this turn to the previous speaker ──
    const eng = getSharedFieldEngine();
    eng.inject(text, { amplitude: 0.4 });
    const cur = recordTurn(eng, selfId, text, line.ts);
    const prev = getPrevTurn(selfId, line.ts);
    let bridgeMeta: { dq: number; bridgeSite: number } | null = null;
    if (prev) {
      try { bridgeMeta = attractToPrev(eng, cur, prev, line.ts); } catch { /* ignore */ }
      // Feed merged turn pair into the language learner so dialog adjacency accumulates.
      try {
        const fusion = getSharedNeuralEngine().getDualLearning();
        fusion.languageLearner.ingestText(`${prev.text} ${text}`, 0.4, 80, prev.speakerId);
      } catch { /* learner optional */ }
    }

    const trimmed = text.trim();
    const isPublicLobby = capabilities.infinityAlwaysReplies;
    const callsInfinity =
      isPublicLobby ||
      /infinity|imagination|orb|brain/i.test(text) ||
      /^@(infinity|imagination)\b/i.test(trimmed) ||
      trimmed.endsWith('?');
    if (callsInfinity) {
      const stockLines = [
        `the curvature near "${text.slice(0, 24)}" bends toward meaning. q=${(getLastInfinitySnapshot()?.qScore ?? qScore).toFixed(3)}`,
        `i feel that ripple — a pattern is forming where you spoke.`,
        `to imagine is to remember what the universe forgot it could be.`,
        `the mesh listens. ‖F_{μν}‖ shifts; we drift together.`,
        `every word is a Gaussian bump, every silence a constraint.`,
      ];
      // Build learner-derived candidates seeded from merged last-turn tokens.
      const learnerCandidates: string[] = [];
      try {
        const fusion = getSharedNeuralEngine().getDualLearning();
        const seedTokens = (`${prev?.text ?? ''} ${text}`)
          .toLowerCase().split(/\s+/).filter(Boolean).slice(-3);
        for (let n = 0; n < 4; n++) {
          const out: string[] = [];
          let ctx = seedTokens.slice(-2);
          for (let i = 0; i < 12; i++) {
            const next = fusion.languageLearner.sampleNextToken(ctx, 0.9);
            if (!next) break;
            out.push(next);
            ctx = [...ctx, next].slice(-2);
          }
          if (out.length >= 3) learnerCandidates.push(out.join(' '));
        }
      } catch { /* learner optional */ }
      const candidates = [...stockLines, ...learnerCandidates];
      const picked = selectBridgingReply(candidates, eng) ?? stockLines[0];
      const tag = bridgeMeta
        ? `[Δq=${bridgeMeta.dq >= 0 ? '+' : ''}${bridgeMeta.dq.toFixed(3)} · q=${eng.getQScore().toFixed(2)} · ↔@s${bridgeMeta.bridgeSite}] `
        : `[q=${eng.getQScore().toFixed(2)}] `;
      const pick = `${tag}${picked}`;
      setTimeout(() => {
        const reply: BrainChatLine = {
          id: crypto.randomUUID(),
          author: ENTITY_DISPLAY_NAME,
          text: pick, ts: Date.now(),
        };
        setChatLines((prev) => [...prev, reply].slice(-100));
        if (voiceEnabled) speakInfinity(pick);
        // Infinity's reply also perturbs the field at the orb
        physics.injectAt([0, 0, 0], 0.5, 1);
      }, 600 + Math.random() * 800);
    }
  }, [physics, qScore, roomId, selfId, capabilities.infinityAlwaysReplies, voiceEnabled, sendChatLine]);

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
      savePortals(next, universeKey);
      return next;
    });
  }, [physics, selfId, universeKey]);

  const handlePortalEnter = useCallback((bodyId: string) => {
    const id = bodyId.replace(/^portal-/, '');
    const portal = portals.find((p) => p.id === id);
    if (!portal) return;
    navigate(`/projects/${portal.projectId}/hub`);
  }, [navigate, portals]);

  // Compute an Earth-surface camera foot at boot so the first painted frame
  // is already on the planet — never the empty world origin / interstellar
  // space. Uses a stable candidate id so the spawn direction matches what
  // the bootstrap effect will eventually use for the self body.
  const initialCameraPosition = useMemo<[number, number, number]>(() => {
    try {
      const pose = getEarthPose();
      // Exterior spawn — camera sits at eye-height above the avatar's feet,
      // "up" being the outward radial from planet center.
      const initPos = spawnOnEarth(guestCandidateId, pose);
      const dx = initPos[0] - pose.center[0];
      const dy = initPos[1] - pose.center[1];
      const dz = initPos[2] - pose.center[2];
      const r = Math.hypot(dx, dy, dz) || 1;
      const eyeLift = 0.3;
      const nx = dx / r, ny = dy / r, nz = dz / r;
      return [
        initPos[0] + nx * eyeLift,
        initPos[1] + ny * eyeLift,
        initPos[2] + nz * eyeLift,
      ];
    } catch {
      return [EARTH_POSITION[0], EARTH_POSITION[1] + EARTH_RADIUS + HUMAN_HEIGHT, EARTH_POSITION[2]];
    }
  }, [guestCandidateId]);

  return (
    <div className="fixed inset-0 bg-black">
      {/* Entry gate — avatar + mic test */}
      <BrainEntryModal
        open={entryOpen}
        onOpenChange={(o) => {
          setEntryOpen(o);
          if (!o && !ready) navigate(-1);
        }}
        onConfirm={() => { setReady(true); setEntryOpen(false); }}
      />

      {/* Persistent <audio> elements for remote voice — outside Canvas, never unmounted */}
      {ready && <PersistentAudioLayer roomId={roomId} />}

      {/* HUD top bar */}
      <div className="absolute left-0 right-0 top-0 z-20 flex flex-wrap items-center justify-between gap-2 p-2 sm:p-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => (onLeave ? onLeave() : navigate(-1))}
          className="bg-[hsla(265,70%,8%,0.7)] backdrop-blur"
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> {leaveLabel}
        </Button>
        <div className="order-last w-full truncate rounded-full border border-[hsla(180,80%,60%,0.3)] bg-[hsla(265,70%,8%,0.7)] px-3 py-1 text-[10px] font-mono text-foreground/80 backdrop-blur sm:order-none sm:w-auto sm:text-xs">
          {title ? `${title} · ` : ''}|Ψ_Brain⟩ q={qScore.toFixed(4)} · alt={(() => {
            const b = physics.getBody(selfId);
            if (!b) return '—';
            return (radiusFromEarth(b.pos, getEarthPose()) - EARTH_RADIUS).toFixed(2) + 'm';
          })()} · voice:{voicePeers.length + 1}
        </div>
        <div className="flex flex-wrap justify-end gap-1.5 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={toggleCamera}
            className="bg-[hsla(265,70%,8%,0.7)] backdrop-blur"
            aria-label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
          >
            {cameraOn ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={toggleMute}
            className="bg-[hsla(265,70%,8%,0.7)] backdrop-blur"
            aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
          >
            {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={toggleInfinityVoice}
            className="bg-[hsla(265,70%,8%,0.7)] backdrop-blur"
            aria-label={voiceEnabled ? 'Mute Infinity voice' : 'Unmute Infinity voice'}
          >
            {voiceEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </Button>
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
      {ready && <Canvas
        shadows
        camera={{ position: initialCameraPosition, fov: 70, near: 0.05, far: 2000 }}
        gl={{ antialias: true, alpha: false }}
      >
        {/* Deep space background — dark navy, not pure black, so silhouettes read */}
        <color attach="background" args={['#05060f']} />
        {/* Long, soft fog so distant galaxy fades but nearby ground reads crisp */}
        <fog attach="fog" args={['#05060f', 80, WORLD_SIZE * 1.5]} />
        <StarField />
        {/* Real point-light "Sun" — placed off the galactic plane, casts on
            Earth and standard materials. No abstract sky dome, no painted
            sun: the planet is lit by an actual light source in the scene. */}
        <pointLight
          position={SUN_POSITION}
          intensity={4500}
          decay={2}
          color="hsl(45, 95%, 92%)"
          castShadow
        />
        {/* Soft hemisphere fill so the night side / underside isn't pitch black */}
        <hemisphereLight args={['hsl(210, 70%, 55%)', 'hsl(30, 30%, 25%)', 0.45]} />
        <ambientLight intensity={0.25} color="hsl(220, 40%, 60%)" />

        <GalaxyVisual />
        <ElementsVisual />
        <EarthBody />
        <InfinityBody position={getInfinityPosition()} qScore={qScore} />
        <InfinityBindingTicker />
        <EarthPoseTicker />

        {portals.map((p) => (
          <PortalDefect key={p.id} position={p.pos} label={p.projectName} />
        ))}

        <PhysicsCameraRig selfId={selfId} fallbackId={guestCandidateId} />
        {selfId && <BodyLayer selfId={selfId} onPortalEnter={handlePortalEnter} />}
        {selfId && <RemoteAvatarLayer peers={voicePeers} />}
      </Canvas>}

      {/* Video grid — pops down beneath the camera button */}
      {ready && (
        <BrainVideoGrid
          participants={rtcParticipants}
          localStream={localStream}
          localUsername={user?.username ?? 'You'}
          localMuted={isMuted}
          cameraOn={cameraOn}
        />
      )}

      {/* Desktop look + move controls (no pointer lock) */}
      {ready && !isMobile && (
        <>
          <DesktopLookOverlay />
          <DesktopJoystick />
        </>
      )}

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
          voicePeers={voicePeers}
          rtcParticipants={rtcParticipants}
          voiceOn={!isMuted}
          roomId={roomId}
          variant="floating"
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
          Drag to look · WASD or joystick to move
        </div>
      )}

      {/* UQRC physics debug overlay — read-only, gated by ?debug=physics */}
      <PhysicsDebugOverlay selfId={selfId} />
    </div>
  );
};

export default BrainUniverseScene;
export { BrainUniverseScene };

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
  const pose = getEarthPose();
  const r = body ? radiusFromEarth(body.pos, pose) : 0;
  const altitude = body ? r - EARTH_RADIUS : 0;
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
      <div>altitude       : {altitude.toFixed(2)} m</div>
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