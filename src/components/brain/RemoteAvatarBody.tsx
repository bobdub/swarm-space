import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getAvatarById } from '@/lib/virtualHub/avatars';
import {
  getSurfaceFrame,
  getEarthPose,
  HUMAN_HEIGHT,
  STRUCTURE_SHELL_RADIUS,
  EARTH_RADIUS,
  worldDisplacementToEarthLocal,
} from '@/lib/brain/earth';
import { sampleSurfaceLift } from '@/lib/brain/surfaceProfile';
import { BRAIN_PHYSICS_VERSION } from '@/lib/brain/brainPersistence';
import { Text } from '@react-three/drei';

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
}

/**
 * Renders a remote peer's chosen avatar (dragon/rabbit/etc.) standing
 * upright on Earth's curved surface. Orientation is derived from the live
 * Earth pose so the avatar's "up" matches the surface normal at its
 * position rather than the world Y axis.
 */
export function RemoteAvatarBody({ position, trust, label, avatarId, peerPv, pinned }: Props) {
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
    } else if (isStale) {

      // Reproject onto the structural shell (skin radius from Earth centre).
      const dx = position[0] - pose.center[0];
      const dy = position[1] - pose.center[1];
      const dz = position[2] - pose.center[2];
      const len = Math.hypot(dx, dy, dz) || 1;
      const k = STRUCTURE_SHELL_RADIUS / len;
      targetPos.current.set(
        pose.center[0] + dx * k,
        pose.center[1] + dy * k,
        pose.center[2] + dz * k,
      );
    } else {
      // Local-terrain reproject: remote peers broadcast their body
      // centre at the analytic shell, but the local viewer renders the
      // surface with `sampleSurfaceLift` (mountains, dips). Without
      // re-projecting, peers visibly sink into hills or float in the
      // air. Take the broadcast direction, look up the terrain lift
      // here, and place the body centre at EARTH_RADIUS + lift +
      // HUMAN_HEIGHT/2 so feet land on the rendered ground.
      const disp: [number, number, number] = [
        position[0] - pose.center[0],
        position[1] - pose.center[1],
        position[2] - pose.center[2],
      ];
      const local = worldDisplacementToEarthLocal(disp, pose);
      const len = Math.hypot(local[0], local[1], local[2]) || 1;
      const n: [number, number, number] = [local[0] / len, local[1] / len, local[2] / len];
      const lift = sampleSurfaceLift(n);
      // Convert back to world: lift is in local frame; multiply by
      // current direction-from-centre (in world).
      const wx = position[0] - pose.center[0];
      const wy = position[1] - pose.center[1];
      const wz = position[2] - pose.center[2];
      const wLen = Math.hypot(wx, wy, wz) || 1;
      // Height the peer actually broadcast above the analytic shell. A
      // peer sitting on a stool (or standing on a raised floor) is above
      // HUMAN_HEIGHT/2 — flattening them to the ground made seated
      // players look like they were standing beside the table.
      const broadcastHeight = wLen - EARTH_RADIUS - lift;
      const r = EARTH_RADIUS + lift + Math.max(HUMAN_HEIGHT / 2, broadcastHeight);
      targetPos.current.set(
        pose.center[0] + (wx / wLen) * r,
        pose.center[1] + (wy / wLen) * r,
        pose.center[2] + (wz / wLen) * r,
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
  }, [position, isStale]);

  useFrame(() => {
    const g = groupRef.current;
    if (!g) return;
    const center = getEarthPose().center;
    if (!seeded.current) {
      smoothRel.current.copy(targetRel.current);
      g.quaternion.copy(targetQuat.current);
      seeded.current = true;
    } else {
      smoothRel.current.lerp(targetRel.current, 0.18);
      g.quaternion.slerp(targetQuat.current, 0.18);
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
      <group position={[0, FEET_DROP, 0]}>
        {def.render({ scale: 1, color })}
      </group>
      {label && (
        <mesh position={[0, FEET_DROP + 2.0, 0]}>
          <planeGeometry args={[1.5, 0.3]} />
          <meshBasicMaterial color="hsl(245, 70%, 12%)" transparent opacity={0.7} />
        </mesh>
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