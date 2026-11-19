import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getAvatarById } from '@/lib/virtualHub/avatars';
import {
  getEarthPose,
  HUMAN_HEIGHT,
  worldDisplacementToEarthLocal,
  earthLocalToWorld,
} from '@/lib/brain/earth';
import { avatarLocalTarget, avatarTrackingAlpha } from '@/lib/brain/avatarTracking';
import { BRAIN_PHYSICS_VERSION } from '@/lib/brain/brainPersistence';
import { Billboard, Text } from '@react-three/drei';
import { subscribeSwingFx } from '@/lib/world/swingFxBus';

interface Props {
  position: [number, number, number];
  /** Read self physics in the render frame, without React position updates. */
  samplePose?: () => { position: [number, number, number]; pinned: boolean; movementDirection?: [number, number, number] } | undefined;
  trust: number;
  label?: string;
  avatarId?: string;
  /** Brain physics version reported by the remote peer. Undefined = pre-versioning (v0). */
  peerPv?: number;
  /**
   * Seat-locked: `position` is the authoritative stool transform resolved
   * from the shared table state, not a broadcast body. Rendered verbatim
   * and snapped, so a seated peer can never flash an intermediate
   * standing pose while presence catches up.
   */
  pinned?: boolean;
  /** Local players face their deliberate movement input, never residual drift. */
  intentDriven?: boolean;
  /** Active world-space travel direction. Omitted while input is idle. */
  movementDirection?: [number, number, number];
}

/**
 * Renders a remote peer's chosen avatar (dragon/rabbit/etc.) standing
 * upright on Earth's curved surface. Orientation is derived from the live
 * Earth pose so the avatar's "up" matches the surface normal at its
 * position rather than the world Y axis.
 */
