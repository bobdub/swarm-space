import type { JSX } from "react";
import type { AvatarRenderProps, AvatarDefinition } from "../avatars";

type Vec3 = [number, number, number];

export interface RavenLimb {
  /** Where the limb starts (inside the part it grows out of). */
  from: Vec3;
  /** Where the limb ends. */
  to: Vec3;
  radius: number;
  /** Capsule centre. */
  position: Vec3;
  /** Euler XYZ rotation that turns a +Y capsule to point from → to. */
  rotation: Vec3;
  /** Length of the capsule's straight section. */
  length: number;
}

/**
 * Build a capsule that runs exactly from one point to another.
 *
 * A capsule is built along +Y. With Euler order XYZ the Z turn applies
 * first and sends +Y to (-sin rz, cos rz, 0); the X turn then gives
 * (-sin rz, cos rz·cos rx, cos rz·sin rx). Solving that for a unit
 * direction d gives rz = -asin(dx) and rx = atan2(dz, dy).
 */
export function limbBetween(from: Vec3, to: Vec3, radius: number): RavenLimb {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const length = Math.hypot(dx, dy, dz);
  const ux = dx / length;
  return {
    from,
    to,
    radius,
    length,
    position: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2],
    rotation: [Math.atan2(dz, dy), 0, -Math.asin(ux)],
  };
}

/**
 * Body: an ellipsoid (sphere of BODY_RADIUS scaled by BODY_SCALE) tilted
 * chest-up, the way a raven stands. Every other part is rooted inside it
 * or inside the head, so nothing floats free.
 */
export const BODY_CENTER: Vec3 = [0, 0.6, -0.04];
export const BODY_RADIUS = 0.3;
export const BODY_SCALE: Vec3 = [0.8, 0.88, 1.3];
/** Negative X turn lifts the chest (+Z) and drops the rump. */
export const BODY_TILT = -0.5;

export const HEAD_CENTER: Vec3 = [0, 1.0, 0.2];
export const HEAD_RADIUS = 0.18;

/** Neck runs from inside the chest into the head. */
export const NECK = limbBetween([0, 0.74, 0.12], [0, 0.96, 0.19], 0.13);

/** Heavy beak, rooted inside the head and angled slightly down. */
export const BEAK_ROOT: Vec3 = [0, 0.99, 0.3];
export const BEAK_TIP: Vec3 = [0, 0.94, 0.58];

/** Legs drop straight from inside the belly to the ankles. */
export const LEGS: RavenLimb[] = [-0.09, 0.09].map((x) =>
  limbBetween([x, 0.42, 0], [x, 0.06, 0.02], 0.026),
);

/** Three toes forward and one back on each foot, all from the ankle. */
export const TOES: RavenLimb[] = LEGS.flatMap((leg) => {
  const [ax, ay, az] = leg.to;
  return [
    limbBetween(leg.to, [ax - 0.06, 0.025, az + 0.13], 0.016),
    limbBetween(leg.to, [ax, 0.025, az + 0.15], 0.016),
    limbBetween(leg.to, [ax + 0.06, 0.025, az + 0.13], 0.016),
    limbBetween(leg.to, [ax, 0.025, az - 0.1], 0.016),
  ];
});

/** Wedge tail: grows out of the rump and fans out back and down. */
export const TAIL = limbBetween([0, 0.5, -0.26], [0, 0.34, -0.66], 0.075);
/** The tail capsule is flattened: wide side to side, thin top to bottom. */
export const TAIL_SCALE: Vec3 = [2, 1, 0.45];

/** Folded wings hug the flanks and trail past the rump. */
export const WINGS = [-1, 1].map((side) => ({
  side,
  position: [side * 0.19, 0.62, -0.12] as Vec3,
  rotation: [-0.42, 0, side * 0.1] as Vec3,
  radius: 0.25,
  scale: [0.26, 0.72, 1.55] as Vec3,
}));

/** Ravens are small; scale up so the head sits near the cat's height. */
export const RAVEN_SCALE = 1.2;

function RavenMesh({ scale = 1, color = "#1c1f2b" }: AvatarRenderProps): JSX.Element {
  const beak = "#15161c";
  const feet = "#23252d";
  const feather = (
    <meshPhysicalMaterial
      color={color}
      roughness={0.35}
      metalness={0.1}
      clearcoat={0.6}
      clearcoatRoughness={0.4}
      sheen={0.5}
      sheenColor="#5b6cff"
      sheenRoughness={0.5}
    />
  );
  return (
    <group scale={scale * RAVEN_SCALE}>
      {/* Body */}
      <mesh position={BODY_CENTER} rotation={[BODY_TILT, 0, 0]} scale={BODY_SCALE} castShadow>
        <sphereGeometry args={[BODY_RADIUS, 32, 24]} />
        {feather}
      </mesh>
      {/* Neck ruff */}
      <mesh position={NECK.position} rotation={NECK.rotation} castShadow>
        <capsuleGeometry args={[NECK.radius, NECK.length, 8, 20]} />
        {feather}
      </mesh>
      {/* Head */}
      <mesh position={HEAD_CENTER} castShadow>
        <sphereGeometry args={[HEAD_RADIUS, 32, 24]} />
        {feather}
      </mesh>
      {/* Beak — a cone is built along +Y, so tilt it to point forward. */}
      {(() => {
        const b = limbBetween(BEAK_ROOT, BEAK_TIP, 0.065);
        return (
          <mesh position={b.position} rotation={b.rotation} castShadow>
            <coneGeometry args={[b.radius, b.length, 16]} />
            <meshStandardMaterial color={beak} roughness={0.3} metalness={0.2} />
          </mesh>
        );
      })()}
      {/* Eyes — dark and glossy, set just proud of the head. */}
      {[-0.095, 0.095].map((x) => (
        <group key={x} position={[x, 1.04, 0.335]}>
          <mesh>
            <sphereGeometry args={[0.032, 20, 16]} />
            <meshStandardMaterial color="#0b0b10" roughness={0.15} />
          </mesh>
          <mesh position={[x < 0 ? -0.008 : 0.008, 0.012, 0.026]}>
            <sphereGeometry args={[0.008, 12, 10]} />
            <meshBasicMaterial color="#e8e6e1" />
          </mesh>
        </group>
      ))}
      {/* Folded wings */}
      {WINGS.map((w) => (
        <mesh key={w.side} position={w.position} rotation={w.rotation} scale={w.scale} castShadow>
          <sphereGeometry args={[w.radius, 24, 18]} />
          {feather}
        </mesh>
      ))}
      {/* Tail */}
      <mesh position={TAIL.position} rotation={TAIL.rotation} scale={TAIL_SCALE} castShadow>
        <capsuleGeometry args={[TAIL.radius, TAIL.length, 8, 16]} />
        {feather}
      </mesh>
      {/* Legs and toes */}
      {[...LEGS, ...TOES].map((l, i) => (
        <mesh key={i} position={l.position} rotation={l.rotation} castShadow>
          <capsuleGeometry args={[l.radius, l.length, 6, 10]} />
          <meshStandardMaterial color={feet} roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

export const ravenAvatar: AvatarDefinition = {
  id: "raven",
  name: "Raven",
  description: "A sharp-eyed, light-boned raven. The lightest form: quick to lift and drift.",
  unlocked: true,
  mass: 0.8,
  render: (props) => <RavenMesh {...props} />,
  preview: (props) => <RavenMesh {...props} />,
};
