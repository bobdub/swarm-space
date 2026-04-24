import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ArrowLeft, MessageSquare, Compass } from 'lucide-react';
import { Mic, MicOff, Volume2, VolumeX, Video, VideoOff } from 'lucide-react';
import { Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useIsMobile } from '@/hooks/use-mobile';
import { useGamepadIntent } from '@/hooks/useGamepadIntent';
import { CompassHUD } from '@/components/brain/CompassHUD';
import { MiniMapHUD } from '@/components/brain/MiniMapHUD';
import { getWebRTCManager } from '@/lib/webrtc/manager';
import { useAuth } from '@/hooks/useAuth';
import { BrainVideoGrid } from '@/components/brain/BrainVideoGrid';
import {
  getBrainPhysics,
  WORLD_SIZE,
} from '@/lib/brain/uqrcPhysics';
import { C_LIGHT } from '@/lib/brain/lightspeed';
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
import { AtmosphereSky } from '@/components/brain/AtmosphereSky';
import { WetWorkHabitat } from '@/components/brain/WetWorkHabitat';
import { SurfaceTree } from '@/components/brain/SurfaceTree';
import { NatureLayer } from '@/components/brain/nature/NatureLayer';
import { BrainChatPanel, type BrainChatLine } from '@/components/brain/BrainChatPanel';
import { DropPortalModal } from '@/components/brain/DropPortalModal';
import { getCurrentUser } from '@/lib/auth';
import {
  ENTITY_DISPLAY_NAME,
  ENTITY_USER_ID,
  getEntityVoice,
} from '@/lib/p2p/entityVoice';
import { getSharedFieldEngine } from '@/lib/uqrc/fieldEngine';
import {
  recordTurn,
  getPrevTurn,
  attractToPrev,
  selectBridgingToken,
  temperatureFromQ,
  targetLengthFromQ,
  topKFromQ,
} from '@/lib/uqrc/conversationAttraction';
import { applyGalaxyToField, getGalaxy } from '@/lib/brain/galaxy';
import { applyRoundCurvature } from '@/lib/brain/roundUniverse';
import { updateEarthCorePin } from '@/lib/brain/earthCore';
import { initLavaMantle } from '@/lib/brain/lavaMantle';
import { applyElementsToField, getElements, countByShell } from '@/lib/brain/elements';
import { getBuilderBlockEngine } from '@/lib/brain/builderBlockEngine';
import { ElementsVisual } from '@/components/brain/ElementsVisual';
import {
  spawnOnEarth,
  EARTH_POSITION,
  EARTH_RADIUS,
  HUMAN_HEIGHT,
  BODY_CENTER_HEIGHT,
  radiusFromEarth,
  getEarthPose,
  updateEarthPin,
  getAvatarMass,
  getSurfaceFrame,
  SUN_POSITION,
  EYE_LIFT,
  getEarthSpawnTransform,
  BODY_SHELL_RADIUS,
  STRUCTURE_SHELL_RADIUS,
  projectToStructureShell,
  anchorOnEarth,
  VISIBLE_GROUND_RADIUS,
  FEET_SHELL_RADIUS,
} from '@/lib/brain/earth';
import { getLiveSiteFrame } from '@/lib/brain/earth';
import { quatRotate } from '@/lib/brain/earth';
import { sampleSurfaceLift } from '@/lib/brain/surfaceProfile';
import { RemoteAvatarBody } from '@/components/brain/RemoteAvatarBody';

// Legacy SurfaceApartment was removed (non-wet-work artifact). The debug
// HUD still reads "floor vs feet"; without an apartment there is no floor
// to compare against, so this stub keeps the HUD compiling and shows 0.
const apartmentTrackerState = { apartmentRadius: 0, feetRadius: 0 };
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
/** Run/Flash sprint state — toggled by Shift / on-screen pill. */
const runState = { active: false, until: 0, cooldownUntil: 0 };
const RUN_DURATION_MS = 4000;
const RUN_COOLDOWN_MS = 6000;
const RUN_MULTIPLIER = 2.2;

function tryStartRun(now: number): boolean {
  if (runState.active) return false;
  if (now < runState.cooldownUntil) return false;
  runState.active = true;
  runState.until = now + RUN_DURATION_MS;
  runState.cooldownUntil = now + RUN_DURATION_MS + RUN_COOLDOWN_MS;
  return true;
}
const SHARED_VILLAGE_ANCHOR_ID = 'swarm-shared-village';
/**
 * Spawn near the shared village in the live Earth frame, on the body
 * shell. Uses `anchorOnEarth` so the spawn rotates *with* the planet
 * instead of sliding underneath it as Earth spins.
 */
