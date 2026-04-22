import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PointerLockControls, Sky } from '@react-three/drei';
import * as THREE from 'three';
import { ArrowLeft, MessageSquare, Compass } from 'lucide-react';
import { Mic, MicOff, Volume2, VolumeX } from 'lucide-react';
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
import {
  loadHubPrefs,
  saveHubPrefs,
  getAvatarMassFromId,
} from '@/lib/virtualHub/avatars';
import { BrainEntryModal } from '@/components/brain/BrainEntryModal';
import { useBrainVoice, BRAIN_ROOM_ID } from '@/hooks/useBrainVoice';
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

/**
 * Reads keyboard / joystick into intent vectors that the physics engine
 * applies to the local body. No direct camera translation — the camera
 * follows the body whose position is integrated from field gradients.
 */
function PhysicsCameraRig({ selfId, fallbackId }: { selfId: string; fallbackId: string }) {
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
    const pose = getEarthPose();
    const source = physics.getBody(selfId)?.pos ?? spawnOnEarth(fallbackId, pose);
    const dx = source[0] - pose.center[0];
    const dy = source[1] - pose.center[1];
    const dz = source[2] - pose.center[2];
    const r = Math.hypot(dx, dy, dz) || 1;
    const eye = 1.6;
    const nx = dx / r, ny = dy / r, nz = dz / r;
    const surfX = pose.center[0] + nx * EARTH_RADIUS;
    const surfY = pose.center[1] + ny * EARTH_RADIUS;
    const surfZ = pose.center[2] + nz * EARTH_RADIUS;
    camera.position.x = surfX + nx * eye;
    camera.position.y = surfY + ny * eye;
    camera.position.z = surfZ + nz * eye;
    camera.lookAt(surfX, surfY, surfZ);
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
        } else if (b.kind === 'avatar') {
          // Remote voice peer — capsule rendered on Earth's surface.
          const group = new THREE.Group();
          const capGeo = new THREE.CapsuleGeometry(0.3, 0.8, 4, 8);
          const capMat = new THREE.MeshStandardMaterial({
            color: 'hsl(180, 70%, 55%)',
            emissive: 'hsl(180, 80%, 35%)',
            emissiveIntensity: 0.35,
          });
          const cap = new THREE.Mesh(capGeo, capMat);
          cap.castShadow = true;
          cap.position.y = 0.6;
          group.add(cap);
          // Floating name marker (simple plane — kept tiny so no font deps).
          const labelGeo = new THREE.PlaneGeometry(0.9, 0.18);
          const labelMat = new THREE.MeshBasicMaterial({
            color: 'hsl(245, 70%, 12%)',
            transparent: true,
            opacity: 0.7,
          });
          const label = new THREE.Mesh(labelGeo, labelMat);
          label.position.y = 1.55;
          group.add(label);
          mesh = group;
        } else {
          // skip — handled by react components
          continue;
        }
        groupRef.current.add(mesh);
        meshes.current.set(b.id, mesh);
      }
      if (b.kind === 'avatar') {
        // Use full 3-D position so capsule rides Earth's curved surface.
        mesh.position.set(b.pos[0], b.pos[1], b.pos[2]);
      } else {
        mesh.position.set(b.pos[0], b.kind === 'piece' ? 1 : 0, b.pos[2]);
      }
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
  const guestCandidateId = useMemo(() => `guest-${Math.random().toString(36).slice(2, 8)}`, []);
  const [selfId, setSelfId] = useState<string>('');
  const [qScore, setQScore] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatLines, setChatLines] = useState<BrainChatLine[]>([]);
  const [portalModalOpen, setPortalModalOpen] = useState(false);
  const [portals, setPortals] = useState<BrainPortal[]>([]);

  // ── Entry gate: avatar + mic test before spawn ────────────────────
  const [ready, setReady] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    // Only skip within the current tab session after the user explicitly
    // completed the Brain entry flow. Saved prefs still prefill the modal,
    // but they no longer skip the avatar step on a fresh visit.
    try {
      if (sessionStorage.getItem('brain-ready') === '1') return true;
    } catch { /* ignore */ }
    return false;
  });
  const [entryOpen, setEntryOpen] = useState<boolean>(() => !ready);
  const [voiceEnabled, setVoiceEnabled] = useState<boolean>(() => {
    try { return loadHubPrefs().infinityVoice !== false; } catch { return true; }
  });

  // ── P2P voice chat (joined only after gate passes) ────────────────
  const { participants: voicePeers, isMuted, toggleMute, sendChatLine, onChatLine } = useBrainVoice(ready);

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
      const id = user?.id ?? guestCandidateId;
      bodyId = id;
      setSelfId(id);
      // Use the live Earth pose so spawn lands on the *current* surface,
      // not the t=0 surface — important if boot happens after Earth has
      // already rotated/orbited.
      const spawn = spawnOnEarth(id, getEarthPose());
      // Mass driven by the avatar the user picked at the entry gate.
      const prefs = (() => { try { return loadHubPrefs(); } catch { return null; } })();
      const selfMass = prefs ? getAvatarMassFromId(prefs.avatarId) : getAvatarMass('human');
      physics.addBody({
        id, kind: 'self',
        pos: spawn, vel: [0, 0, 0],
        mass: selfMass, trust: 0.6,
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
      try { void saveBrainField(physics.snapshot()); } catch { /* ignore */ }
    }, 5000);
    return () => { unsub(); clearInterval(saveTimer); };
  }, [physics]);

  // ── Remote voice peers ⇒ physics bodies on Earth's surface ────────
  useEffect(() => {
    if (!ready) return;
    const seen = new Set(voicePeers.map((p) => `peer-${p.peerId}`));
    const self = selfId ? physics.getBody(selfId) : undefined;
    const pose = getEarthPose();
    const selfAnchor = self?.pos ?? spawnOnEarth(guestCandidateId, pose);
    const ndx = selfAnchor[0] - pose.center[0];
    const ndy = selfAnchor[1] - pose.center[1];
    const ndz = selfAnchor[2] - pose.center[2];
    const nr = Math.hypot(ndx, ndy, ndz) || 1;
    const nx = ndx / nr, ny = ndy / nr, nz = ndz / nr;
    const ref = Math.abs(ny) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const normal = new THREE.Vector3(nx, ny, nz);
    const tangentA = new THREE.Vector3().crossVectors(ref, normal).normalize();
    const tangentB = new THREE.Vector3().crossVectors(normal, tangentA).normalize();
    // Add new peers
    for (const [index, p] of voicePeers.entries()) {
      const id = `peer-${p.peerId}`;
      const angle = (index / Math.max(voicePeers.length, 1)) * Math.PI * 2;
      const ringOffset = tangentA.clone().multiplyScalar(Math.cos(angle) * 2.6)
        .add(tangentB.clone().multiplyScalar(Math.sin(angle) * 2.6));
      const approx = new THREE.Vector3(selfAnchor[0], selfAnchor[1], selfAnchor[2]).add(ringOffset);
      const fromCenter = approx.sub(new THREE.Vector3(pose.center[0], pose.center[1], pose.center[2])).normalize();
      const anchored: [number, number, number] = [
        pose.center[0] + fromCenter.x * (EARTH_RADIUS + 0.05),
        pose.center[1] + fromCenter.y * (EARTH_RADIUS + 0.05),
        pose.center[2] + fromCenter.z * (EARTH_RADIUS + 0.05),
      ];
      const existing = physics.getBody(id);
      if (existing) {
        existing.pos = anchored;
        existing.meta = { ...(existing.meta ?? {}), username: p.username, peerId: p.peerId };
      } else {
        physics.addBody({
          id, kind: 'avatar',
          pos: anchored, vel: [0, 0, 0],
          mass: 1.8, trust: 0.5,
          meta: { username: p.username, peerId: p.peerId },
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

    const trimmed = text.trim();
    const callsInfinity =
      /infinity|imagination|orb|brain/i.test(text) ||
      /^@(infinity|imagination)\b/i.test(trimmed) ||
      trimmed.endsWith('?');
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
        if (voiceEnabled) speakInfinity(pick);
        // Infinity's reply also perturbs the field at the orb
        physics.injectAt([0, 0, 0], 0.5, 1);
      }, 600 + Math.random() * 800);
    }
  }, [physics, qScore, selfId, voiceEnabled, sendChatLine]);

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

  // Compute an Earth-surface camera foot at boot so the first painted frame
  // is already on the planet — never the empty world origin / interstellar
  // space. Uses a stable candidate id so the spawn direction matches what
  // the bootstrap effect will eventually use for the self body.
  const initialCameraPosition = useMemo<[number, number, number]>(() => {
    try {
      const pose = getEarthPose();
      const spawn = spawnOnEarth(guestCandidateId, pose);
      const dx = spawn[0] - pose.center[0];
      const dy = spawn[1] - pose.center[1];
      const dz = spawn[2] - pose.center[2];
      const r = Math.hypot(dx, dy, dz) || 1;
      const eye = 1.6;
      const nx = dx / r, ny = dy / r, nz = dz / r;
      return [
        pose.center[0] + nx * (EARTH_RADIUS + eye),
        pose.center[1] + ny * (EARTH_RADIUS + eye),
        pose.center[2] + nz * (EARTH_RADIUS + eye),
      ];
    } catch {
      return [EARTH_POSITION[0], EARTH_POSITION[1] + EARTH_RADIUS + 1.6, EARTH_POSITION[2]];
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
      {ready && <PersistentAudioLayer roomId={BRAIN_ROOM_ID} />}

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
          |Ψ_Brain⟩ q={qScore.toFixed(4)} · alt={(() => {
            const b = physics.getBody(selfId);
            if (!b) return '—';
            return (radiusFromEarth(b.pos, getEarthPose()) - EARTH_RADIUS).toFixed(2) + 'm';
          })()} · voice:{voicePeers.length + 1}
        </div>
        <div className="flex gap-2">
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
        camera={{ position: initialCameraPosition, fov: 70 }}
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
        <EarthPoseTicker />

        {portals.map((p) => (
          <PortalDefect key={p.id} position={p.pos} label={p.projectName} />
        ))}

        {selfId && <PhysicsCameraRig selfId={selfId} />}
        {selfId && <BodyLayer selfId={selfId} onPortalEnter={handlePortalEnter} />}
        {!isMobile && <PointerLockControls />}
      </Canvas>}

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