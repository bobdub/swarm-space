import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getAvatarById } from '@/lib/virtualHub/avatars';
import {
  getSurfaceFrame,
  getEarthPose,
  HUMAN_HEIGHT,
  quatRotate,
  worldDisplacementToEarthLocal,
} from '@/lib/brain/earth';
import { feetRadiusAt } from '@/lib/brain/groundHeight';
import { BRAIN_PHYSICS_VERSION } from '@/lib/brain/brainPersistence';
import { Billboard, Text } from '@react-three/drei';
import { subscribeSwingFx } from '@/lib/world/swingFxBus';

interface Props {
  position: [number, number, number];
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
  const targetPos = useRef(new THREE.Vector3(position[0], position[1], position[2]));
  const targetQuat = useRef(new THREE.Quaternion());
  const seeded = useRef(false);
  /** Target and smoothed position kept RELATIVE to Earth's centre. Earth
   *  translates along its orbit at ~2.6 m/s, so a world-space target
   *  computed once per presence update would slide against the ground
   *  every frame — the peer would appear to skate and bob. Everything is
   *  smoothed Earth-relative and remapped through the frame pose. */
  const targetRel = useRef(new THREE.Vector3());
  const smoothRel = useRef(new THREE.Vector3());

  // Refresh target whenever the prop changes.
  useMemo(() => {
    const pose = getEarthPose();
    if (pinned) {
      // Seat lock: the stool transform is already exact in this scene.
      targetPos.current.set(position[0], position[1], position[2]);
    } else {
      // Feet-first grounding (same for stale and current peers): take the
      // broadcast direction, find the solid ground there, and put the FEET
      // at ground + FOOT_CUSHION. A peer broadcasting higher (stool, floor)
      // keeps that height; nobody is ever rendered below the ground.
      const disp: [number, number, number] = [
        position[0] - pose.center[0],
        position[1] - pose.center[1],
        position[2] - pose.center[2],
      ];
      const local = worldDisplacementToEarthLocal(disp, pose);
      const len = Math.hypot(local[0], local[1], local[2]) || 1;
      const n: [number, number, number] = [local[0] / len, local[1] / len, local[2] / len];
      const feetR = feetRadiusAt(n);
      const wLen = Math.hypot(disp[0], disp[1], disp[2]) || 1;
      const broadcastFeet = wLen - HUMAN_HEIGHT / 2;
      const raised = !isStale && broadcastFeet - feetR > 0.3 ? broadcastFeet : feetR;
      const r = raised + HUMAN_HEIGHT / 2;
      targetPos.current.set(
        pose.center[0] + (disp[0] / wLen) * r,
        pose.center[1] + (disp[1] / wLen) * r,
        pose.center[2] + (disp[2] / wLen) * r,
      );
    }
    const { up } = getSurfaceFrame(
      [targetPos.current.x, targetPos.current.y, targetPos.current.z],
      pose,
    );
    targetQuat.current.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(up[0], up[1], up[2]),
    );
    targetRel.current.set(
      targetPos.current.x - pose.center[0],
      targetPos.current.y - pose.center[1],
      targetPos.current.z - pose.center[2],
    );
  }, [position, isStale, pinned]);

  // Facing: derived from the smoothed Earth-relative track, so it works
  // identically for the local player and for peers whose positions arrive
  // as presence updates. Flattened onto the local ground plane and held
  // while idle so a standing avatar doesn't spin.
  const headingRef = useRef(new THREE.Vector3());
  const prevTargetLocal = useRef<THREE.Vector3 | null>(null);
  const targetLocal = useRef(new THREE.Vector3());
  const facingQuat = useRef(new THREE.Quaternion());
  const _up = useRef(new THREE.Vector3());
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

  useFrame(() => {
    const body = bodyRef.current;
    if (body) {
      const t = (performance.now() - swingAt.current) / SWING_MS;
      if (swingAt.current > 0 && t >= 0 && t <= 1) {
        // Wind up, drive down, settle back — a single smooth arc.
        const wind = Math.sin(Math.PI * Math.min(1, t * 1.35));
        const drive = Math.sin(Math.PI * t);
        body.rotation.x = -0.22 * wind + 0.62 * drive * drive;
        body.rotation.z = 0.16 * drive;
        body.position.y = FEET_DROP - 0.12 * drive;
      } else if (body.rotation.x !== 0 || body.rotation.z !== 0) {
        body.rotation.x = 0;
        body.rotation.z = 0;
        body.position.y = FEET_DROP;
      }
    }
    const g = groupRef.current;
    if (!g) return;
    const center = getEarthPose().center;
    if (!seeded.current || pinned) {
      // Seat-locked peers snap: no intermediate standing pose is ever
      // shown while the smoother catches up to the stool.
      smoothRel.current.copy(targetRel.current);
      g.quaternion.copy(targetQuat.current);
      seeded.current = true;
      const local = worldDisplacementToEarthLocal(
        [targetRel.current.x, targetRel.current.y, targetRel.current.z],
        getEarthPose(),
      );
      prevTargetLocal.current = new THREE.Vector3(local[0], local[1], local[2]);
      headingRef.current.set(0, 0, 0);
    } else {
      if (intentDriven) smoothRel.current.copy(targetRel.current);
      else smoothRel.current.lerp(targetRel.current, 0.18);

      const up = _up.current.copy(smoothRel.current).normalize();

      // Compare authoritative positions in Earth's CO-ROTATING frame.
      // World-relative positions continue moving with the planet after the
      // player stops, which previously looked like travel and turned every
      // idle avatar toward the planet's spin direction.
      const local = worldDisplacementToEarthLocal(
        [targetRel.current.x, targetRel.current.y, targetRel.current.z],
        getEarthPose(),
      );
      targetLocal.current.set(local[0], local[1], local[2]);
      if (movementDirection) {
        const localDirection = worldDisplacementToEarthLocal(movementDirection, getEarthPose());
        const localUp = _localUp.current.copy(targetLocal.current).normalize();
        const d = _fwd.current.set(localDirection[0], localDirection[1], localDirection[2]);
        d.addScaledVector(localUp, -d.dot(localUp));
        if (d.lengthSq() > 1e-8) headingRef.current.copy(d).normalize();
      } else if (!intentDriven && prevTargetLocal.current) {
        const localUp = _localUp.current.copy(targetLocal.current).normalize();
        const d = _fwd.current.copy(targetLocal.current).sub(prevTargetLocal.current);
        d.addScaledVector(localUp, -d.dot(localUp)); // ground-plane travel only
        // ~2 cm of lateral travel before we accept a new heading: filters
        // settle-spring jitter while idle.
        if (d.lengthSq() > 4e-4) headingRef.current.copy(d).normalize();
      }
      (prevTargetLocal.current ??= new THREE.Vector3()).copy(targetLocal.current);

      if (headingRef.current.lengthSq() > 0.5) {
        // The retained direction is Earth-local; rotate it back into the
        // live world frame so it remains attached to the same patch of soil.
        const worldHeading = quatRotate(getEarthPose().spinQuat, [
          headingRef.current.x,
          headingRef.current.y,
          headingRef.current.z,
        ]);
        const fwd = _fwd.current.set(worldHeading[0], worldHeading[1], worldHeading[2]);
        fwd.addScaledVector(up, -fwd.dot(up));
        if (fwd.lengthSq() > 1e-8) {
          fwd.normalize();
          const right = _right.current.crossVectors(up, fwd).normalize();
          // Avatar meshes are authored facing local +Z (eyes/snout at +Z).
          _m.current.makeBasis(right, up, fwd);
          facingQuat.current.setFromRotationMatrix(_m.current);
          g.quaternion.slerp(facingQuat.current, 0.18);
        }
        // No fallback once a heading exists: standing still keeps the pose.
      } else {
        g.quaternion.slerp(targetQuat.current, 0.18);
      }
    }
    g.position.set(
      center[0] + smoothRel.current.x,
      center[1] + smoothRel.current.y,
      center[2] + smoothRel.current.z,
    );
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