function spawnNearSharedVillage(
  peerId: string,
  pose = getEarthPose(),
  minRadius = 0,
  maxRadius = 6,
): [number, number, number] {
  let h = 5381 >>> 0;
  for (let i = 0; i < peerId.length; i++) h = (((h << 5) + h) ^ peerId.charCodeAt(i)) >>> 0;
  const angle = (h / 0x100000000) * Math.PI * 2;
  const radius = minRadius + ((h >>> 16) / 0x10000) * (maxRadius - minRadius);
  const tx = Math.cos(angle) * radius;
  const tz = Math.sin(angle) * radius;
  const { worldPos } = anchorOnEarth(SHARED_VILLAGE_ANCHOR_ID, tx, tz, BODY_SHELL_RADIUS, pose);
  // Lift onto the local land top so the avatar starts on the beach,
  // not the sea-level baseline shell. Without this, physics settles
  // the body into the water-wade dip on the very first tick (alt < 0).
  const dx = worldPos[0] - pose.center[0];
  const dy = worldPos[1] - pose.center[1];
  const dz = worldPos[2] - pose.center[2];
  const r = Math.hypot(dx, dy, dz) || 1;
  const localUnit: [number, number, number] = [dx / r, dy / r, dz / r];
  // Earth-local normal (un-spin) so we sample the noise on the planet
  // frame, matching shader and physics samplers.
  const localN = quatRotate(pose.invSpinQuat, localUnit);
  const lift = sampleSurfaceLift(localN);
  const k = (r + lift) / r;
  return [
    pose.center[0] + dx * k,
    pose.center[1] + dy * k,
    pose.center[2] + dz * k,
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
    const onShift = (e: KeyboardEvent) => {
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
        if (e.type === 'keydown' && !e.repeat) tryStartRun(performance.now());
      }
    };
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup', onUp);
    window.addEventListener('keydown', onShift);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('keydown', onShift);
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
    // Physics owns body grounding — the camera rig is a read-only consumer.
    // (Removed render-layer body.pos mutation that was fighting the sim.)
    const source = body?.pos ?? spawnNearSharedVillage(fallbackId, pose);
    // Use the SHARED village's live site frame instead of recomputing a
    // basis from `source` every frame. The site frame is frozen in
    // Earth-local coords and only rotated by the smooth spin quaternion,
    // so `forward/right` cannot flip when the body's latitude crosses a
    // ref-axis threshold. The camera's `up` is still the live radial
    // outward vector at the body, but tangent axes are continuous.
    const siteLive = getLiveSiteFrame(SHARED_VILLAGE_ANCHOR_ID, pose);
    const radialDx = source[0] - pose.center[0];
    const radialDy = source[1] - pose.center[1];
    const radialDz = source[2] - pose.center[2];
    const radialLen = Math.hypot(radialDx, radialDy, radialDz) || 1;
    const liveUp: [number, number, number] = [
      radialDx / radialLen,
      radialDy / radialLen,
      radialDz / radialLen,
    ];
    // Project the village forward into the plane orthogonal to the body's
    // local up so the basis stays orthonormal even when the body is far
    // from the village anchor (curved surface).
    const fdot = siteLive.forward[0] * liveUp[0] + siteLive.forward[1] * liveUp[1] + siteLive.forward[2] * liveUp[2];
    let liveFwd: [number, number, number] = [
      siteLive.forward[0] - liveUp[0] * fdot,
      siteLive.forward[1] - liveUp[1] * fdot,
      siteLive.forward[2] - liveUp[2] * fdot,
    ];
    const fwdLen = Math.hypot(liveFwd[0], liveFwd[1], liveFwd[2]) || 1;
    liveFwd = [liveFwd[0] / fwdLen, liveFwd[1] / fwdLen, liveFwd[2] / fwdLen];
    const frame = { up: liveUp, forward: liveFwd, right: siteLive.right };

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
    // right = forward × up
    // Using up × forward creates a reflected basis (determinant < 0), which
    // makes the camera quaternion solve against an invalid frame and can roll
    // the whole horizon sideways even when the body is correctly surface-pinned.
    const rightN: [number, number, number] = [
      fwdN[1] * upN[2] - fwdN[2] * upN[1],
      fwdN[2] * upN[0] - fwdN[0] * upN[2],
      fwdN[0] * upN[1] - fwdN[1] * upN[0],
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

    // 4. Position camera at eye height above the body. Single source of
    // truth: EYE_LIFT (earth.ts). Phase 4C — no radial eye rescue. The
    // eye is computed strictly from the solved body position + local
    // outward normal. If the camera ever clips into the core, the bug
    // is in the body integrator (or a missing surface support band) —
    // patching it here would only mask the real failure.
    const eyeLift = EYE_LIFT;
    const eyeX = source[0] + upN[0] * eyeLift;
    const eyeY = source[1] + upN[1] * eyeLift;
    const eyeZ = source[2] + upN[2] * eyeLift;
    camera.position.set(eyeX, eyeY, eyeZ);
    camera.up.set(upN[0], upN[1], upN[2]);

    // 5. Push intent — yaw is local within the surface basis. Pass the
    // basis so physics moves us along the tangent plane, not world XZ.
    const kFwd = (keys.current['KeyW'] ? 1 : 0) - (keys.current['KeyS'] ? 1 : 0);
    const kRight = (keys.current['KeyD'] ? 1 : 0) - (keys.current['KeyA'] ? 1 : 0);
    let fwd = kFwd + moveInput.fwd;
    let right = kRight + moveInput.right;
    // Run / Flash: Shift (desktop) or HUD pill multiplies intent magnitude.
    const now = performance.now();
    if (runState.active && now > runState.until) runState.active = false;
    if (runState.active) { fwd *= RUN_MULTIPLIER; right *= RUN_MULTIPLIER; }
    // Single source of truth for movement direction:
    //   - send the *unrotated* tangent basis (village forward/right) plus
    //     the live camera yaw.
    //   - physics rotates fwd/right by `intent.yaw` exactly once.
    // Pre-rotating the basis here AND letting physics rotate again was the
    // double-yaw bug that flipped controls after spinning past 90°.
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
  // Earth pose is derived from the shared epoch (earth.ts), so every
  // client sees the same Sun/Moon/orbit. Physics owns mantle writes; this
  // ticker exists only to keep pose-driven visuals live. A previous call
  // to `updateLavaMantlePin` here raced the physics tick and produced a
  // second unsynchronised pin re-stamp path — visible as surface tremor.
  useFrame(() => {
    try {
      void getEarthPose();
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
      className="absolute right-4 z-[70] flex h-24 w-24 items-center justify-center rounded-full border-2 border-[hsla(180,80%,60%,0.4)] bg-[hsla(265,70%,8%,0.6)] backdrop-blur"
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 5rem)' }}
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
      className="absolute bottom-4 left-4 z-[70] flex h-24 w-24 cursor-pointer items-center justify-center rounded-full border-2 border-[hsla(180,80%,60%,0.4)] bg-[hsla(265,70%,8%,0.6)] backdrop-blur"
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
  const [mapOpen, setMapOpen] = useState(false);
  const [, forceRunRender] = useState(0);
  const [portals, setPortals] = useState<BrainPortal[]>([]);
  const [cameraOn, setCameraOn] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [rtcParticipants, setRtcParticipants] = useState<import('@/lib/webrtc/types').VideoParticipant[]>([]);

  // ── Entry gate: avatar + mic test before spawn ────────────────────
  // If the user has already completed the Brain entry gate (avatar + mic
  // test) in this browser, skip the modal entirely on subsequent visits.
  // Without this, the modal flashes for one frame every time you re-enter
  // /brain (or when an outer wizard navigates here right after collecting
  // the same info), because `entryOpen` defaulted to `true` unconditionally.
  const entryAlreadyComplete = (() => {
    try {
      const raw = localStorage.getItem('brain-entry-complete');
      if (!raw) return false;
      const parsed = JSON.parse(raw) as { hasMic?: boolean } | null;
      return Boolean(parsed?.hasMic);
    } catch {
      return false;
    }
  })();
  const [ready, setReady] = useState<boolean>(entryAlreadyComplete);
  const [entryOpen, setEntryOpen] = useState<boolean>(!entryAlreadyComplete);
  // Gamepad → existing intent globals. No-op on mobile / Safari iOS.
  useGamepadIntent({
    moveInput,
    lookInput,
    onRunPress: () => { tryStartRun(performance.now()); forceRunRender((n) => (n + 1) & 0xfff); },
  });
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(() => {
    try { return loadHubPrefs().infinityVoice !== false; } catch { return true; }
  });
  // Mirror voiceEnabled into a ref so the chat handler never has to depend on
  // it. This guarantees that toggling mute can NEVER affect text emission —
  // the speak() call simply reads the latest value at fire time.
  const voiceEnabledRef = useRef<boolean>(true);
  useEffect(() => { voiceEnabledRef.current = voiceEnabled; }, [voiceEnabled]);

  // ── P2P voice chat (joined only after gate passes) ────────────────
  const {
    participants: voicePeers,
    isMuted,
    toggleMute,
    sendChatLine,
    onChatLine,
    broadcastSelfPosition,
  } = useBrainVoice(ready, roomId);

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
        // Spawn Coherence: immediately rewrite the live Earth pin so the
        // restored field and the visible Earth shell agree from boot,
        // even when an older saved snapshot is loaded.
        // Single-writer boot path: the mantle owns the full radial pin
        // from core to crust, so do not seed legacy surface/core writers.
        initLavaMantle(field);
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
       // Feet rest on EARTH_RADIUS, body centre sits BODY_CENTER_HEIGHT above.
      const spawnPos = spawnNearSharedVillage(id, livePose);
      // Spawn-bug telemetry: log the deterministic spawn point so we can
      // diff it against the live body position after physics settles. If
      // the radius differs from EARTH_RADIUS+HUMAN_HEIGHT/2 by more than a
      // few cm here, the bug is in earth.spawnOnEarth, not the integrator.
      try {
        const dx = spawnPos[0] - livePose.center[0];
        const dy = spawnPos[1] - livePose.center[1];
        const dz = spawnPos[2] - livePose.center[2];
        const r = Math.hypot(dx, dy, dz);
         const target = BODY_SHELL_RADIUS;
        console.log('[Brain.spawn] self', {
          id,
          pos: spawnPos,
          radius: Number(r.toFixed(4)),
          targetRadius: Number(target.toFixed(4)),
          deltaR: Number((r - target).toFixed(4)),
          earthCenter: livePose.center,
        });
      } catch { /* logging only */ }
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
      // Wire core-escape rescue: if the body falls through the volcano and
      // dwells inside the inner core, respawn it at the shared village.
      physics.setCoreRescue((rescuedId: string) => {
        if (rescuedId !== id) return;
        const livePoseRescue = getEarthPose();
        const respawn = spawnNearSharedVillage(rescuedId, livePoseRescue);
        const body = physics.getBody(rescuedId);
        if (body) {
          body.pos[0] = respawn[0];
          body.pos[1] = respawn[1];
          body.pos[2] = respawn[2];
          body.vel[0] = 0; body.vel[1] = 0; body.vel[2] = 0;
        }
        try { toast.info('You fell through the volcano — respawned at the village'); } catch { /* ignore */ }
      });
      // Surface support is owned by the Earth field (lava-mantle basin)
      // and the per-block volumetric basins written by the
      // BuilderBlockEngine. We no longer reproject `self` onto a shell
      // post-spawn — the integrator settles it into the field, which is
       // the same physics path that holds remote avatars and structures.
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
      // Stored builder pieces — go through the engine so each one gets a
      // volumetric Earth-local support basin instead of a single-cell
      // pin. Any piece without an explicit anchorPeerId falls back to
      // the local user's spawn site so it co-moves with the planet.
      try {
        const engine = getBuilderBlockEngine();
        const storedPieces = loadPieces(universeKey);
        for (const piece of storedPieces) {
          const meta = (piece as { meta?: Record<string, unknown> }).meta ?? {};
          const anchorId = String(meta.anchorPeerId ?? id);
          engine.placeBlock({
            id: piece.id,
            kind: String(meta.structure ?? 'piece'),
            anchorPeerId: anchorId,
            rightOffset: Number(meta.rightOffset ?? 0),
            forwardOffset: Number(meta.forwardOffset ?? 0),
            mass: Number(meta.mass ?? 8),
            basin: Number(meta.basin ?? 0.6),
            meta,
          });
        }
      } catch (err) {
        console.warn('[Brain] stored pieces load failed', err);
      }

      // Phase 4A — no recurring anchor timer. The single spawn projection
      // above (post-addBody) is enough; from this point on the field
      // alone owns radial placement. A boot-time anchor loop would
      // suppress the very curvature response we want bodies to feel.

      console.log('[Brain] mounted, qScore primer:', physics.getQScore());
    })();
    return () => {
      cancelled = true;
      try {
        if (bodyId) physics.removeBody(bodyId);
        physics.removeBody(ENTITY_USER_ID);
        physics.setCoreRescue(null);
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
    // Cluster fallback spawns near the local user's spawn so peers without
    // a broadcast position are visible neighbours instead of antipodal
    // dots (Earth radius is only 1700 m — random spawns can land on the
    // far hemisphere and never enter the player's view frustum).
    // Cluster fallback peers around the *shared village* (same anchor used
    // by SurfaceApartment + SurfaceLandmarks) rather than the local body.
    // This way every viewer sees remote peers congregating at the one
    // apartment everyone shares, instead of orbiting their private spawn.
    const fallbackNear = (peerId: string): [number, number, number] => {
      return spawnNearSharedVillage(peerId, pose, 10, 22);
    };
    // Place peers on Earth's outer surface, deterministic per peerId.
    for (const [index, p] of voicePeers.entries()) {
      const id = `peer-${p.peerId}`;
      void index;
      // Prefer the position the peer actually broadcast — that's the
      // truth of where their avatar lives on their machine. Fall back to
      // a *near-cluster* spawn around the local user so we still render
      // late joiners that haven't published a position yet AND keep them
      // inside the player's view frustum. The deterministic global spawn
      // is only used when we have no self-anchor (very early boot).
      // Phase 4A — accept the peer's broadcast position verbatim. Their
      // physics already solved the surface; reprojecting it here would
      // snap walking remote avatars off-position every render.
      const broadcastPos = p.position
        ? ([p.position[0], p.position[1], p.position[2]] as [number, number, number])
        : null;
      const initPos = broadcastPos ?? fallbackNear(p.peerId);
      try {
        const dx = initPos[0] - pose.center[0];
        const dy = initPos[1] - pose.center[1];
        const dz = initPos[2] - pose.center[2];
        const r = Math.hypot(dx, dy, dz);
        console.log('[Brain.spawn] remote', {
          id,
          source: broadcastPos ? 'broadcast' : 'deterministic',
          pos: initPos,
          radius: Number(r.toFixed(4)),
        });
      } catch { /* logging only */ }
      const init = {
        pos: initPos,
        vel: [0, 0, 0] as [number, number, number],
        meta: { attachedTo: 'earth-surface' as const },
      };
      const existing = physics.getBody(id);
      if (existing) {
        // Only adopt the broadcast position when the peer actually sent
        // one. Phase 4A — when no broadcast arrived we leave the live
        // body's position untouched (no shell reprojection) so the
        // field's surface basin owns radial placement.
        existing.mass = 0;
        existing.vel = [0, 0, 0];
        if (broadcastPos) existing.pos = broadcastPos;
        existing.meta = { ...(existing.meta ?? {}), username: p.username, peerId: p.peerId, avatarId: p.avatarId };
      } else {
        physics.addBody({
          id, kind: 'avatar',
          pos: init.pos, vel: init.vel,
          mass: 0, trust: 0.5,
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

  // ── Broadcast our world-space position to the room ────────────────
  // Throttled to 1.5 s. Phase 4A — we send the *solved* body position
  // straight from physics. We no longer overwrite body.pos with a
  // shell-projected copy; that re-projection was the exact "sideways
  // pressure across the ground" the user reported.
  useEffect(() => {
    if (!ready || !selfId) return;
    let lastSent: [number, number, number] | null = null;
    const tick = () => {
      const body = physics.getBody(selfId);
      if (!body) return;
      const pos: [number, number, number] = [body.pos[0], body.pos[1], body.pos[2]];
      if (lastSent) {
        const dx = pos[0] - lastSent[0];
        const dy = pos[1] - lastSent[1];
        const dz = pos[2] - lastSent[2];
        if (Math.hypot(dx, dy, dz) < 0.05) return;
      }
      lastSent = pos;
      broadcastSelfPosition(pos);
    };
    // Send once immediately so peers learn our spawn point right away.
    tick();
    const id = window.setInterval(tick, 1500);
    return () => window.clearInterval(id);
  }, [ready, selfId, physics, broadcastSelfPosition]);

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
      // Feed the partner's text into the learner so Infinity can echo /
      // bridge their actual words on the next turn (A↔B learning).
      try {
        const fusion = getSharedNeuralEngine().getDualLearning();
        fusion.languageLearner.ingestText(remote.text, 0.8, 90, remote.author || remote.id);
      } catch { /* learner optional */ }
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
    // Always ingest the local user's own text at high trust so Infinity
    // can quote / bridge it on the very next reply (A↔B learning).
    try {
      const fusion = getSharedNeuralEngine().getDualLearning();
      fusion.languageLearner.ingestText(text, 0.8, 95, selfId);
    } catch { /* learner optional */ }

    const trimmed = text.trim();
    const isPublicLobby = capabilities.infinityAlwaysReplies;
    const callsInfinity =
      isPublicLobby ||
      /infinity|imagination|orb|brain/i.test(text) ||
      /^@(infinity|imagination)\b/i.test(trimmed) ||
      trimmed.endsWith('?');
    if (callsInfinity) {
      // ── Physics-driven token-by-token assembly ──────────────────
      // The field decides which token belongs at the A↔B bridge site;
      // the language learner only supplies vocabulary. No constants:
      // top-K, temperature and length are all derived from current q.
      let picked: string = '';
      try {
        const fusion = getSharedNeuralEngine().getDualLearning();
        const learner = fusion.languageLearner;
        // Seed context from the partner's words (the "B" in A↔B), so
        // Infinity literally pulls vocabulary toward what was just said
        // to it. Falls back to the user's own tail when no prev exists.
        const seedSource = (prev?.text ?? text).toLowerCase();
        const seedTokens = seedSource.split(/\s+/).filter(Boolean).slice(-2);
        let ctx = seedTokens.slice();
        const out: string[] = [];
        const qNow = eng.getQScore();
        const maxLen = targetLengthFromQ(qNow);
        const bridgeSite = bridgeMeta?.bridgeSite
          ?? (cur.sites.length > 0 ? cur.sites[0] % eng.getLatticeLength() : 0);
        let prevDq = Number.POSITIVE_INFINITY;
        let stagnated = 0;
        for (let i = 0; i < maxLen; i++) {
          const q = eng.getQScore();
          const k = topKFromQ(q);
          const temp = temperatureFromQ(q);
          const candidates = learner.topKNextTokens(ctx, k, temp);
          if (candidates.length === 0) break;
          const pick = selectBridgingToken(eng, bridgeSite, candidates) ?? candidates[0];
          if (!pick) break;
          out.push(pick);
          ctx = [...ctx, pick].slice(-2);
          // Δq stagnation guard: if curvature stops dropping for 2 consecutive
          // tokens, we've reached a stable basin — stop instead of padding.
          const dq = q - eng.getQScore();
          if (dq <= prevDq - 1e-4) {
            stagnated = 0;
          } else {
            stagnated++;
            if (stagnated >= 2 && out.length >= 3) break;
          }
          prevDq = dq;
          // Punctuation stop: emit short, natural sentences.
          if (/[.!?…]$/.test(pick) && out.length >= 3) break;
        }
        picked = out.join(' ').trim();
      } catch { /* learner optional */ }
      // EntityVoice fallback — used when the learner had zero successors
      // for the seed (cold field / unknown vocabulary). Stage-aware so
      // even a brand-new brain emits an emoji from the Brainstem pool.
      if (!picked) {
        try {
          const synthPost = {
            id: `brain-chat:${line.id}`,
            author: selfId,
            content: text,
            createdAt: new Date(line.ts).toISOString(),
          } as unknown as Parameters<ReturnType<typeof getEntityVoice>['generateComment']>[0];
          const neural = getSharedNeuralEngine();
          const c = getEntityVoice().generateComment(synthPost, neural);
          picked = c?.text ?? '…';
        } catch {
          picked = '…';
        }
      }
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
        // Speech is fire-and-forget and fully decoupled from text emission.
        // Read the latest mute state via ref so toggling never rebuilds this
        // handler or affects the text reply that already rendered above.
        try { if (voiceEnabledRef.current) speakInfinity(pick); } catch { /* ignore */ }
        // Infinity's reply also perturbs the field at the orb
        physics.injectAt([0, 0, 0], 0.5, 1);
      }, 600 + Math.random() * 800);
    }
  }, [physics, qScore, roomId, selfId, capabilities.infinityAlwaysReplies, sendChatLine]);

  // ── Drop a portal at the player's current position ────────────────
  const handleDropPortal = useCallback((projectId: string, projectName: string) => {
    const self = physics.getBody(selfId);
    if (!self) return;
    // Place the portal as a small "moon" in low orbit around Earth — a few
    // metres above the surface, tangent to the player's current angle.
    const ex = EARTH_POSITION[0], ez = EARTH_POSITION[2];
    const dx = self.pos[0] - ex, dz = self.pos[2] - ez;
    const ang = Math.atan2(dz, dx);
    // Place the portal a few metres in front of the player, hovering just
    // above the planet surface (was orbitR=4 from Earth's centre, which is
    // now 1696 m underground after the planet scale-up).
    const surfaceR = EARTH_RADIUS + 2.0; // 2 m above ground
    const portalAng = Math.atan2(self.pos[2] - ez, self.pos[0] - ex);
    void dx; void dz; void ang;
    const dropPos: [number, number, number] = [
      ex + Math.cos(portalAng) * surfaceR,
      EARTH_POSITION[1] + 1.5,
      ez + Math.sin(portalAng) * surfaceR,
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

  // Spawn Coherence: shared boot transform (position + orientation) used by
  // the Canvas camera so the first painted frame already matches the live
  // Earth surface frame and the PhysicsCameraRig takeover is seamless.
  const initialBootTransform = useMemo(() => {
    try {
      return getEarthSpawnTransform(guestCandidateId, getEarthPose());
    } catch {
      return null;
    }
  }, [guestCandidateId]);
  const initialCameraPosition = useMemo<[number, number, number]>(() => {
    if (initialBootTransform) return initialBootTransform.eyePos;
    return [EARTH_POSITION[0], EARTH_POSITION[1] + EARTH_RADIUS + HUMAN_HEIGHT, EARTH_POSITION[2]];
  }, [initialBootTransform]);
  const handleCanvasCreated = useCallback(
    ({ camera }: { camera: THREE.Camera }) => {
      if (!initialBootTransform) return;
      const { up, forward, right } = initialBootTransform;
      // Build the same surface-frame basis the rig uses on tick 1 so
      // there is no visible quaternion/up snap between frame 0 and 1.
      const m = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(right[0], right[1], right[2]),
        new THREE.Vector3(up[0], up[1], up[2]),
        new THREE.Vector3(-forward[0], -forward[1], -forward[2]),
      );
      camera.quaternion.setFromRotationMatrix(m);
      camera.up.set(up[0], up[1], up[2]);
      camera.updateMatrixWorld();
    },
    [initialBootTransform],
  );

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
            return (radiusFromEarth(b.pos, getEarthPose()) - EARTH_RADIUS - BODY_CENTER_HEIGHT).toFixed(2) + 'm';
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
            className={
              isMuted
                ? 'bg-[hsla(0,70%,18%,0.7)] text-destructive backdrop-blur ring-1 ring-destructive/40'
                : 'bg-[hsla(265,70%,8%,0.7)] backdrop-blur'
            }
            aria-label={isMuted ? 'Unmute microphone' : 'Mute microphone'}
            title={isMuted ? 'Self mic muted' : 'Mute self mic'}
          >
            {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </Button>
          <Button
            type="button"
            variant={voiceEnabled ? 'outline' : 'secondary'}
            size="sm"
            onClick={toggleInfinityVoice}
            className={
              voiceEnabled
                ? 'bg-[hsla(265,70%,8%,0.7)] backdrop-blur ring-1 ring-[hsla(180,80%,60%,0.4)]'
                : 'bg-[hsla(38,80%,16%,0.85)] text-amber-400 backdrop-blur ring-1 ring-amber-500/40'
            }
            aria-label={voiceEnabled ? 'Mute Infinity voice' : 'Unmute Infinity voice'}
            title={voiceEnabled ? "Silence Infinity" : "Infinity silenced"}
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
          {capabilities.portals && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPortalModalOpen(true)}
              className="bg-[hsla(265,70%,8%,0.7)] backdrop-blur"
            >
              <Compass className="mr-1 h-4 w-4" /> Portal
            </Button>
          )}
        </div>
      </div>

      {/* 3-D scene */}
      {ready && <Canvas
        shadows
        camera={{ position: initialCameraPosition, fov: 60, near: 0.1, far: 50000 }}
        gl={{ antialias: true, alpha: false }}
        onCreated={handleCanvasCreated}
      >
        {/* Deep space background — dark navy, not pure black, so silhouettes read */}
        <color attach="background" args={['#05060f']} />
        {/* Long, soft fog so distant galaxy fades but nearby ground reads crisp */}
        <fog attach="fog" args={['#05060f', 80, WORLD_SIZE * 1.5]} />
        <StarField />
        <AtmosphereSky />
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
        {/* Landmarks + apartment use a *shared* anchor seed so every
            viewer sees them at the same world-space spot on Earth.
            Anchoring to `selfId` made each peer render their own private
            village on their own hemisphere — from a remote viewer's frame
            that village then sat on the far side of the planet, sinking
            into the ground or floating in the sky. One shared seed = one
            shared village everyone meets at. */}
        {/* Decorative landmark pillars + legacy SurfaceApartment retired —
            both were presentation-only reference props with no wet-work /
            field backing. Wet-work IS the world: the WetWorkHabitat
            (trunk + roots + ribs + chambers) is now the sole surface
            structure. */}
        {/* Phase 4D — grown WetWork habitat. Each rib/chamber/root is a
            real builder block placed via BuilderBlockEngine, not a single
            decorative mesh. Replaces SurfaceApartmentV2. */}
        <WetWorkHabitat anchorPeerId={SHARED_VILLAGE_ANCHOR_ID} />
        {/* Building Blocks Engine test piece — simple UQRC tree beside the apartment. */}
        <SurfaceTree anchorPeerId={SHARED_VILLAGE_ANCHOR_ID} />
        {/* Phase 2 — static nature biome (pond, grass, flowers, trees, fish, hive, bees). */}
        <NatureLayer anchorPeerId={SHARED_VILLAGE_ANCHOR_ID} />
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
          variantCapabilities={capabilities}
          variant="floating"
          infinityVoiceEnabled={voiceEnabled}
          onToggleInfinityVoice={toggleInfinityVoice}
        />
      )}

      {/* Portal placement modal */}
      <DropPortalModal
        open={portalModalOpen}
        onClose={() => setPortalModalOpen(false)}
        onConfirm={handleDropPortal}
      />

      {/* Compass + Mini-Map (always available once spawned) */}
      {ready && selfId && (
        <>
          <CompassHUD selfId={selfId} onOpenMap={() => setMapOpen((v) => !v)} />
          {mapOpen && <MiniMapHUD selfId={selfId} onClose={() => setMapOpen(false)} />}
          {/* Run / Flash pill — taps trigger sprint, also reflects Shift / RT. */}
          <RunPill onPress={() => { tryStartRun(performance.now()); forceRunRender((n) => (n + 1) & 0xfff); }} />
        </>
      )}

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
  const altitude = body ? r - BODY_SHELL_RADIUS : 0;
  const feetRadius = body ? r - BODY_CENTER_HEIGHT : 0;
  const floorRadius = apartmentTrackerState.apartmentRadius;
  const floorVsFeet = floorRadius && feetRadius ? floorRadius - feetRadius : 0;
  const q = physics.getQScore();
  const causal = physics.getLastCausalProbe();
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
      <div className="mt-1 text-[hsl(180,80%,70%)]">|Ψ_Ground⟩ contract</div>
      <div>visible ground : {VISIBLE_GROUND_RADIUS.toFixed(3)} m</div>
      <div>feet shell     : {FEET_SHELL_RADIUS.toFixed(3)} m</div>
      <div>player feet    : {feetRadius.toFixed(3)} m</div>
      <div>apartment      : {floorRadius ? floorRadius.toFixed(3) : '—'} m (reference, no collision)</div>
      <div>floor − feet   : {floorVsFeet.toFixed(4)} m</div>
      <div className="mt-1 text-[hsl(265,80%,75%)]">|Ψ_Infinity⟩</div>
      <div>Q_Score(∞)     : {inf ? inf.qScore.toFixed(4) : '—'}</div>
      <div>basin depth    : {inf ? inf.basinDepth.toFixed(4) : '—'}</div>
      <div>brain stage    : {stageLabel}</div>
      <div>L9 coherence   : {coherenceHealth.toFixed(3)}</div>
      <div>L8 creativity  : {creativityHealth.toFixed(3)}</div>
      <div>elements pinned: {totalEl} (n0:{elCounts[0] ?? 0} n1:{elCounts[1] ?? 0} n2:{elCounts[2] ?? 0} n3:{elCounts[3] ?? 0} n4+:{elCounts[4] ?? 0})</div>
      <div>ticks          : {field.ticks}</div>
      <div className="mt-1 text-[hsl(180,80%,70%)]">𝒞_light  Sun↔Earth</div>
      <div>c (sim)        : {C_LIGHT.toExponential(3)} m/s</div>
      {causal ? (
        <>
          <div>flat Δt        : {causal.flatDt.toExponential(3)} s</div>
          <div>actual Δt      : {causal.actualDt.toExponential(3)} s</div>
          <div>Δ (delay)      : {causal.delay.toExponential(3)} s</div>
          <div>n_surf         : {causal.surfaceN.toFixed(4)}</div>
          <div>‖∇u‖_surf      : {causal.surfaceGradMag.toExponential(3)}</div>
        </>
      ) : (
        <div>probe          : —</div>
      )}
    </div>
  );
}