export function RemoteAvatarBody({
  position,
  samplePose,
  trust,
  label,
  avatarId,
  peerPv,
  pinned,
  intentDriven = false,
  movementDirection,
}: Props) {
  const def = useMemo(() => getAvatarById(avatarId), [avatarId]);
  const color = useMemo(() => `hsl(${Math.floor((trust * 200) % 360)}, 70%, 60%)`, [trust]);
  // Version gate: a peer running an older physics protocol may report an
  // altitude our integrator no longer trusts (e.g. they fall through the
  // updated mantle clamp). Pin them to the structural shell so they
  // *visually* stand on the planet skin instead of beneath it.
  const isStale = pinned ? false : (typeof peerPv === 'number' ? peerPv < BRAIN_PHYSICS_VERSION : true);


  // Smoothed position + orientation. Presence updates land at ~1 Hz which
  // looks like teleport hops if applied directly; we lerp toward the latest
  // sample every frame so motion reads continuous.
  const groupRef = useRef<THREE.Group>(null);
  const seeded = useRef(false);
  // Both translation AND rotation are removed from cached targets.
  const targetRel = useRef(new THREE.Vector3());
  const smoothRel = useRef(new THREE.Vector3());
  useMemo(() => {
    if (samplePose) return;
    const local = avatarLocalTarget(position, getEarthPose(), !!pinned, isStale);
    targetRel.current.set(...local);
  }, [position, isStale, pinned, samplePose]);

  // Facing: derived from the smoothed Earth-relative track, so it works
  // identically for the local player and for peers whose positions arrive
  // as presence updates. Flattened onto the local ground plane and held
  // while idle so a standing avatar doesn't spin.
  const headingRef = useRef(new THREE.Vector3());
  const prevTargetLocal = useRef<THREE.Vector3 | null>(null);
  const targetLocal = useRef(new THREE.Vector3());
  const facingQuat = useRef(new THREE.Quaternion());
  const localRotation = useRef(new THREE.Quaternion());
  const rotationSeeded = useRef(false);
  const _localUp = useRef(new THREE.Vector3());
  const _fwd = useRef(new THREE.Vector3());
  const _right = useRef(new THREE.Vector3());
  const _m = useRef(new THREE.Matrix4());

  // Swing animation: a chop/dig is felt in the body, not just in the arc
  // FX. Only the local player's own swings are published on the bus, so
  // this is gated to the intent-driven (self) avatar.
  const bodyRef = useRef<THREE.Group>(null);
  const swingAt = useRef(0);
  const SWING_MS = 520;
  useEffect(() => {
    if (!intentDriven) return;
    return subscribeSwingFx((fx) => {
      if (fx.variant !== 'swing') return;
      swingAt.current = performance.now();
    });
  }, [intentDriven]);

  useFrame((_, delta) => {
    const body = bodyRef.current;
    if (body) {
      const t = (performance.now() - swingAt.current) / SWING_MS;
      if (swingAt.current > 0 && t >= 0 && t <= 1) {
        const wind = Math.sin(Math.PI * Math.min(1, t * 1.35));
        const drive = Math.sin(Math.PI * t);
        body.rotation.x = -0.22 * wind + 0.62 * drive * drive;
        body.rotation.z = 0.16 * drive;
        body.position.y = FEET_DROP - 0.12 * drive;
      } else {
        body.rotation.x = 0;
        body.rotation.z = 0;
        body.position.y = FEET_DROP;
      }
    }
    const g = groupRef.current;
    if (!g) return;
    const pose = getEarthPose();
    const live = samplePose?.();
    if (samplePose && !live) { g.visible = false; return; }
    g.visible = true;
    const seatLocked = live?.pinned ?? !!pinned;
    if (live) {
      // Self already has physics grounding and interpolation; never re-solve it here.
      const local = worldDisplacementToEarthLocal([
        live.position[0] - pose.center[0], live.position[1] - pose.center[1], live.position[2] - pose.center[2],
      ], pose);
      targetRel.current.set(...local);
    }
    const alpha = avatarTrackingAlpha(delta, intentDriven || seatLocked);
    if (!seeded.current) {
      smoothRel.current.copy(targetRel.current);
      seeded.current = true;
    } else smoothRel.current.lerp(targetRel.current, alpha);

    targetLocal.current.copy(targetRel.current);
    const localUp = _localUp.current.copy(smoothRel.current).normalize();
    const direction = live?.movementDirection ?? (samplePose ? undefined : movementDirection);
    if (direction) {
      const localDirection = worldDisplacementToEarthLocal(direction, pose);
      const d = _fwd.current.set(...localDirection);
      d.addScaledVector(localUp, -d.dot(localUp));
      if (d.lengthSq() > 1e-8) headingRef.current.copy(d).normalize();
    } else if (!intentDriven && !seatLocked && prevTargetLocal.current) {
      const d = _fwd.current.copy(targetLocal.current).sub(prevTargetLocal.current);
      d.addScaledVector(localUp, -d.dot(localUp));
      if (d.lengthSq() > 4e-4) headingRef.current.copy(d).normalize();
    }
    (prevTargetLocal.current ??= new THREE.Vector3()).copy(targetLocal.current);
    // Seed a deterministic Earth-local heading once; retain it while idle.
    if (headingRef.current.lengthSq() < 0.5) {
      headingRef.current.set(0, 0, 1);
      if (Math.abs(headingRef.current.dot(localUp)) > 0.95) headingRef.current.set(1, 0, 0);
    }
    const fwd = _fwd.current.copy(headingRef.current);
    fwd.addScaledVector(localUp, -fwd.dot(localUp)).normalize();
    headingRef.current.copy(fwd);
    const right = _right.current.crossVectors(localUp, fwd).normalize();
    _m.current.makeBasis(right, localUp, fwd);
    facingQuat.current.setFromRotationMatrix(_m.current);
    // Smooth rotation in Earth-local coordinates too, then apply live spin once.
    if (!rotationSeeded.current) {
      localRotation.current.copy(facingQuat.current);
      rotationSeeded.current = true;
    } else localRotation.current.slerp(facingQuat.current, alpha);
    const spin = pose.spinQuat;
    g.quaternion.set(spin[0], spin[1], spin[2], spin[3]);
    g.quaternion.multiply(localRotation.current);
    const world = earthLocalToWorld([smoothRel.current.x, smoothRel.current.y, smoothRel.current.z], pose);
    g.position.set(...world);
  });


  // Spawn-coherence fix: physics anchors the body at its center of mass
  // (EARTH_RADIUS + HUMAN_HEIGHT/2 above the planet center). The avatar
  // meshes (rabbit/dragon/…) are authored with their *feet* at local
  // y = 0, so rendering them straight at the anchor leaves the mesh
  // floating ~HUMAN_HEIGHT/2 above the surface — which on a curved
  // planet reads as "the avatar lives inside Earth" once the camera
  // peeks past the horizon. Drop the mesh by HUMAN_HEIGHT/2 along the
  // local surface-up (post-rotation, that's local +Y) so feet land on
  // the dirt and the head sits ~1.7 m above it, like a person on land.
  const FEET_DROP = -HUMAN_HEIGHT / 2;

  return (
    <group ref={groupRef}>
      <group ref={bodyRef} position={[0, FEET_DROP, 0]}>
        {def.render({ scale: 1, color })}
      </group>
      {label && !intentDriven && (
        // Nameplate: billboarded so it always faces the camera, small and
        // outlined rather than slab-backed so a crowd never turns into a
        // wall of panels. Hidden for the local player (you know who you are).
        <Billboard position={[0, FEET_DROP + 2.05, 0]} follow>
          <Text
            fontSize={0.2}
            color="hsl(210, 40%, 96%)"
            anchorX="center"
            anchorY="middle"
            maxWidth={3}
            outlineWidth={0.018}
            outlineColor="hsl(245, 70%, 8%)"
            outlineOpacity={0.85}
          >
            {label.length > 18 ? `${label.slice(0, 17)}…` : label}
          </Text>
        </Billboard>
      )}
      {isStale && (
        <Text
          position={[0, FEET_DROP + 2.4, 0]}
          fontSize={0.18}
          color="hsl(38, 95%, 65%)"
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.012}
          outlineColor="hsl(245, 70%, 8%)"
        >
          needs reload
        </Text>
      )}
    </group>
  );
}